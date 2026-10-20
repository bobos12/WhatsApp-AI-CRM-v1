// ─────────────────────────────────────────────────────────────────────────────
// "Can this number send right now?" — for the app-wide banner.
//
// Meta stops a WABA from sending when its billing breaks (an unpaid balance, a
// partner credit line that was withdrawn) or when the app loses permission. The
// only signal is the error on a send: #200/#10 "no permission to send on behalf
// of this WhatsApp Business Account", or 131042 "payment issue". Without this
// the team only found out from a stalled campaign and a call to the admin.
//
// State is per tenant and in memory: marked the moment a real send is refused,
// cleared by the next successful send, and otherwise re-checked with Meta's
// cheap send-permission probe at most every 10 minutes.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../lib/logger';
import type { MetaApiError } from './graph';
import { lastProbeRefusal, numberHealth, probeSendPermission } from './onboarding';

export type SendingBlockReason = 'BILLING_OR_PERMISSION' | 'PAYMENT_FAILED';

export interface SendingStatus {
  blocked: boolean;
  reason?: SendingBlockReason;
  /** Meta's own words, for support and for the curious. */
  message?: string;
  since?: string;
  checkedAt: string;
}

interface State { blocked: boolean; reason?: SendingBlockReason; message?: string; since?: number; checkedAt: number }

const PROBE_EVERY_MS = 10 * 60 * 1000;
/** A payment failure isn't visible to the probe; let it lapse so a real send can re-confirm it. */
const PAYMENT_STICKY_MS = 30 * 60 * 1000;
const FRESH_MIN_GAP_MS = 30 * 1000;

const states = new Map<string, State>();

function block(tenantId: string, reason: SendingBlockReason, message: string | undefined) {
  const prev = states.get(tenantId);
  if (!prev?.blocked) logger.error('meta.sending_blocked', { tenantId, reason, message });
  states.set(tenantId, {
    blocked: true,
    reason,
    message,
    since: prev?.blocked ? prev.since : Date.now(),
    checkedAt: Date.now(),
  });
}

function clear(tenantId: string) {
  const prev = states.get(tenantId);
  if (prev?.blocked) logger.info('meta.sending_unblocked', { tenantId, reason: prev.reason });
  states.set(tenantId, { blocked: false, checkedAt: Date.now() });
}

/** Called on every refused send. Only account-level refusals block; per-recipient ones don't. */
export function noteSendFailure(tenantId: string | null, meta: MetaApiError): void {
  if (!tenantId) return;
  if (meta.code === 200 || meta.code === 10) block(tenantId, 'BILLING_OR_PERMISSION', meta.message);
  else if (meta.code === 131042) block(tenantId, 'PAYMENT_FAILED', meta.message);
}

/** Called on every accepted send: proof the account can send. */
export function noteSendOk(tenantId: string | null): void {
  if (!tenantId) return;
  if (states.get(tenantId)?.blocked) clear(tenantId);
}

export async function getSendingStatus(
  tenantId: string,
  cloud: { accessToken: string; phoneNumberId: string },
  opts: { fresh?: boolean } = {},
): Promise<SendingStatus> {
  const now = Date.now();
  let s = states.get(tenantId);
  const age = s ? now - s.checkedAt : Infinity;
  const due = opts.fresh ? age > FRESH_MIN_GAP_MS : age > PROBE_EVERY_MS;

  if (due) {
    const probe = await probeSendPermission(cloud.accessToken, cloud.phoneNumberId);
    if (probe === 'not_registered') {
      block(tenantId, 'BILLING_OR_PERMISSION', lastProbeRefusal(cloud.phoneNumberId));
    } else if (probe === 'ok') {
      const keepPayment = s?.blocked && s.reason === 'PAYMENT_FAILED' && now - (s.since ?? 0) < PAYMENT_STICKY_MS && !opts.fresh;
      if (keepPayment) states.set(tenantId, { ...s!, checkedAt: now });
      else clear(tenantId);
    } else if (s) {
      // Token problem or Meta unreachable: not a billing block — keep what we knew.
      states.set(tenantId, { ...s, checkedAt: now });
    } else {
      states.set(tenantId, { blocked: false, checkedAt: now });
    }
    s = states.get(tenantId);
  }

  return {
    blocked: Boolean(s?.blocked),
    ...(s?.blocked ? { reason: s.reason, message: s.message, since: s.since ? new Date(s.since).toISOString() : undefined } : {}),
    checkedAt: new Date(s?.checkedAt ?? now).toISOString(),
  };
}

/**
 * The Meta business that owns the number — so "Pay in Meta" opens billing in
 * the right business for people who belong to several. Rarely changes; cached.
 */
const businessIds = new Map<string, { id: string | null; at: number }>();
export async function owningBusinessId(cloud: { accessToken: string; phoneNumberId: string }): Promise<string | null> {
  const hit = businessIds.get(cloud.phoneNumberId);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.id;
  try {
    const health = await numberHealth(cloud.accessToken, cloud.phoneNumberId);
    businessIds.set(cloud.phoneNumberId, { id: health.businessId, at: Date.now() });
    return health.businessId;
  } catch {
    // Without it the links still open billing, just in the user's default business.
    businessIds.set(cloud.phoneNumberId, { id: hit?.id ?? null, at: Date.now() - 5 * 60 * 60 * 1000 });
    return hit?.id ?? null;
  }
}
