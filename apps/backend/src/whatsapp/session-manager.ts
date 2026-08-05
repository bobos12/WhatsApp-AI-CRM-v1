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

/**
 * How many back-to-back QR pairing cycles (each ~a minute of rotating codes) to
 * offer before going idle. Enough time for someone actively linking to scan, but
 * bounded so an unwatched QR never loops forever — a perpetual pairing loop from
 * one IP gets the whole server rate-limited by WhatsApp, after which new scans
 * silently never complete. The user restarts pairing with POST /connect.
 */
const MAX_QR_CYCLES = 5;

/**
 * How long to offer a "link with phone number" code before asking for a new one.
 *
 * Bounded by the socket, not by WhatsApp: Baileys runs the pairing-ref rotation
 * on a timer that `requestPairingCode` does not cancel (first ref ~60s, each
 * subsequent one ~20s), and when the refs run out it ends the connection — which
 * takes the code's ephemeral keypair with it. Two minutes stays comfortably
 * inside that budget, so the countdown on screen means what it says.
 */
const PAIRING_CODE_TTL_MS = 120_000;

/** How long to wait for a socket that is ready to accept a pairing request. */
const PAIRABLE_TIMEOUT_MS = 25_000;

export interface ConnectionError {
  statusCode?: number;
  reason?: string;
  message?: string;
}

/** A live "link with phone number" code, as handed to the UI. */
export interface PairingCode {
  code: string;
  /** Digits only, no `+` — the number the code was issued for. */
  phone: string;
  expiresAt: Date;
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
  /** Consecutive QR pairing cycles with no successful scan. Reset on a fresh connect or on open. */
  qrCycles: number;
  /**
   * The live "link with phone number" code, when the user chose that route
   * instead of scanning. Bound to this socket's ephemeral keypair, so it dies
   * with the connection — cleared on both close and open.
   */
  pairing: PairingCode | null;
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
        qrCycles: 0,
        pairing: null,
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

  /**
   * True once pairing has given up: enough QR codes expired unscanned that the
   * session stopped generating new ones.
   *
   * Without this the idle state is invisible — the client polls a disconnected
   * status with a null QR forever, which on screen is a blank box that never
   * explains itself and never recovers. That is the "QR went dead silently"
   * failure. Surfacing it lets the UI say what happened and offer the one action
   * that fixes it.
   */
  isPairingIdle(tenantId: string): boolean {
    const s = this.sessions.get(tenantId);
    if (!s) return false;
    return s.status !== 'connected' && s.qr === null && s.qrCycles >= MAX_QR_CYCLES;
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

  /**
   * The live pairing code, or null once it has expired or the socket that
   * issued it went away.
   */
  getPairingCode(tenantId: string): PairingCode | null {
    const s = this.sessions.get(tenantId);
    if (!s?.pairing) return null;
    if (s.pairing.expiresAt.getTime() <= Date.now()) {
      s.pairing = null;
      return null;
    }
    return s.pairing;
  }

  /**
   * Link a number without a QR code — WhatsApp's "Link with phone number".
   *
   * A QR is useless to anyone running this CRM on the phone they want to link:
   * you cannot scan a code with the same screen that is displaying it, and a
   * second device is not something a small business always has to hand. This is
   * the same pairing handshake, keyed on an 8-character code the user types into
   * WhatsApp instead.
   *
   * The code is bound to the ephemeral keypair of the socket that issued it, so
   * it is worthless after a reconnect — hence it lives on the session rather
   * than in the database, and is cleared whenever the connection changes state.
   */
  async requestPairingCode(tenantId: string, rawPhone: string): Promise<PairingCode> {
    const phone = String(rawPhone ?? '').replace(/\D/g, '');
    // E.164 allows 15 digits; below 8 is not a dialable international number.
    if (phone.length < 8 || phone.length > 15) {
      throw new Error('INVALID_PHONE');
    }

    const s = this.ensure(tenantId);
    if (s.status === 'connected') throw new Error('ALREADY_CONNECTED');

    // Reuse the socket already offering a QR when there is one: it has finished
    // its handshake and is waiting to be paired, which is exactly what this
    // needs. Tearing it down to build an identical one only adds a round trip
    // and another entry in WhatsApp's rate limiter.
    const usable = s.sock && !s.sock.authState?.creds?.registered;
    if (!usable) {
      await runWithTenant(tenantId, () => clearDbAuthState(s.sessionId));
      s.qrCycles = 0;
      await this.connect(tenantId);
    }

    const sock = await this.waitForPairable(s);
    const code: string = await sock.requestPairingCode(phone);

    s.pairing = { code, phone, expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS) };
    // The code supersedes the QR. Leaving both on screen invites the user to
    // keep trying the one that cannot work on the device in their hand.
    this.clearQr(s);
    logger.info('wa.pairing_code_issued', { tenantId, phone: `***${phone.slice(-4)}` });
    runWithTenant(tenantId, () =>
      emitRealtime('wa:pairing-code', { code, phone, expiresAt: s.pairing!.expiresAt.toISOString() }),
    );

    return s.pairing;
  }

  /**
   * Wait for a socket that can actually accept a pairing request.
   *
   * `requestPairingCode` writes an IQ node straight to the websocket. Called
   * before the transport handshake finishes it does not throw — it silently
   * never resolves, which on screen is a spinner that runs until the user gives
   * up. A QR having arrived is proof the socket got far enough to pair.
   */
  private async waitForPairable(s: TenantSession, timeoutMs = PAIRABLE_TIMEOUT_MS): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (s.status === 'connected') throw new Error('ALREADY_CONNECTED');
      const sock = s.sock;
      if (sock && !sock.authState?.creds?.registered && (s.qr || sock.ws?.isOpen)) return sock;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('PAIRING_TIMEOUT');
  }

  private clearPairing(s: TenantSession): void {
    if (!s.pairing) return;
    s.pairing = null;
    runWithTenant(s.tenantId, () => emitRealtime('wa:pairing-code', { code: null }));
  }

  private clearQr(s: TenantSession): void {
    s.qr = null;
    runWithTenant(s.tenantId, () => emitRealtime('wa:qr', { qr: null }));
  }

  async connect(tenantId: string, fromRetry = false): Promise<any> {
    const s = this.ensure(tenantId);
    if (s.sock && s.status === 'connected') return s.sock;
    if (s.connectInFlight) return s.connectInFlight;
    // A fresh connect (boot for a paired number, or the user pressing "connect")
    // restarts the pairing budget; an internal QR-timeout retry does not — that
    // is what keeps an unwatched QR from looping forever.
    if (!fromRetry) s.qrCycles = 0;

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
      // A live pairing code means the user is linking by typing, on a device
      // that by definition cannot scan. Baileys keeps rotating QRs regardless;
      // surfacing them would swap the code out from under them mid-entry.
      if (this.getPairingCode(s.tenantId)) return;
      logger.info('WhatsApp QR code received', { tenantId: s.tenantId });
      s.qr = qr;
      emitRealtime('wa:qr', { qr });
    }

    if (connection === 'close') {
      // Captured before the teardown below clears them.
      const hadPairingCode = Boolean(s.pairing);
      const registered = Boolean(s.sock?.authState?.creds?.registered);
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

      // `lastError` answers "why did my connection break", which is a question
      // that only exists once there was a connection to break. Before pairing
      // completes, every close here is part of the pairing dance — a QR cycle
      // ending, the socket recycling between codes — and surfacing those made
      // the settings page show a permanent red "Something went wrong" to users
      // whose only crime was not having linked a number yet.
      s.lastError = registered
        ? { statusCode: disconnectStatus, reason: boomData?.reason, message: errorMessage }
        : null;
      logger.warn('WhatsApp connection closed', {
        tenantId: s.tenantId,
        shouldReconnect,
        isAuthFailure,
        registered,
        error: errorMessage,
      });

      this.clearQr(s);
      // The code was keyed to this socket's ephemeral keypair — it is dead now,
      // and leaving it on screen means the user types a code that cannot work.
      this.clearPairing(s);
      s.status = 'disconnected';
      emitRealtime('wa:status', { status: 'disconnected' });

      s.sock = null;
      s.connectInFlight = null;
      s.connectedAt = null;

      if (loggedOut || isAuthFailure) {
        void clearDbAuthState(s.sessionId);
        return;
      }

      // A pairing code was outstanding and never completed.
      //
      // `requestPairingCode` stamps `creds.me` the moment it issues a code, and
      // Baileys chooses login-vs-register on `creds.me` ALONE — it never looks
      // at `registered`. So the credentials left behind by an abandoned code
      // attempt make every subsequent connect try to log in as an identity that
      // was never registered, which fails auth every time. Wiping them here
      // means the retry pairs cleanly instead of burning failed logins against
      // WhatsApp, which is precisely what attracts a rate limit.
      if (hadPairingCode && !registered) {
        logger.info('wa.pairing_code_abandoned', { tenantId: s.tenantId });
        void clearDbAuthState(s.sessionId);
      }

      // A QR that expired unscanned ("QR refs attempts ended") means nobody was
      // there to link. Offer a few fresh codes for an active user, then STOP —
      // an endless pairing loop run from one IP gets the server rate-limited by
      // WhatsApp, after which scans silently never complete. Real disconnects of
      // a paired session (any other reason) always reconnect.
      const isQrTimeout = /QR refs attempts ended/i.test(errorMessage);
      if (isQrTimeout) {
        s.qrCycles += 1;
        if (s.qrCycles >= MAX_QR_CYCLES) {
          logger.info('wa.pairing_idle', {
            tenantId: s.tenantId,
            cycles: s.qrCycles,
            hint: 'no scan across QR cycles — idling; POST /connect to retry',
          });
          return;
        }
      } else {
        s.qrCycles = 0;
      }

      // Avoid tight reconnect loops; retry this tenant after a short backoff.
      s.reconnectTimer = setTimeout(() => {
        void this.connect(s.tenantId, true);
      }, 3000);
    } else if (connection === 'open') {
      logger.info('WhatsApp connected', { tenantId: s.tenantId });
      this.clearQr(s);
      this.clearPairing(s);
      s.status = 'connected';
      s.lastError = null;
      s.connectedAt = new Date();
      s.qrCycles = 0;
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
      select: { tenantId: true, data: true },
    });
    // Only reconnect sessions that actually FINISHED pairing. An empty/pending
    // row must never auto-connect: at boot it would spin up a perpetual pairing
    // loop for a number nobody is currently linking — the exact behaviour that
    // gets the server rate-limited by WhatsApp.
    //
    // `creds.me.id` alone is NOT proof of that. `requestPairingCode` stamps
    // `me.id` the moment a code is issued, minutes before the user types it in —
    // so an abandoned "link with phone number" attempt used to look identical to
    // a linked account here. `registered` is the flag Baileys sets only once
    // pairing completes.
    const tenantIds = stored
      .filter((r) => {
        const creds = (r.data as any)?.creds;
        return Boolean(creds?.registered) && Boolean(creds?.me?.id);
      })
      .map((r) => r.tenantId)
      .filter((id): id is string => Boolean(id));
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
