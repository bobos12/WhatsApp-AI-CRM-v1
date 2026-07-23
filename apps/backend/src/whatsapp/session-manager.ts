import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { clearDbAuthState, useDbAuthState } from './db-auth-state';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { emitRealtime } from '../realtime/socket';
import { normalizePhone, parseWhatsAppJid } from '../lib/phone';
import { logger } from '../lib/logger';
import { processIncomingMessage } from '../workflow/inbound-workflow';
import { runWithTenant } from '../lib/tenant-context';

export type WaStatus = 'connected' | 'disconnected' | 'connecting';

export interface ConnectionError {
  statusCode?: number;
  reason?: string;
  message?: string;
}

/**
 * One tenant's live WhatsApp connection and its surrounding state. This is the
 * per-tenant equivalent of the old module-level singletons in client.ts.
 */
interface TenantSession {
  tenantId: string;
  /** The WhatsApp auth key (WhatsAppSession.sessionId) backing this connection. */
  sessionId: string;
  sock: any;
  status: WaStatus;
  qr: string | null;
  connectInFlight: Promise<any> | null;
  reconnectTimer: NodeJS.Timeout | null;
  lastError: ConnectionError | null;
  connectedAt: Date | null;
}

/**
 * Runs many Baileys sockets in one process — one per tenant. Replaces the single
 * `let sock` in client.ts so a single deployment can serve every client's own
 * WhatsApp number. Each socket's events are handled inside `runWithTenant()` so
 * everything they touch (conversation resolution, persistence, realtime emits,
 * the bot) is fenced to the owning tenant.
 *
 * Memory note: each connected socket holds that number's chat/contact state in
 * RAM, so a single box handles a bounded number of tenants before you add a
 * worker. Callers go through this one interface, so sharding later needs no
 * changes on their side.
 */
class SessionManager {
  private sessions = new Map<string, TenantSession>();

  private ensure(tenantId: string): TenantSession {
    let s = this.sessions.get(tenantId);
    if (!s) {
      s = {
        tenantId,
        sessionId: `wa_${tenantId}`,
        sock: null,
        status: 'disconnected',
        qr: null,
        connectInFlight: null,
        reconnectTimer: null,
        lastError: null,
        connectedAt: null,
      };
      this.sessions.set(tenantId, s);
    }
    return s;
  }

  getSock(tenantId: string): any {
    return this.sessions.get(tenantId)?.sock ?? null;
  }

  getStatus(tenantId: string): WaStatus {
    return this.sessions.get(tenantId)?.status ?? 'disconnected';
  }

  getQR(tenantId: string): string | null {
    return this.sessions.get(tenantId)?.qr ?? null;
  }

  getLastError(tenantId: string): ConnectionError | null {
    return this.sessions.get(tenantId)?.lastError ?? null;
  }

  getConnectedAt(tenantId: string): Date | null {
    return this.sessions.get(tenantId)?.connectedAt ?? null;
  }

  /** The active session id for a tenant (the connected number once online). */
  getSessionId(tenantId: string): string {
    const s = this.sessions.get(tenantId);
    const fromSock = s?.sock?.user?.id ? String(s.sock.user.id) : '';
    return (fromSock || s?.sessionId || `wa_${tenantId}`).trim();
  }

  /** The connected account's own number in E.164, or null when not connected. */
  getConnectedNumber(tenantId: string): string | null {
    const rawId = this.sessions.get(tenantId)?.sock?.user?.id;
    if (!rawId) return null;
    return parseWhatsAppJid(rawId) || normalizePhone(rawId);
  }

  async getProfilePictureUrl(tenantId: string, phone: string): Promise<string | null> {
    const s = this.sessions.get(tenantId);
    if (!s?.sock || s.status !== 'connected') return null;
    try {
      const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
      return await s.sock.profilePictureUrl(jid, 'image');
    } catch {
      return null;
    }
  }

  private clearQr(s: TenantSession): void {
    s.qr = null;
    runWithTenant(s.tenantId, () => emitRealtime('wa:qr', { qr: null }));
  }

  async connect(tenantId: string): Promise<any> {
    const s = this.ensure(tenantId);
    if (s.sock && s.status === 'connected') return s.sock;
    if (s.connectInFlight) return s.connectInFlight;

    // The whole connection lifecycle runs in this tenant's scope so the auth-state
    // reads/writes (WhatsAppSession) and all event handlers are tenant-fenced.
    s.connectInFlight = runWithTenant(tenantId, async () => {
      // One tenant, one deterministic auth key. This used to be an unordered
      // `findFirst()` over the tenant's rows, which picked an ARBITRARY session id
      // — that is how a tenant's credentials ended up stored in a row named after
      // a completely different phone number, and why every lookup keyed on the
      // live JID (status, warm-up) missed the row that actually held the auth.
      s.sessionId = `wa_${tenantId}`;

      const { state, saveCreds } = await useDbAuthState(s.sessionId, tenantId);
      const { version } = await fetchLatestBaileysVersion();

      if (s.reconnectTimer) {
        clearTimeout(s.reconnectTimer);
        s.reconnectTimer = null;
      }
      this.clearQr(s);

      const sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.windows('Chrome'),
        printQRInTerminal: false,
      });
      s.sock = sock;
      s.status = 'connecting';
      s.lastError = null;

      sock.ev.on('connection.update', (update: any) =>
        runWithTenant(tenantId, () => this.onConnectionUpdate(s, update)),
      );
      // Every sibling handler re-enters the tenant scope; this one must too.
      // `saveCreds` writes the tenant-scoped WhatsAppSession row, and Baileys
      // fires it from its own event loop where no scope is active. (useDbAuthState
      // now also re-enters on its own, so this is belt-and-braces — but leaving it
      // unwrapped is what made the omission invisible in the first place.)
      sock.ev.on('creds.update', () => runWithTenant(tenantId, () => saveCreds()));
      sock.ev.on('messages.upsert', (m: any) =>
        runWithTenant(tenantId, () => this.onMessagesUpsert(s, m)),
      );
      sock.ev.on('messages.update', (updates: any) =>
        runWithTenant(tenantId, () => this.onStatusUpdates(updates)),
      );
      sock.ev.on('message-receipt.update', (updates: any) =>
        runWithTenant(tenantId, () => this.onReceiptUpdates(updates)),
      );

      return sock;
    });

    return s.connectInFlight;
  }

  private async onConnectionUpdate(s: TenantSession, update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('WhatsApp QR code received', { tenantId: s.tenantId });
      s.qr = qr;
      emitRealtime('wa:qr', { qr });
    }

    if (connection === 'close') {
      const disconnectStatus = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const boomPayload = (lastDisconnect?.error as Boom)?.output?.payload as any;
      const boomData = (lastDisconnect?.error as any)?.data as any;
      const errorMessage =
        boomPayload?.message ??
        (lastDisconnect?.error as any)?.message ??
        String(lastDisconnect?.error ?? '');
      const loggedOut = disconnectStatus === DisconnectReason.loggedOut;
      const shouldReconnect = !loggedOut;
      const isAuthFailure =
        [401, 403, 405].includes(Number(disconnectStatus)) ||
        /unauthorized|forbidden|session|auth|logged out|connection failure/i.test(errorMessage);

      s.lastError = { statusCode: disconnectStatus, reason: boomData?.reason, message: errorMessage };
      logger.warn('WhatsApp connection closed', {
        tenantId: s.tenantId,
        shouldReconnect,
        isAuthFailure,
        error: errorMessage,
      });

      this.clearQr(s);
      s.status = 'disconnected';
      emitRealtime('wa:status', { status: 'disconnected' });

      s.sock = null;
      s.connectInFlight = null;
      s.connectedAt = null;

      if (loggedOut || isAuthFailure) {
        void clearDbAuthState(s.sessionId);
        return;
      }

      // Avoid tight reconnect loops; retry this tenant after a short backoff.
      s.reconnectTimer = setTimeout(() => {
        void this.connect(s.tenantId);
      }, 3000);
    } else if (connection === 'open') {
      logger.info('WhatsApp connected', { tenantId: s.tenantId });
      this.clearQr(s);
      s.status = 'connected';
      s.lastError = null;
      s.connectedAt = new Date();
      emitRealtime('wa:status', { status: 'connected' });
      s.connectInFlight = null;
    } else if (connection === 'connecting') {
      s.status = 'connecting';
      emitRealtime('wa:status', { status: 'connecting' });
    }
  }

  private async onMessagesUpsert(s: TenantSession, m: any): Promise<void> {
    try {
      if (!Array.isArray(m?.messages)) return;
      if (m?.type !== 'notify' && m?.type !== 'append') return;
      const sessionId = this.getSessionId(s.tenantId);
      await Promise.allSettled(
        m.messages.map((message: any) => processIncomingMessage(message, { sessionId })),
      );
    } catch (error) {
      logger.error('Failed to process incoming WhatsApp message', {
        tenantId: s.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async onStatusUpdates(updates: any): Promise<void> {
    try {
      const { handleMessageStatusUpdates } = await import('./handler');
      await handleMessageStatusUpdates(updates);
    } catch (error) {
      logger.error('Failed to process WhatsApp message updates', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async onReceiptUpdates(updates: any): Promise<void> {
    try {
      const { handleMessageStatusUpdates } = await import('./handler');
      const normalizedUpdates = (updates || []).map((update: any) => ({
        key: update.key,
        status: update.read ? 3 : update.delivered ? 2 : update.received ? 1 : undefined,
      }));
      await handleMessageStatusUpdates(normalizedUpdates);
    } catch (error) {
      logger.error('Failed to process WhatsApp receipt updates', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async disconnect(tenantId: string): Promise<void> {
    const s = this.sessions.get(tenantId);
    if (!s) return;
    if (s.reconnectTimer) {
      clearTimeout(s.reconnectTimer);
      s.reconnectTimer = null;
    }
    const currentSock = s.sock;
    s.sock = null;
    this.clearQr(s);
    s.status = 'disconnected';
    s.connectInFlight = null;
    s.lastError = null;

    if (currentSock) {
      try {
        await currentSock.logout();
      } catch {
        // Logout can fail when the socket is already closed; treat as disconnected.
      }
    }
    runWithTenant(tenantId, () => emitRealtime('wa:status', { status: 'disconnected' }));
  }

  /**
   * Reconnect every ACTIVE tenant that already has a stored WhatsApp session.
   * Called once at boot. Runs cross-tenant (unguarded read) to enumerate, then
   * hands each tenant to `connect()`, which establishes that tenant's scope.
   */
  async reconnectAll(): Promise<void> {
    const stored = await prismaUnscoped.whatsAppSession.findMany({
      where: { tenantId: { not: null } },
      select: { tenantId: true },
    });
    const tenantIds = stored.map((r) => r.tenantId).filter((id): id is string => Boolean(id));
    if (tenantIds.length === 0) return;

    const active = await prismaUnscoped.tenant.findMany({
      where: { status: 'ACTIVE', id: { in: tenantIds } },
      select: { id: true },
    });
    for (const t of active) {
      this.connect(t.id).catch((err) =>
        logger.warn('wa.reconnect_failed', {
          tenantId: t.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    logger.info('wa.reconnect_all', { tenants: active.length });
  }
}

export const sessionManager = new SessionManager();
