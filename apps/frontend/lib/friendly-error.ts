/**
 * friendly-error — turns raw backend/network errors into a small, stable set of
 * human-friendly "causes" the UI can explain and act on.
 *
 * The classifier is pure (no i18n/React) so it can be reused anywhere. It returns
 * a stable `code` plus interpolation `values`; the <FriendlyError> component maps
 * that code to a localized title/body/action. The server's structured `code` is
 * trusted first; matching on the message text is the fallback for errors that
 * carry none.
 */

export type FriendlyCode =
  | 'whatsappDisconnected'
  | 'notOnWhatsapp'
  | 'invalidPhone'
  | 'emptyMessage'
  | 'warmupLimit'
  | 'tooManyRecipients'
  | 'rateLimited'
  | 'mediaFailed'
  | 'auth'
  | 'network'
  | 'whatsappBlocked'
  | 'needsTemplate'
  | 'templateProblem'
  | 'accountRestricted'
  | 'whatsappBusy'
  | 'notDelivered'
  | 'managerOnly'
  | 'notSetUp'
  | 'generic';

export type FriendlySeverity = 'error' | 'warning' | 'info';

export interface ClassifiedError {
  code: FriendlyCode;
  severity: FriendlySeverity;
  /** Interpolation values for the localized body (e.g. { phone, limit, sent, max }). */
  values: Record<string, string | number>;
  /** The original technical message, kept for an optional "details" disclosure. */
  raw: string;
}

/** Pull message / HTTP status out of the many error shapes we throw or receive. */
function unpack(err: unknown): { message: string; status?: number; code?: string } {
  if (err == null) return { message: '' };
  if (typeof err === 'string') return { message: err };
  const anyErr = err as Record<string, any>;
  const message: string =
    (typeof anyErr.raw === 'string' && anyErr.raw) ||
    (typeof anyErr.message === 'string' && anyErr.message) ||
    (typeof anyErr?.data?.error === 'string' && anyErr.data.error) ||
    (typeof anyErr?.error === 'string' && anyErr.error) ||
    String(err);
  const status: number | undefined =
    typeof anyErr.status === 'number' ? anyErr.status
    : typeof anyErr?.data?.status === 'number' ? anyErr.data.status
    : undefined;
  const code: string | undefined =
    (typeof anyErr.code === 'string' && anyErr.code) ||
    (typeof anyErr?.data?.code === 'string' && anyErr.data.code) ||
    undefined;
  return { message, status, code };
}

/** Server error codes (see backend HttpError / MetaApiError kinds) → friendly cause. */
const CODE_TO_FRIENDLY: Record<string, [FriendlyCode, FriendlySeverity]> = {
  META_AUTH: ['whatsappBlocked', 'error'],
  META_TEMPLATE_REQUIRED: ['needsTemplate', 'warning'],
  TEMPLATE_REQUIRED: ['needsTemplate', 'warning'],
  CAMPAIGN_NOT_READY: ['templateProblem', 'warning'],
  PHONE_INVALID: ['invalidPhone', 'warning'],
  PHONE_COUNTRY_REQUIRED: ['invalidPhone', 'warning'],
  META_UNDELIVERABLE: ['notOnWhatsapp', 'warning'],
  META_NOT_DELIVERED: ['notDelivered', 'warning'],
  META_RATE_LIMITED: ['rateLimited', 'warning'],
  META_TEMPLATE_ERROR: ['templateProblem', 'warning'],
  META_ACCOUNT_RESTRICTED: ['accountRestricted', 'error'],
  META_TRANSIENT: ['whatsappBusy', 'warning'],
  MANAGER_ONLY: ['managerOnly', 'info'],
  CLOUD_API_NOT_CONFIGURED: ['notSetUp', 'error'],
  NO_TENANT: ['notSetUp', 'error'],
  WARMUP_DAILY_LIMIT: ['warmupLimit', 'warning'],
};

/**
 * Key under `errors:plain.*` for a one-line, jargon-free version of a server
 * error, or null when the server's own message is already fit to show. Used by
 * lib/api.ts so every `error.message` in the app reads like a person wrote it.
 */
export function plainKeyFor(code: string | undefined, status: number | undefined): string | null {
  const byCode: Record<string, string> = {
    META_AUTH: 'whatsappBlocked',
    META_TEMPLATE_REQUIRED: 'needsTemplate',
    TEMPLATE_REQUIRED: 'needsTemplate',
    CAMPAIGN_NOT_READY: 'templateProblem',
    PHONE_INVALID: 'invalidPhone',
    PHONE_COUNTRY_REQUIRED: 'invalidPhone',
    META_UNDELIVERABLE: 'notOnWhatsapp',
    META_NOT_DELIVERED: 'notDelivered',
    META_RATE_LIMITED: 'rateLimited',
    META_TEMPLATE_ERROR: 'templateProblem',
    META_ACCOUNT_RESTRICTED: 'accountRestricted',
    META_TRANSIENT: 'whatsappBusy',
    MANAGER_ONLY: 'managerOnly',
    CLOUD_API_NOT_CONFIGURED: 'notSetUp',
    NO_TENANT: 'notSetUp',
    ENCRYPTION_NOT_CONFIGURED: 'serverNotReady',
    FILE_TOO_LARGE: 'fileTooLargeGeneric',
  };
  if (code && byCode[code]) return byCode[code];
  // An unexplained server crash: its text is a stack-trace fragment at best.
  if (!code && status !== undefined && status >= 500) return 'server';
  return null;
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1];
}

/**
 * Fingerprint a raw error into a friendly cause. Order matters — the most specific
 * / most actionable causes are checked first.
 */
export function classifyError(err: unknown): ClassifiedError {
  const { message, status, code } = unpack(err);
  const raw = message || '';
  const lower = raw.toLowerCase();
  const values: Record<string, string | number> = {};

  // The server names the cause outright; that beats any guess from the wording.
  const fromCode = code ? CODE_TO_FRIENDLY[code] : undefined;
  if (fromCode) return { code: fromCode[0], severity: fromCode[1], values, raw };

  // Warm-up daily limit — a "good news" throttle, not a real failure.
  if (code === 'WARMUP_DAILY_LIMIT' || /warm[\s-]?up|daily (warm|limit)/.test(lower)) {
    const pair = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (pair) { values.sent = Number(pair[1]); values.limit = Number(pair[2]); }
    return { code: 'warmupLimit', severity: 'warning', values, raw };
  }

  // Session / auth expiry. (A 403 that means "not allowed" carries MANAGER_ONLY
  // and was handled above — only an unexplained one lands here.)
  if (status === 401 || status === 403 || /unauthor|forbidden|authentication required|not authorized|session expired/.test(lower)) {
    return { code: 'auth', severity: 'error', values, raw };
  }

  // Number simply isn't on WhatsApp.
  if (/not (available )?on whatsapp|isn'?t on whatsapp|no whatsapp account/.test(lower)) {
    const phone = firstMatch(raw, /Recipient\s+(.+?)\s+is not/i) || firstMatch(raw, /([+\d][\d\s()-]{5,})/);
    if (phone) values.phone = phone.trim();
    return { code: 'notOnWhatsapp', severity: 'warning', values, raw };
  }

  // WhatsApp session not connected / lost — the #1 cause of "everything failed".
  if (
    status === 503 ||
    /not connected|connection lost|connection failure|reconnect|session invalid|not currently connected|no active session/.test(lower)
  ) {
    return { code: 'whatsappDisconnected', severity: 'error', values, raw };
  }

  // Bad phone format.
  if (/invalid phone|invalid recipient|invalid number|phone number looks/.test(lower)) {
    return { code: 'invalidPhone', severity: 'warning', values, raw };
  }

  // Empty payload.
  if (/message cannot be empty|content or payload|nothing to send|empty message/.test(lower)) {
    return { code: 'emptyMessage', severity: 'warning', values, raw };
  }

  // Over the per-send recipient cap.
  if (/maximum .* recipients|too many recipients|recipients per send/.test(lower)) {
    const max = firstMatch(raw, /maximum\s+(\d+)/i);
    if (max) values.max = Number(max);
    return { code: 'tooManyRecipients', severity: 'warning', values, raw };
  }

  // Rate limited (anti-ban pacing).
  if (status === 429 || /rate limit|too many requests|slow down/.test(lower)) {
    return { code: 'rateLimited', severity: 'warning', values, raw };
  }

  // Attachment upload / fetch problems.
  if (/upload failed|media|attachment|file (fetch|download)|failed to fetch media/.test(lower)) {
    return { code: 'mediaFailed', severity: 'warning', values, raw };
  }

  // Transport-level failure (backend down, offline).
  if (/network|failed to fetch|load failed|networkerror|err_connection|fetch failed/.test(lower)) {
    return { code: 'network', severity: 'error', values, raw };
  }

  return { code: 'generic', severity: 'error', values, raw };
}

/**
 * Given a list of raw per-recipient error messages (e.g. the `errors[]` a bulk send
 * returns), group them by friendly cause and count each. Used to render a compact
 * "why did N fail" breakdown instead of a wall of duplicate strings.
 */
export function groupErrors(rawErrors: string[]): Array<{ code: FriendlyCode; count: number; sample: ClassifiedError }> {
  const buckets = new Map<FriendlyCode, { count: number; sample: ClassifiedError }>();
  for (const raw of rawErrors) {
    const classified = classifyError(raw);
    const existing = buckets.get(classified.code);
    if (existing) existing.count += 1;
    else buckets.set(classified.code, { count: 1, sample: classified });
  }
  return Array.from(buckets.entries())
    .map(([code, { count, sample }]) => ({ code, count, sample }))
    .sort((a, b) => b.count - a.count);
}
