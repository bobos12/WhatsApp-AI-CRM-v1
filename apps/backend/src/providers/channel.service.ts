import type { ProviderName } from './types';
import { prisma } from '../lib/prisma';
import { getTenantId, requireTenantId, runAsPlatform } from '../lib/tenant-context';
import { decryptSecret, encryptSecret, maskSecret, tryDecryptSecret } from '../lib/crypto';
import { logger } from '../lib/logger';
import { HttpError } from '../auth/authorize';

/**
 * Per-tenant WhatsApp Cloud API configuration.
 *
 * One WhatsAppChannel row per tenant holds the Meta credentials the CRM sends
 * with, plus the health Meta reports back about that number. Credentials are
 * encrypted at rest and never leave the server — the API exposes only a masked
 * hint, so a compromised browser session cannot exfiltrate the token that sends
 * as the customer's business.
 */

/** Meta Cloud API credentials and identity for one tenant, decrypted. */
export interface CloudApiConfig {
  phoneNumberId: string;
  wabaId: string | null;
  businessId: string | null;
  /** Needed only to submit templates with a media header. See providers/meta/templates.ts. */
  appId: string | null;
  accessToken: string;
  /**
   * The tenant's Meta App secret, used to verify webhook signatures. Null when
   * the tenant is on the platform's own Meta App (Embedded Signup), in which
   * case META_APP_SECRET applies.
   */
  appSecret: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

export interface ResolvedChannel {
  tenantId: string;
  provider: ProviderName;
  /** Present only once the tenant's Meta credentials are complete and readable. */
  cloud: CloudApiConfig | null;
  qualityRating: 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED';
  messagingLimit: string | null;
  restrictedUntil: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
}

/**
 * Short-lived cache. Every outbound message reads the channel, and a DB round
 * trip per message would be pure waste on a broadcast run. The TTL is small
 * because a token the tenant just corrected must take effect promptly, and every
 * write path calls `invalidateChannel()` anyway — the TTL only bounds staleness
 * from writes made by *another* process.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: ResolvedChannel; at: number }>();

export function invalidateChannel(tenantId?: string | null) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

type ChannelRow = {
  phoneNumberId: string | null;
  wabaId: string | null;
  businessId: string | null;
  appId: string | null;
  accessTokenEnc: string | null;
  appSecretEnc: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string;
  messagingLimit: string | null;
  restrictedUntil: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

function toResolved(tenantId: string, row: ChannelRow | null): ResolvedChannel {
  // No row means the tenant has not connected a number yet. Everything downstream
  // treats that as "not configured" and prompts them through Settings.
  if (!row) {
    return {
      tenantId,
      provider: 'meta',
      cloud: null,
      qualityRating: 'UNKNOWN',
      messagingLimit: null,
      restrictedUntil: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };
  }

  // There is one transport, and the column that used to record it is gone —
  // this is now derived, not read. Callers (send-policy, capabilities) still
  // take a provider name, so it is produced here rather than removed.
  const provider: ProviderName = 'meta';

  let cloud: CloudApiConfig | null = null;
  if (row.phoneNumberId && row.accessTokenEnc) {
    // A token that fails to decrypt (key rotated, row corrupted) must not throw
    // here — it surfaces as an unconfigured channel, and the send path reports
    // "reconnect your number" instead of 500-ing on every message.
    const accessToken = tryDecryptSecret(row.accessTokenEnc);
    if (accessToken) {
      cloud = {
        phoneNumberId: row.phoneNumberId,
        wabaId: row.wabaId,
        businessId: row.businessId,
        appId: row.appId,
        accessToken,
        appSecret: tryDecryptSecret(row.appSecretEnc),
        displayPhoneNumber: row.displayPhoneNumber,
        verifiedName: row.verifiedName,
      };
    } else {
      logger.error('channel.token_decrypt_failed', { tenantId });
    }
  }

  return {
    tenantId,
    provider,
    cloud,
    qualityRating: (row.qualityRating as ResolvedChannel['qualityRating']) ?? 'UNKNOWN',
    messagingLimit: row.messagingLimit,
    restrictedUntil: row.restrictedUntil,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
  };
}

/**
 * Columns every channel read needs.
 *
 * `provider` used to be here and outlived the column: migration
 * 20260808000000_cloud_api_only dropped it, but because this object is a
 * pre-declared variable rather than an inline literal, TypeScript's
 * excess-property check does not apply to it — `tsc` stayed green while every
 * call to `getChannel()` threw "Unknown field `provider`" at runtime. That took
 * out pre-flight, the broadcast worker and the settings screen at once.
 *
 * Keep this list in step with the model; a typo here fails at runtime, not build
 * time.
 */
const SELECT = {
  phoneNumberId: true,
  wabaId: true,
  businessId: true,
  appId: true,
  accessTokenEnc: true,
  appSecretEnc: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  messagingLimit: true,
  restrictedUntil: true,
  lastSyncedAt: true,
  lastSyncError: true,
} as const;

/**
 * The current tenant's channel. Resolves the tenant from ambient context, so
 * every caller inside a request or a `runWithTenant()` job gets the right one
 * without passing it.
 */
export async function getChannel(tenantId: string = requireTenantId()): Promise<ResolvedChannel> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = (await prisma.whatsAppChannel.findUnique({
    where: { tenantId },
    select: SELECT,
  })) as ChannelRow | null;

  const value = toResolved(tenantId, row);
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** The current tenant's channel, or an unconfigured one when there is no tenant. */
export async function getChannelOrDefault(): Promise<ResolvedChannel> {
  const tenantId = getTenantId();
  if (!tenantId) return toResolved('', null);
  return getChannel(tenantId);
}

/** Which provider the current tenant sends through. */
export async function getProviderName(_tenantId?: string): Promise<ProviderName> {
  return 'meta';
}

/**
 * Resolve a tenant from an inbound Meta webhook.
 *
 * The payload identifies its destination only by `phone_number_id`, so this runs
 * in platform scope — at this point there is no tenant context to read, and
 * establishing one is the entire point of the lookup.
 */
export async function findTenantByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ tenantId: string; channel: ResolvedChannel } | null> {
  const row = await runAsPlatform(async () => {
    return await prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId },
      select: { tenantId: true, ...SELECT },
    });
  });

  if (!row?.tenantId) return null;
  return { tenantId: row.tenantId, channel: toResolved(row.tenantId, row as ChannelRow) };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface SaveCloudCredentialsInput {
  phoneNumberId: string;
  wabaId?: string | null;
  businessId?: string | null;
  appId?: string | null;
  /** Blank keeps the stored token; required only when none is stored yet. */
  accessToken?: string;
  /** Blank keeps the stored secret. Never returned to a client, so it cannot be echoed back. */
  appSecret?: string | null;
}

/**
 * Store a tenant's Cloud API credentials. Encrypts before writing and refuses a
 * phone number id already claimed by a different tenant — otherwise that
 * tenant's inbound webhooks would start routing here.
 */
export async function saveCloudCredentials(
  input: SaveCloudCredentialsInput,
  tenantId: string = requireTenantId(),
): Promise<void> {
  const phoneNumberId = input.phoneNumberId.trim();
  const accessToken = input.accessToken?.trim() ?? '';
  if (!phoneNumberId) throw new HttpError(400, 'Phone Number ID is required');

  // Both secrets are write-only, so "blank" has to mean "keep what is stored".
  // Requiring the token on every save meant a tenant could never correct one
  // credential without re-pasting the other — and Meta shows a system-user
  // token exactly once, so re-pasting is often impossible.
  const existing = await prisma.whatsAppChannel.findUnique({
    where: { tenantId },
    select: { accessTokenEnc: true },
  });
  if (!accessToken && !existing?.accessTokenEnc) {
    throw new HttpError(400, 'Access token is required');
  }

  const clash = await runAsPlatform(async () => {
    return await prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId },
      select: { tenantId: true },
    });
  });
  if (clash && clash.tenantId !== tenantId) {
    throw new HttpError(
      409,
      'That Phone Number ID is already connected to another account on this platform.',
      'PHONE_NUMBER_ID_TAKEN',
    );
  }

  const data = {
    phoneNumberId,
    wabaId: input.wabaId?.trim() || null,
    businessId: input.businessId?.trim() || null,
    appId: input.appId?.trim() || null,
    lastSyncError: null,
  };
  const tokenColumn = accessToken ? { accessTokenEnc: encryptSecret(accessToken) } : {};

  /**
   * A blank app secret means "keep the stored one", not "erase it".
   *
   * The secret is write-only — it is never returned to the browser, so the form
   * cannot pre-fill it and tells the user "leave blank to keep". Nulling it here
   * broke that promise, and the failure is silent and total: without a secret,
   * webhook.ts refuses every delivery (correctly — it will not accept unverified
   * input), so inbound messages, delivery receipts and template-approval updates
   * all stop. Nothing errors; the tenant just never hears from WhatsApp again.
   *
   * This happened in practice: re-saving credentials to update an expired token
   * silently disabled all inbound messaging.
   */
  const suppliedSecret = input.appSecret?.trim();
  const secretColumn = suppliedSecret ? { appSecretEnc: encryptSecret(suppliedSecret) } : {};

  await prisma.whatsAppChannel.upsert({
    where: { tenantId },
    // On create there is nothing to preserve, so blanks really are null. The
    // guard above guarantees a token exists on this path.
    create: {
      tenantId,
      ...data,
      accessTokenEnc: encryptSecret(accessToken),
      appSecretEnc: suppliedSecret ? encryptSecret(suppliedSecret) : null,
    },
    update: { ...data, ...tokenColumn, ...secretColumn },
  });

  invalidateChannel(tenantId);
}

/** Record the outcome of a Graph API identity/health sync. */
export async function recordSync(
  tenantId: string,
  fields: {
    displayPhoneNumber?: string | null;
    verifiedName?: string | null;
    qualityRating?: 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED';
    messagingLimit?: string | null;
    restrictedUntil?: Date | null;
    error?: string | null;
  },
): Promise<void> {
  await prisma.whatsAppChannel.updateMany({
    where: { tenantId },
    data: {
      ...(fields.displayPhoneNumber !== undefined ? { displayPhoneNumber: fields.displayPhoneNumber } : {}),
      ...(fields.verifiedName !== undefined ? { verifiedName: fields.verifiedName } : {}),
      ...(fields.qualityRating !== undefined ? { qualityRating: fields.qualityRating } : {}),
      ...(fields.messagingLimit !== undefined ? { messagingLimit: fields.messagingLimit } : {}),
      ...(fields.restrictedUntil !== undefined ? { restrictedUntil: fields.restrictedUntil } : {}),
      lastSyncedAt: new Date(),
      lastSyncError: fields.error ?? null,
    },
  });
  invalidateChannel(tenantId);
}

/** Forget a tenant's Cloud API credentials and fall back to Baileys. */
export async function disconnectCloud(tenantId: string = requireTenantId()): Promise<void> {
  await prisma.whatsAppChannel.updateMany({
    where: { tenantId },
    data: {
      phoneNumberId: null,
      wabaId: null,
      businessId: null,
      appId: null,
      accessTokenEnc: null,
      appSecretEnc: null,
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: 'UNKNOWN',
      messagingLimit: null,
      restrictedUntil: null,
      lastSyncError: null,
    },
  });
  invalidateChannel(tenantId);
}

/**
 * Channel state shaped for the Settings screen. Returns a masked token hint
 * rather than the credential — the API must never hand a Meta token back to a
 * browser, even to the tenant that supplied it.
 */
export async function getChannelForDisplay(tenantId: string = requireTenantId()) {
  const row = await prisma.whatsAppChannel.findUnique({
    where: { tenantId },
    select: SELECT,
  });
  const resolved = toResolved(tenantId, row as ChannelRow | null);

  let tokenHint: string | null = null;
  if (row?.accessTokenEnc) {
    try {
      tokenHint = maskSecret(decryptSecret(row.accessTokenEnc));
    } catch {
      tokenHint = 'unreadable — re-enter your token';
    }
  }

  return {
    provider: resolved.provider,
    configured: resolved.cloud != null,
    phoneNumberId: row?.phoneNumberId ?? null,
    wabaId: row?.wabaId ?? null,
    businessId: row?.businessId ?? null,
    appId: row?.appId ?? null,
    displayPhoneNumber: row?.displayPhoneNumber ?? null,
    verifiedName: row?.verifiedName ?? null,
    qualityRating: resolved.qualityRating,
    messagingLimit: resolved.messagingLimit,
    restrictedUntil: resolved.restrictedUntil,
    lastSyncedAt: resolved.lastSyncedAt,
    lastSyncError: resolved.lastSyncError,
    appSecretSet: !!row?.appSecretEnc,
    tokenHint,
  };
}
