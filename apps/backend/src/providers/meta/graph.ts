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
  0:      { kind: 'AUTH', retryable: false, userMessage: 'WhatsApp rejected the stored credentials. Re-enter your access token in Settings.' },
  190:    { kind: 'AUTH', retryable: false, userMessage: 'Your WhatsApp access token has expired. Generate a new permanent token and re-enter it in Settings.' },
  10:     { kind: 'AUTH', retryable: false, userMessage: 'This token is missing a permission WhatsApp requires (whatsapp_business_messaging).' },
  200:    { kind: 'AUTH', retryable: false, userMessage: 'Meta is not letting this WhatsApp account send messages yet. A manager can see why in Settings → WhatsApp → Connection health.' },

  131047: { kind: 'TEMPLATE_REQUIRED', retryable: false, userMessage: 'This contact last messaged you more than 24 hours ago, so WhatsApp only allows an approved template message.' },
  131051: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'That message type is not supported for this recipient.' },

  131026: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'This number cannot receive WhatsApp messages. It may not be registered on WhatsApp.' },
  131052: { kind: 'UNDELIVERABLE', retryable: false, userMessage: 'The media could not be downloaded by WhatsApp.' },

  131049: { kind: 'NOT_DELIVERED', retryable: false, userMessage: 'WhatsApp chose not to deliver this marketing message to protect the recipient’s experience. It will count as failed, not as a violation.' },
  131048: { kind: 'RATE_LIMITED', retryable: true, userMessage: 'WhatsApp has temporarily limited sending from this number because of spam signals. Sending will resume automatically.' },
  131056: { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Too many messages to this contact in a short period. Retrying shortly.' },
  80007:  { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Your WhatsApp account hit its rate limit. Sending will resume automatically.' },
  4:      { kind: 'RATE_LIMITED', retryable: true, userMessage: 'Too many API requests. Retrying shortly.' },

  132000: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'The number of variables supplied does not match the approved template.' },
  132001: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'That template does not exist for this language, or has not been approved yet.' },
  132005: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'The filled-in template is longer than WhatsApp allows. Shorten the variable values.' },
  132007: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'A variable value breaks WhatsApp’s formatting rules (no new lines, tabs, or 4+ consecutive spaces).' },
  132012: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'A variable value does not match the format the template expects.' },
  132015: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'WhatsApp paused this template because of poor recipient feedback. Edit it or use another.' },
  132016: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'WhatsApp disabled this template. It can no longer be sent.' },
  132068: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'This flow template is paused.' },
  132069: { kind: 'TEMPLATE_ERROR', retryable: false, userMessage: 'This flow template is unavailable.' },

  368:    { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'This account is temporarily blocked by Meta for policy violations.' },
  131031: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'Your WhatsApp Business account has been locked by Meta. Check WhatsApp Manager for details.' },
  133010: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'This phone number is not registered on the WhatsApp Business platform.' },
  133016: { kind: 'ACCOUNT_RESTRICTED', retryable: false, userMessage: 'This number is rate-limited by Meta after too many registration attempts.' },

  100:    { kind: 'BAD_REQUEST', retryable: false, userMessage: 'WhatsApp rejected the request as malformed.' },
  131008: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'A required field was missing from the request.' },
  131009: { kind: 'BAD_REQUEST', retryable: false, userMessage: 'A field value is not accepted by WhatsApp.' },

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
      if (attempt === maxAttempts) {
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
  return new MetaApiError({
    code: -1,
    message: err instanceof Error ? err.message : String(err),
    httpStatus: 500,
  });
}
