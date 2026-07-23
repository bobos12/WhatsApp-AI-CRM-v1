/**
 * Tenant-aware WhatsApp client facade.
 *
 * Historically this module held a single process-wide Baileys socket (`let sock`).
 * It is now a thin wrapper over the SessionManager pool (session-manager.ts),
 * which runs one socket per tenant. Every function resolves the tenant from the
 * ambient context (lib/tenant-context.ts): callers that already run inside a
 * request or a `runWithTenant()` job keep working unchanged.
 */
import { getTenantId, requireTenantId } from '../lib/tenant-context';
import { sessionManager, type WaStatus, type ConnectionError } from './session-manager';

/** Connect (or return) the current tenant's WhatsApp socket. */
export async function connectToWhatsApp(tenantId: string = requireTenantId()) {
  return sessionManager.connect(tenantId);
}

/** Disconnect and log out the current tenant's WhatsApp socket. */
export async function disconnectWhatsApp(tenantId: string = requireTenantId()) {
  return sessionManager.disconnect(tenantId);
}

/** The current tenant's live socket, or null when not connected / no tenant. */
export function getSock(tenantId: string | null = getTenantId()): any {
  return tenantId ? sessionManager.getSock(tenantId) : null;
}

export function getWaStatus(tenantId: string | null = getTenantId()): WaStatus {
  return tenantId ? sessionManager.getStatus(tenantId) : 'disconnected';
}

export function getCurrentQR(tenantId: string | null = getTenantId()): string | null {
  return tenantId ? sessionManager.getQR(tenantId) : null;
}

export function getLastError(tenantId: string | null = getTenantId()): ConnectionError | null {
  return tenantId ? sessionManager.getLastError(tenantId) : null;
}

export function getConnectedAt(tenantId: string | null = getTenantId()): Date | null {
  return tenantId ? sessionManager.getConnectedAt(tenantId) : null;
}

export function getSessionId(tenantId: string | null = getTenantId()): string {
  if (!tenantId) return String(process.env.WHATSAPP_SESSION_ID || 'default').trim();
  return sessionManager.getSessionId(tenantId);
}

/**
 * The key the tenant's `WhatsAppSession` ROW is stored under — always
 * `wa_<tenantId>`, never the live JID.
 *
 * `getSessionId()` above returns the connected account's JID once a socket is
 * up, which is right for tagging messages but wrong for finding the auth row:
 * the row is keyed by tenant, so every JID-keyed lookup (connection status,
 * the warm-up gate) silently missed it and behaved as if no session existed.
 * Anything that reads or deletes the row must use this.
 */
export function getAuthSessionId(tenantId: string | null = getTenantId()): string | null {
  return tenantId ? `wa_${tenantId}` : null;
}

/**
 * The connected account's own number in E.164, or null when not connected.
 * Local-number imports use this to infer their default region.
 */
export function getConnectedNumber(tenantId: string | null = getTenantId()): string | null {
  return tenantId ? sessionManager.getConnectedNumber(tenantId) : null;
}

export async function getWhatsAppProfilePictureUrl(
  phone: string,
  tenantId: string | null = getTenantId(),
): Promise<string | null> {
  if (!tenantId) return null;
  return sessionManager.getProfilePictureUrl(tenantId, phone);
}
