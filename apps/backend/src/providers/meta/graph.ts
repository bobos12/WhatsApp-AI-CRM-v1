import { logger } from '../../lib/logger';

/**
 * Thin, typed client for Meta's Graph API.
 *
 * The value here is not the HTTP call — it is the error mapping below. Meta
 * reports every failure as an opaque numeric code, and the difference between
 * "this will work if you retry in a minute", "this will never work until the
 * tenant re-authorises", and "this needs a template instead" is entirely in that
 * code. Collapsing them into `Error(message)` is what turns a Cloud API
 * integration into a black box that support cannot debug, so each one is
 * translated into an outcome the caller and the tenant can act on.
 */

/** Pinned deliberately. Graph is versioned and unpinned calls break on Meta's schedule. */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What the caller should do about a failure. */
export type MetaFailureKind =
  /** Credentials are invalid or expired — the tenant must re-authorise. */
  | 'AUTH'
  /** Outside the 24h window; only an approved template will deliver. */
  | 'TEMPLATE_REQUIRED'
  /** Meta declined to deliver (per-user marketing cap, quality throttle). */
  | 'NOT_DELIVERED'
  /** Recipient cannot receive: not on WhatsApp, or blocked. */
  | 'UNDELIVERABLE'
  /** Rate or spam limit — back off and retry later. */
  | 'RATE_LIMITED'
  /** Something about the template itself is wrong or it is paused. */
  | 'TEMPLATE_ERROR'
  /** The number or business is restricted/locked by Meta. */
  | 'ACCOUNT_RESTRICTED'
  /** Malformed request — a bug on our side, not the tenant's. */
  | 'BAD_REQUEST'
  /** Meta-side fault or network failure; safe to retry. */
  | 'TRANSIENT'
  | 'UNKNOWN';

interface MetaErrorMapping {
  kind: MetaFailureKind;
  retryable: boolean;
  /** Written for the person using the CRM, not the developer reading logs. */
  userMessage: string;
}

/**
 * Meta error codes worth distinguishing. Anything unlisted degrades to UNKNOWN
 * (non-retryable) so a new code surfaces loudly rather than being silently
 * retried forever.
 */
const ERROR_MAP: Record<number, MetaErrorMapping> = {
  0:      { kind: 'AUTH', retryable: false, userMessage: 'The WhatsApp connection stopped working. A manager needs to reconnect it in Settings → WhatsApp.' },
  190:    { kind: 'AUTH', retryable: false, userMessage: 'The WhatsApp connection has expired. A manager needs to reconnect it in Settings → WhatsApp.' },
  10:     { kind: 'AUTH', retryable: false, userMessage: 'The WhatsApp connection is missing a permission. A manager needs to reconnect it in Settings → WhatsApp.' },
  200:    { kind: 'AUTH', retryable: false, userMessage: 'Meta is not letting this WhatsApp account send messages yet. A manager can see why in Settings → WhatsApp → Connection health.' },

  131047: { kind: 'TEMPLATE_REQUIRED', retryable: false, userMessage: 'This contact last messaged you more than 24 hours ago, so WhatsApp only allows an approved template message.' },
  131051: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'This kind of message can’t be sent to this contact on WhatsApp.' },

  131026: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'This number cannot receive WhatsApp messages. It may not be registered on WhatsApp.' },
  131052: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'WhatsApp couldn’t open the attached file. Try attaching it again.' },

  131050: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'This person turned off marketing messages from businesses on WhatsApp. They won’t be sent campaigns again.' },
  130472: { kind: 'NOT_DELIVERED', retryable: false, userMessage: 'WhatsApp held this marketing message back for this number as part of a Meta experiment. Nothing is wrong on your side.' },
  131021: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'This is your own business number, so WhatsApp can’t message it.' },
  131049: { kind: 'NOT_DELIVERED', retryable: false, userMessage: 'WhatsApp chose not to deliver this marketing message to protect the recipient’s experience. It will count as failed, not as a violation.' },
  131048: { kind: 'RATE_LIMITED', retryable: true, userMessage: 'WhatsApp has temporarily limited sending from this number because of spam signals. Sending will resume automatically.' },
  131056: { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Too many messages to this contact in a short period. Retrying shortly.' },
  130429: { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Sending faster than WhatsApp allows. Sending will continue automatically.' },
  80007:  { kind: 'RATE_LIMITED', retryable: true, userMessage: 'WhatsApp asked us to slow down. Sending will continue automatically.' },
  4:      { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Sending a little too fast. Trying again in a moment.' },

  132000: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'This template needs a different number of filled-in values. Check the template’s blanks and try again.' },
  132001: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'That template does not exist for this language, or has not been approved yet.' },
  132005: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'The message is longer than WhatsApp allows. Shorten the filled-in values and try again.' },
  132007: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'A filled-in value has line breaks or too many spaces, which WhatsApp doesn’t allow. Shorten or tidy it and try again.' },
  132012: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'A filled-in value doesn’t match what this template expects. Check it and try again.' },
  132015: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'WhatsApp paused this template because of poor recipient feedback. Edit it or use another.' },
  132016: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'WhatsApp disabled this template. It can no longer be sent.' },
  132068: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'This template is paused by WhatsApp. Try another template.' },
  132069: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'This template isn’t available right now. Try another template.' },

  131042: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Meta could not charge the payment method on your WhatsApp account. A manager needs to fix billing in WhatsApp Manager → Payment settings.' },
  131045: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Your WhatsApp number is not fully registered yet. A manager can check Settings → WhatsApp.' },
  131057: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Your WhatsApp Business account is in maintenance mode. Sending will resume once Meta finishes.' },
  131037: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Meta has not approved your business display name yet, so the number can’t send. Check WhatsApp Manager.' },
  368:    { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'This account is temporarily blocked by Meta for policy violations.' },
  131031: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Your WhatsApp Business account has been locked by Meta. Check WhatsApp Manager for details.' },
  133010: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Your WhatsApp number isn’t fully set up with WhatsApp yet. A manager can check Settings → WhatsApp.' },
  133016: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Too many attempts to set up this number. WhatsApp asks you to wait before trying again.' },

  100:    { kind: 'BAD_REQUEST', retryable: false, userMessage: 'WhatsApp couldn’t accept this message. Please try again — if it keeps happening, let a manager know.' },
  131008: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'Some information is missing from this message. Check it and try again.' },
  131009: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'Part of this message isn’t accepted by WhatsApp. Check it and try again.' },

  1:      { kind: 'TRANSIENT', retryable: true, userMessage: 'WhatsApp had a temporary problem. Retrying.' },
  2:      { kind: 'TRANSIENT', retryable: true, userMessage: 'WhatsApp is temporarily unavailable. Retrying.' },
  131000: { kind: 'TRANSIENT', retryable: true, userMessage: 'WhatsApp had an internal error. Retrying.' },
  131016: { kind: 'TRANSIENT', retryable: true, userMessage: 'The WhatsApp service is temporarily unavailable. Retrying.' },
  131053: { kind: 'TRANSIENT', retryable: true, userMessage: 'WhatsApp could not process the media. Retrying.' },
};

export class MetaApiError extends Error {
  readonly code: number;
  readonly subcode: number | null;
  readonly kind: MetaFailureKind;
  readonly retryable: boolean;
  /** Safe to show a CRM user verbatim. */
  readonly userMessage: string;
  readonly httpStatus: number;
  /** Meta's own trace id — the only useful thing to quote in a Meta support case. */
  readonly traceId: string | null;

  constructor(params: {
    code: number;
    subcode?: number | null;
    message: string;
    httpStatus: number;
    traceId?: string | null;
    /**
     * Meta's own end-user phrasing (`error_user_msg`), when it sent one.
     * Kept separate from `message` so the constructor can tell "Meta explained
     * this specifically" from "we fell back to the developer string".
     */
    metaUserMessage?: string | null;
  }) {
    super(params.message);
    this.name = 'MetaApiError';
    this.code = params.code;
    this.subcode = params.subcode ?? null;
    this.httpStatus = params.httpStatus;
    this.traceId = params.traceId ?? null;

    const mapped = ERROR_MAP[params.code];
    const fromMeta = params.metaUserMessage?.trim() || null;

    if (mapped) {
      // `kind` and `retryable` always come from the map — they drive retry and
      // recovery behaviour and must stay deterministic per code.
      this.kind = mapped.kind;
      this.retryable = mapped.retryable;
      // …but the *wording* prefers Meta's own, which is far more specific than
      // anything a per-code table can say. Code 100 ("Invalid parameter") is the
      // clear case: the map can only manage "rejected as malformed", while Meta
      // sent "This template has too many variables for its length" — the
      // difference between a dead end and a fix. Losing that turned a solvable
      // template rejection into an unexplained one.
      this.userMessage = fromMeta ?? mapped.userMessage;
    } else if (params.httpStatus >= 500) {
      // Unmapped 5xx is still clearly Meta's side.
      this.kind = 'TRANSIENT';
      this.retryable = true;
      this.userMessage = 'WhatsApp had a temporary problem. Retrying.';
    } else {
      this.kind = 'UNKNOWN';
      this.retryable = false;
      this.userMessage = params.message || 'WhatsApp rejected this request.';
    }
  }

  /** True when the fix is "send an approved template instead". */
  get requiresTemplate(): boolean {
    return this.kind === 'TEMPLATE_REQUIRED';
  }

  /** True when the tenant must fix their credentials before anything will work. */
  get requiresReauth(): boolean {
    return this.kind === 'AUTH';
  }
}

export interface GraphRequest {
  path: string;
  accessToken: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Absolute URL instead of GRAPH_BASE + path (media downloads use a signed CDN host). */
  absoluteUrl?: string;
  /** Total attempts including the first. Only retryable failures consume one. */
  maxAttempts?: number;
  timeoutMs?: number;
  /**
   * Retry after a timeout or dropped connection. Off for message sends: Meta may
   * have accepted a request whose answer never reached us, and repeating it
   * delivers the message twice.
   */
  retryNetworkErrors?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseError(res: Response, bodyText: string): Promise<MetaApiError> {
  let parsed: any = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    /* non-JSON error body — fall through to the generic shape below */
  }

  const err = parsed?.error;
  return new MetaApiError({
    code: Number(err?.code ?? -1),
    subcode: err?.error_subcode != null ? Number(err.error_subcode) : null,
    // `error_user_msg` is Meta's own end-user phrasing and is usually the most
    // specific thing available; prefer it over the developer-facing `message`.
    message: err?.error_user_msg || err?.message || bodyText.slice(0, 300) || `Graph API error ${res.status}`,
    httpStatus: res.status,
    traceId: err?.fbtrace_id ?? null,
    // Meta sometimes pairs a short title with the message ("Parameters words
    // ratio exceeds limit" + the explanation). Both together read better than
    // either alone.
    metaUserMessage: err?.error_user_msg
      ? [err.error_user_title, err.error_user_msg].filter(Boolean).join(' — ')
      : null,
  });
}

/**
 * Perform a Graph API call, retrying only failures Meta indicates are transient.
 *
 * Retrying a non-retryable send is actively harmful on this platform: a
 * duplicate delivery is a message the customer actually receives twice and a
 * conversation the tenant is billed for twice, so the retry set is deliberately
 * narrow.
 */
export async function graphRequest<T = any>(req: GraphRequest): Promise<T> {
  const url = req.absoluteUrl ?? `${GRAPH_BASE}${req.path}`;
  const method = req.method ?? 'GET';
  const maxAttempts = req.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${req.accessToken}`,
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        signal: controller.signal,
      });

      const text = await res.text();

      if (res.ok) {
        return (text ? JSON.parse(text) : {}) as T;
      }

      const error = await parseError(res, text);
      lastError = error;

      if (!error.retryable || attempt === maxAttempts) throw error;

      // Exponential backoff. Meta's rate limits are measured over minutes, so
      // this only smooths brief spikes; sustained limiting is handled upstream by
      // the broadcast circuit breaker parking the campaign.
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      logger.warn('meta.graph_retry', {
        path: req.path,
        code: error.code,
        kind: error.kind,
        attempt,
        delayMs: delay,
      });
      await sleep(delay);
    } catch (err) {
      if (err instanceof MetaApiError) {
        if (!err.retryable || attempt === maxAttempts) throw err;
        lastError = err;
        continue;
      }

      // Network failure or timeout — indistinguishable from a Meta-side blip.
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (attempt === maxAttempts || req.retryNetworkErrors === false) {
        throw new MetaApiError({
          code: -1,
          message: isAbort
            ? `WhatsApp did not respond within ${timeoutMs / 1000}s`
            : `Could not reach WhatsApp: ${err instanceof Error ? err.message : String(err)}`,
          httpStatus: 503,
        });
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Graph request failed');
}

/** Normalise anything thrown by a Meta call into a MetaApiError. */
export function asMetaError(err: unknown): MetaApiError {
  if (err instanceof MetaApiError) return err;
  // The provider re-throws Meta failures as HttpErrors for the API layer, with
  // the original attached, so background callers can still read the code.
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (cause instanceof MetaApiError) return cause;
  return new MetaApiError({
    code: -1,
    message: err instanceof Error ? err.message : String(err),
    httpStatus: 500,
  });
}
