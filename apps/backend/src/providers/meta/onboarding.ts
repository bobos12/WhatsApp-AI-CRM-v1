import { GRAPH_BASE, asMetaError, graphRequest } from './graph';
import { logger } from '../../lib/logger';

/**
 * Guided onboarding against Meta's Graph API.
 *
 * Connecting a number used to mean copying five values out of three Meta
 * screens, pasting a webhook URL into a fourth, and then discovering at the
 * first send that one of them was wrong. Nearly all of it can be read from Meta
 * instead: the token names its app, the business's accounts list their numbers,
 * and a number's health status names the account it really belongs to.
 *
 * Every function here returns a plain-language outcome with a stable `code`, so
 * the UI can explain a failure in the user's language instead of echoing a
 * Graph error number.
 */

const REQUIRED_SCOPES = ['whatsapp_business_messaging', 'whatsapp_business_management'];

/** Fields the webhook must deliver for the inbox, receipts and template reviews to work. */
const WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  'message_template_quality_update',
  'phone_number_quality_update',
  'phone_number_name_update',
  'account_update',
];

export function webhookCallbackUrl(): string | null {
  const base = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/api/whatsapp/meta-webhook` : null;
}

/** Graph call with an app access token (`appId|appSecret`), which some endpoints require. */
async function appGraph<T = any>(
  appId: string,
  appSecret: string,
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  url.searchParams.set('access_token', `${appId}|${appSecret}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { method: init.method ?? 'GET' });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const err = new Error(body?.error?.error_user_msg || body?.error?.message || `Graph API error ${res.status}`);
    (err as any).code = body?.error?.code;
    throw err;
  }
  return body as T;
}

// ── Token ────────────────────────────────────────────────────────────────────

export interface TokenInfo {
  valid: boolean;
  appId: string | null;
  appName: string | null;
  type: string | null;
  /** Null when the token never expires. */
  expiresAt: string | null;
  missingScopes: string[];
  /** Accounts the token is explicitly limited to, when Meta says so. */
  wabaIds: string[];
  businessIds: string[];
  /** Null when no secret was supplied to check. */
  appSecretValid: boolean | null;
}

export async function inspectToken(accessToken: string, appSecret?: string | null): Promise<TokenInfo> {
  const res = await graphRequest<{ data?: any }>({
    path: `/debug_token?input_token=${encodeURIComponent(accessToken)}`,
    accessToken,
    maxAttempts: 2,
  });
  const d = res?.data ?? {};
  const scopes: string[] = d.scopes ?? [];
  const granular: Array<{ scope: string; target_ids?: string[] }> = d.granular_scopes ?? [];
  const targets = (scope: string) => granular.find((g) => g.scope === scope)?.target_ids ?? [];

  let appName: string | null = null;
  let appSecretValid: boolean | null = null;
  if (appSecret && d.app_id) {
    try {
      const app = await appGraph<{ name?: string }>(String(d.app_id), appSecret, `/${d.app_id}`, {
        params: { fields: 'id,name' },
      });
      appName = app.name ?? null;
      appSecretValid = true;
    } catch {
      appSecretValid = false;
    }
  }

  return {
    valid: Boolean(d.is_valid),
    appId: d.app_id ? String(d.app_id) : null,
    appName: appName ?? d.application ?? null,
    type: d.type ?? null,
    expiresAt: d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : null,
    missingScopes: REQUIRED_SCOPES.filter((s) => !scopes.includes(s)),
    wabaIds: [...new Set([...targets('whatsapp_business_management'), ...targets('whatsapp_business_messaging')])],
    businessIds: targets('business_management'),
    appSecretValid,
  };
}

// ── Numbers ──────────────────────────────────────────────────────────────────

export interface HealthIssue {
  code: string;
  message: string;
}

export interface DiscoveredNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  status: string | null;
  nameStatus: string | null;
  /** The account Meta's health check names as this number's owner. */
  wabaId: string | null;
  wabaName: string | null;
  businessId: string | null;
  canSend: boolean | null;
  issues: HealthIssue[];
  /** Meta's sandbox number (+1 555…): fine for trying the API, never for customers. */
  isTestNumber: boolean;
}

/**
 * Translate Meta's health-status errors into stable codes. Calling/SIP entries
 * are dropped: they concern voice calling, which this CRM does not use, and
 * listing them would make a healthy number look broken.
 */
function healthIssues(entities: any[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const e of entities ?? []) {
    for (const err of e.errors ?? []) {
      const text = `${err.error_description ?? ''} ${err.possible_solution ?? ''}`.trim();
      if (/\bSIP\b|calling/i.test(text)) continue;
      const code =
        err.error_code === 141006 || /payment method/i.test(text) ? 'PAYMENT_METHOD'
        : err.error_code === 141000 || err.error_code === 141001 ? 'NUMBER_NOT_VERIFIED'
        : /verif/i.test(text) && e.entity_type === 'BUSINESS' ? 'BUSINESS_VERIFICATION'
        : /display name|name/i.test(text) && e.entity_type === 'PHONE_NUMBER' ? 'DISPLAY_NAME'
        : 'META_' + (err.error_code ?? 'UNKNOWN');
      issues.push({ code, message: [err.error_description, err.possible_solution].filter(Boolean).join(' — ') });
    }
  }
  return issues;
}

/** Health of one number, including the account and business it really belongs to. */
export async function numberHealth(accessToken: string, phoneNumberId: string) {
  const res = await graphRequest<any>({
    path: `/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,status,name_status,health_status`,
    accessToken,
    maxAttempts: 2,
  });
  const entities: any[] = res?.health_status?.entities ?? [];
  const waba = entities.find((e) => e.entity_type === 'WABA');
  const business = entities.find((e) => e.entity_type === 'BUSINESS');
  const verdict = res?.health_status?.can_send_message;
  return {
    phoneNumberId: String(res.id ?? phoneNumberId),
    displayPhoneNumber: res.display_phone_number ?? '',
    verifiedName: res.verified_name ?? null,
    qualityRating: res.quality_rating ?? null,
    status: res.status ?? null,
    nameStatus: res.name_status ?? null,
    wabaId: waba?.id ? String(waba.id) : null,
    businessId: business?.id ? String(business.id) : null,
    canSend: verdict ? verdict !== 'BLOCKED' : null,
    issues: healthIssues(entities),
  };
}

/**
 * Every number the token can reach. Accounts come from the token's own grants
 * when Meta lists them, otherwise from the business the user names.
 */
export async function discoverNumbers(
  accessToken: string,
  opts: { wabaIds?: string[]; businessId?: string | null },
): Promise<DiscoveredNumber[]> {
  const wabas = new Map<string, string | null>();
  for (const id of opts.wabaIds ?? []) wabas.set(id, null);

  if (wabas.size === 0 && opts.businessId) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try {
        const res = await graphRequest<{ data?: Array<{ id: string; name?: string }> }>({
          path: `/${opts.businessId}/${edge}?fields=id,name&limit=100`,
          accessToken,
          maxAttempts: 2,
        });
        for (const w of res?.data ?? []) wabas.set(String(w.id), w.name ?? null);
      } catch (err) {
        // A business that owns no accounts, or one the token cannot see, should
        // not hide the accounts the other edge does return.
        logger.warn('onboarding.waba_list_failed', { edge, error: asMetaError(err).message });
      }
    }
  }

  // The same number can be listed under more than one account (a partner's and
  // the owner's); its health check decides which one actually holds it.
  const phoneIds = new Map<string, string | null>();
  for (const [wabaId, name] of wabas) {
    try {
      const res = await graphRequest<{ data?: Array<{ id: string }> }>({
        path: `/${wabaId}/phone_numbers?fields=id&limit=100`,
        accessToken,
        maxAttempts: 2,
      });
      for (const p of res?.data ?? []) if (!phoneIds.has(String(p.id))) phoneIds.set(String(p.id), name);
    } catch (err) {
      logger.warn('onboarding.phone_list_failed', { wabaId, error: asMetaError(err).message });
    }
  }

  const numbers = await Promise.all(
    [...phoneIds.keys()].map(async (id) => {
      try {
        const h = await numberHealth(accessToken, id);
        return {
          ...h,
          wabaName: (h.wabaId && wabas.get(h.wabaId)) || null,
          isTestNumber: /^\+?1[\s-]?555/.test(h.displayPhoneNumber),
        };
      } catch (err) {
        logger.warn('onboarding.number_health_failed', { phoneNumberId: id, error: asMetaError(err).message });
        return null;
      }
    }),
  );

  return numbers
    .filter((n): n is DiscoveredNumber => n != null)
    // Ready numbers first, Meta's sandbox number last: the top of the list should
    // be the one almost everybody means.
    .sort((a, b) => rank(b) - rank(a));
}

function rank(n: DiscoveredNumber): number {
  return (n.status === 'CONNECTED' ? 4 : 0) + (n.canSend !== false ? 2 : 0) + (n.isTestNumber ? 0 : 1);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

/** Ask the account to deliver its webhooks to this app. Idempotent. */
export async function subscribeApp(accessToken: string, wabaId: string): Promise<void> {
  await graphRequest({ path: `/${wabaId}/subscribed_apps`, accessToken, method: 'POST', maxAttempts: 2 });
}

export interface WebhookState {
  callbackUrl: string | null;
  active: boolean;
  fields: string[];
  /** Points at this server and delivers messages. */
  matches: boolean;
}

export async function getWebhookState(appId: string, appSecret: string): Promise<WebhookState> {
  const res = await appGraph<{ data?: any[] }>(appId, appSecret, `/${appId}/subscriptions`);
  const sub = (res?.data ?? []).find((s) => s.object === 'whatsapp_business_account');
  const fields: string[] = (sub?.fields ?? []).map((f: any) => (typeof f === 'string' ? f : f.name));
  const expected = webhookCallbackUrl();
  return {
    callbackUrl: sub?.callback_url ?? null,
    active: Boolean(sub?.active),
    fields,
    matches: Boolean(sub && expected && sub.callback_url === expected && sub.active && fields.includes('messages')),
  };
}

/**
 * Point the app's webhook at this server. Meta calls the callback during this
 * request to verify it, so it only succeeds when PUBLIC_API_URL is reachable
 * from the internet — the caller falls back to manual instructions otherwise.
 */
export async function configureWebhook(appId: string, appSecret: string): Promise<void> {
  const callbackUrl = webhookCallbackUrl();
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!callbackUrl || !verifyToken) {
    throw new Error('PUBLIC_API_URL and META_WEBHOOK_VERIFY_TOKEN must be set on the server.');
  }
  await appGraph(appId, appSecret, `/${appId}/subscriptions`, {
    method: 'POST',
    params: {
      object: 'whatsapp_business_account',
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: WEBHOOK_FIELDS.join(','),
    },
  });
}

/**
 * Check that this token may send from this number without messaging anyone.
 *
 * The request targets an impossible recipient, so it can never deliver. Meta
 * checks permission before the recipient: a token that may not send gets #200
 * (the case where another provider registered the number), a revoked one gets
 * #190, and anything else — a complaint about the recipient — means sending is
 * permitted.
 */
/** Meta's own words for the last refused probe per number — the generic code alone can't say why. */
const probeRefusals = new Map<string, string>();
export function lastProbeRefusal(phoneNumberId: string): string | undefined {
  return probeRefusals.get(phoneNumberId);
}

export async function probeSendPermission(
  accessToken: string,
  phoneNumberId: string,
): Promise<'ok' | 'not_registered' | 'token' | 'unknown'> {
  try {
    await graphRequest({
      path: `/${phoneNumberId}/messages`,
      accessToken,
      method: 'POST',
      body: { messaging_product: 'whatsapp', to: '0', type: 'text', text: { body: '.' } },
      maxAttempts: 1,
    });
    return 'ok';
  } catch (err) {
    const meta = asMetaError(err);
    if (meta.code === 200 || meta.code === 10) {
      const said = [`#${meta.code}${meta.subcode ? `/${meta.subcode}` : ''}`, meta.message].filter(Boolean).join(' ');
      probeRefusals.set(phoneNumberId, said);
      logger.warn('meta.send_probe_refused', { phoneNumberId, code: meta.code, subcode: meta.subcode, message: meta.message, trace: meta.traceId });
      return 'not_registered';
    }
    probeRefusals.delete(phoneNumberId);
    if (meta.code === 190 || meta.code === 0) return 'token';
    if (meta.kind === 'TRANSIENT') return 'unknown';
    return 'ok';
  }
}

/**
 * Register the number to this app with its two-step verification PIN. This is
 * how a number moves here from another provider; it is harmless to repeat.
 */
export async function registerNumber(accessToken: string, phoneNumberId: string, pin: string): Promise<void> {
  await graphRequest({
    path: `/${phoneNumberId}/register`,
    accessToken,
    method: 'POST',
    body: { messaging_product: 'whatsapp', pin },
    maxAttempts: 1,
  });
}

// ── Health ───────────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface HealthCheck {
  id: 'token' | 'number' | 'account' | 'webhook' | 'sending';
  status: CheckStatus;
  /** Stable reason the UI translates; `detail` is Meta's own wording as a fallback. */
  code: string;
  detail?: string;
  /** What the person can do about it. */
  fix?: 'reconnect' | 'register' | 'webhook' | 'billing' | 'whatsapp_manager';
}

export interface HealthReport {
  checks: HealthCheck[];
  ready: boolean;
  checkedAt: string;
}

export async function runHealthChecks(cloud: {
  accessToken: string;
  appSecret: string | null;
  appId: string | null;
  phoneNumberId: string;
}): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // Token first: if it is dead every other check fails for the same reason, and
  // five red rows that all mean "reconnect" read as five problems.
  let token: TokenInfo | null = null;
  try {
    token = await inspectToken(cloud.accessToken, cloud.appSecret);
  } catch (err) {
    checks.push({ id: 'token', status: 'fail', code: 'TOKEN_UNREADABLE', detail: asMetaError(err).userMessage, fix: 'reconnect' });
  }
  if (token) {
    if (!token.valid) checks.push({ id: 'token', status: 'fail', code: 'TOKEN_INVALID', fix: 'reconnect' });
    else if (token.missingScopes.length) {
      checks.push({ id: 'token', status: 'fail', code: 'TOKEN_SCOPES', detail: token.missingScopes.join(', '), fix: 'reconnect' });
    } else if (token.expiresAt) {
      checks.push({ id: 'token', status: 'warn', code: 'TOKEN_EXPIRES', detail: token.expiresAt, fix: 'reconnect' });
    } else checks.push({ id: 'token', status: 'ok', code: 'TOKEN_OK' });
  }
  if (checks[0]?.status === 'fail') {
    for (const id of ['number', 'account', 'webhook', 'sending'] as const) {
      checks.push({ id, status: 'skip', code: 'BLOCKED_BY_TOKEN' });
    }
    return { checks, ready: false, checkedAt: new Date().toISOString() };
  }

  let health: Awaited<ReturnType<typeof numberHealth>> | null = null;
  try {
    health = await numberHealth(cloud.accessToken, cloud.phoneNumberId);
  } catch (err) {
    checks.push({ id: 'number', status: 'fail', code: 'NUMBER_UNREACHABLE', detail: asMetaError(err).userMessage, fix: 'reconnect' });
  }
  if (health) {
    const q = (health.qualityRating ?? '').toUpperCase();
    if (health.status && health.status !== 'CONNECTED') {
      checks.push({ id: 'number', status: 'fail', code: 'NUMBER_STATUS', detail: health.status, fix: 'whatsapp_manager' });
    } else if (q === 'RED') {
      checks.push({ id: 'number', status: 'warn', code: 'QUALITY_RED', fix: 'whatsapp_manager' });
    } else if (q === 'YELLOW') {
      checks.push({ id: 'number', status: 'warn', code: 'QUALITY_YELLOW' });
    } else checks.push({ id: 'number', status: 'ok', code: 'NUMBER_OK', detail: health.displayPhoneNumber });

    const blocking = health.issues[0];
    if (health.canSend === false || blocking) {
      checks.push({
        id: 'account',
        status: health.canSend === false ? 'fail' : 'warn',
        code: blocking?.code ?? 'ACCOUNT_BLOCKED',
        detail: blocking?.message,
        fix: blocking?.code === 'PAYMENT_METHOD' ? 'billing' : 'whatsapp_manager',
      });
    } else checks.push({ id: 'account', status: 'ok', code: 'ACCOUNT_OK' });
  } else {
    checks.push({ id: 'account', status: 'skip', code: 'BLOCKED_BY_NUMBER' });
  }

  if (!cloud.appSecret || !cloud.appId) {
    checks.push({ id: 'webhook', status: 'fail', code: 'NO_APP_SECRET', fix: 'reconnect' });
  } else if (token?.appSecretValid === false) {
    checks.push({ id: 'webhook', status: 'fail', code: 'APP_SECRET_INVALID', fix: 'reconnect' });
  } else {
    try {
      const hook = await getWebhookState(cloud.appId, cloud.appSecret);
      if (hook.matches) checks.push({ id: 'webhook', status: 'ok', code: 'WEBHOOK_OK' });
      else if (!hook.callbackUrl) checks.push({ id: 'webhook', status: 'fail', code: 'WEBHOOK_MISSING', fix: 'webhook' });
      else if (!hook.fields.includes('messages')) checks.push({ id: 'webhook', status: 'fail', code: 'WEBHOOK_NO_MESSAGES', fix: 'webhook' });
      else checks.push({ id: 'webhook', status: 'fail', code: 'WEBHOOK_ELSEWHERE', detail: hook.callbackUrl, fix: 'webhook' });
    } catch (err) {
      checks.push({ id: 'webhook', status: 'warn', code: 'WEBHOOK_UNKNOWN', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  const probe = await probeSendPermission(cloud.accessToken, cloud.phoneNumberId);
  checks.push(
    probe === 'ok' ? { id: 'sending', status: 'ok', code: 'SENDING_OK' }
    : probe === 'not_registered' ? { id: 'sending', status: 'fail', code: 'NOT_REGISTERED_HERE', fix: 'register', detail: lastProbeRefusal(cloud.phoneNumberId) }
    : probe === 'token' ? { id: 'sending', status: 'fail', code: 'TOKEN_INVALID', fix: 'reconnect' }
    : { id: 'sending', status: 'warn', code: 'SENDING_UNKNOWN' },
  );

  return {
    checks,
    ready: checks.every((c) => c.status === 'ok' || c.status === 'warn'),
    checkedAt: new Date().toISOString(),
  };
}
