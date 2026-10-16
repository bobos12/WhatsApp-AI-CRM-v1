import crypto from 'node:crypto';
import { MessageType, MsgStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { runWithTenant } from '../../lib/tenant-context';
import { emitRealtime } from '../../realtime/socket';
import { processIncomingMessage } from '../../workflow/inbound-workflow';
import { findTenantByPhoneNumberId, recordSync, type ResolvedChannel } from '../channel.service';
import { downloadMedia } from './media';
import { applyTemplateStatusUpdate } from './templates';
import { MetaApiError } from './graph';

/**
 * Inbound webhook from Meta.
 *
 * Three things distinguish this from the previous handler, all of which are the
 * difference between a demo and something you can sell:
 *
 *  1. **Signature verification.** The endpoint is necessarily unauthenticated and
 *     publicly routable. Without checking `X-Hub-Signature-256`, anyone who
 *     learns the URL can inject messages into any tenant's inbox.
 *
 *  2. **Per-tenant routing.** A payload names its destination only by
 *     `phone_number_id`. Resolving that to a tenant and running the rest inside
 *     `runWithTenant()` is what keeps one customer's messages out of another's
 *     database.
 *
 *  3. **The non-message events.** `statuses` carries delivery, read, failure AND
 *     the billing record; `message_template_status_update` is how a template
 *     becomes sendable; `account_update` is the only warning before Meta
 *     restricts a number. Dropping them, as before, means a CRM that cannot tell
 *     you whether anything actually arrived.
 */

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verify `X-Hub-Signature-256` against the raw request body.
 *
 * Must run on the exact bytes Meta signed. `JSON.stringify(req.body)` is not
 * those bytes — key order and whitespace differ — so the route captures the raw
 * buffer and passes it here.
 */
export function verifySignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = header.slice('sha256='.length);

  // Constant-time compare; `timingSafeEqual` throws on length mismatch, which is
  // itself a rejection.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The platform's own Meta App secret, used when a tenant is on our app (Embedded Signup). */
function platformAppSecret(): string | null {
  return process.env.META_APP_SECRET?.trim() || null;
}

/**
 * Handle Meta's GET verification handshake.
 *
 * The verify token is a shared string, not a security boundary — the signature
 * is. One platform-level token keeps setup instructions identical for every
 * tenant, which matters when they are pasting it into their own Meta App.
 */
export function handleVerification(query: Record<string, unknown>): { ok: true; challenge: string } | { ok: false } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();

  if (mode === 'subscribe' && expected && token === expected && typeof challenge === 'string') {
    return { ok: true, challenge };
  }
  return { ok: false };
}

// ── Payload shapes ───────────────────────────────────────────────────────────

interface MetaStatus {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: { billable?: boolean; category?: string };
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

/** Extract every phone_number_id the payload addresses. */
function phoneNumberIdsIn(body: any): string[] {
  const ids = new Set<string>();
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id) ids.add(String(id));
    }
  }
  return [...ids];
}

/**
 * Resolve which tenant a payload belongs to.
 *
 * `message_template_status_update` and `account_update` events carry no
 * phone_number_id — they are addressed to the WABA — so those fall back to
 * matching `entry.id` against the stored wabaId.
 */
async function resolveTenant(body: any): Promise<{ tenantId: string; channel: ResolvedChannel } | null> {
  for (const id of phoneNumberIdsIn(body)) {
    const found = await findTenantByPhoneNumberId(id);
    if (found) return found;
  }

  const wabaId = body?.entry?.[0]?.id;
  if (wabaId) {
    const { runAsPlatform } = await import('../../lib/tenant-context');
    const row = await runAsPlatform(async () =>
      prisma.whatsAppChannel.findFirst({
        where: { wabaId: String(wabaId) },
        select: { tenantId: true, phoneNumberId: true },
      }),
    );
    if (row?.tenantId && row.phoneNumberId) {
      return findTenantByPhoneNumberId(row.phoneNumberId);
    }
  }

  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export type WebhookOutcome =
  | { handled: true }
  | { handled: false; reason: 'unknown_tenant' | 'bad_signature' | 'no_secret' };

/**
 * Process a verified-or-verifiable webhook delivery.
 *
 * Signature checking happens *after* tenant resolution by necessity: the secret
 * is per-tenant under manual onboarding, and the only way to know which tenant a
 * payload is for is to read it. Nothing is acted on before the check passes —
 * resolution is a read-only lookup keyed by an identifier Meta supplied.
 */
export async function handleMetaWebhook(params: {
  body: any;
  rawBody: Buffer | string;
  signatureHeader?: string;
}): Promise<WebhookOutcome> {
  const { body, rawBody, signatureHeader } = params;

  const resolved = await resolveTenant(body);
  if (!resolved) {
    logger.warn('meta_webhook.unknown_tenant', { phoneNumberIds: phoneNumberIdsIn(body) });
    return { handled: false, reason: 'unknown_tenant' };
  }

  const { tenantId, channel } = resolved;
  const secret = channel.cloud?.appSecret ?? platformAppSecret();

  if (!secret) {
    // Refuse rather than accept unverified input. A tenant who has not supplied
    // an app secret sees a clear setup error; the alternative is an endpoint
    // anyone can post to.
    logger.error('meta_webhook.no_app_secret', { tenantId });
    return { handled: false, reason: 'no_secret' };
  }

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    logger.error('meta_webhook.bad_signature', { tenantId });
    return { handled: false, reason: 'bad_signature' };
  }

  await runWithTenant(tenantId, async () => {
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value) continue;

        switch (change.field) {
          case 'messages':
            await handleMessagesChange(value, channel);
            break;
          case 'message_template_status_update':
            await applyTemplateStatusUpdate(value).catch((err) =>
              logger.error('meta_webhook.template_status_failed', { error: String(err) }),
            );
            break;
          case 'account_update':
            await handleAccountUpdate(value, tenantId);
            break;
          case 'phone_number_quality_update':
            await handleQualityUpdate(value, tenantId);
            break;
          default:
            logger.debug?.('meta_webhook.ignored_field', { field: change.field });
        }
      }
    }
  });

  return { handled: true };
}

// ── messages: inbound + statuses ─────────────────────────────────────────────

async function handleMessagesChange(value: any, channel: ResolvedChannel): Promise<void> {
  const sessionId = String(value?.metadata?.phone_number_id ?? channel.cloud?.phoneNumberId ?? '');
  const systemPhone = String(value?.metadata?.display_phone_number ?? channel.cloud?.displayPhoneNumber ?? sessionId);

  // Meta sends the customer's WhatsApp profile name alongside the message, keyed
  // by wa_id — the only place a display name for a new contact comes from.
  const namesByWaId = new Map<string, string>();
  for (const c of value?.contacts ?? []) {
    if (c?.wa_id && c?.profile?.name) namesByWaId.set(String(c.wa_id), String(c.profile.name));
  }

  for (const message of value?.messages ?? []) {
    try {
      const payload = await buildInboundPayload(message, channel, namesByWaId);
      if (!payload) continue;
      await processIncomingMessage(payload, { sessionId, provider: 'meta', systemPhone });
    } catch (err) {
      logger.error('meta_webhook.message_failed', {
        messageId: message?.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const status of (value?.statuses ?? []) as MetaStatus[]) {
    try {
      await applyStatus(status);
    } catch (err) {
      logger.error('meta_webhook.status_failed', {
        messageId: status?.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const TYPE_MAP: Record<string, MessageType> = {
  image: MessageType.IMAGE,
  sticker: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  document: MessageType.DOCUMENT,
};

/**
 * Normalise one inbound message, downloading any media as we go.
 *
 * The download is eager and inline: Meta deletes media after 30 days and the id
 * is only meaningful with the tenant's token, so deferring it means the
 * attachment is eventually unrecoverable. A failed download degrades to a
 * message without media rather than dropping the message.
 */
async function buildInboundPayload(message: any, channel: ResolvedChannel, namesByWaId?: Map<string, string>) {
  const phone: string | undefined = message?.from;
  const externalId: string | undefined = message?.id;
  if (!phone || !externalId) return null;

  const type: string = message.type ?? 'text';
  // Reactions arrive through this same field but are not messages; the reaction
  // side-channel owns them.
  if (type === 'reaction') return null;

  let content = '';
  let mediaUrl: string | null = null;
  let mediaMimeType: string | null = null;
  let mediaFileName: string | null = null;
  let mediaCaption: string | null = null;
  const isVoiceNote = Boolean(message?.audio?.voice);

  const mediaEntry = message[type];
  const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(type);

  if (isMedia && mediaEntry?.id) {
    mediaCaption = mediaEntry.caption ?? null;
    mediaFileName = mediaEntry.filename ?? null;
    mediaMimeType = mediaEntry.mime_type ?? null;

    if (channel.cloud) {
      const downloaded = await downloadMedia({
        mediaId: mediaEntry.id,
        accessToken: channel.cloud.accessToken,
        filename: mediaFileName,
      });
      if (downloaded) {
        mediaUrl = downloaded.storageRef;
        mediaMimeType = downloaded.mimetype;
      }
    }
    content = mediaCaption ?? mediaFileName ?? '';
  } else {
    switch (type) {
      case 'text':
        content = message.text?.body ?? '';
        break;
      case 'button':
        // A template quick-reply tap. The text is what the customer sees.
        content = message.button?.text ?? '';
        break;
      case 'interactive':
        content =
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          '';
        break;
      case 'location': {
        const loc = message.location ?? {};
        content = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
        break;
      }
      case 'contacts':
        content = (message.contacts ?? [])
          .map((c: any) => c?.name?.formatted_name)
          .filter(Boolean)
          .join(', ');
        break;
      case 'order':
        content = message.order?.text ?? 'Order received';
        break;
      default:
        // Unknown types are still worth recording — an empty row in the thread
        // beats a silent gap the agent cannot explain.
        content = '';
    }
  }

  return {
    externalId,
    phone,
    type: TYPE_MAP[type] ?? MessageType.TEXT,
    content,
    timestamp: Number(message.timestamp),
    mediaUrl,
    mediaMimeType,
    mediaFileName,
    mediaCaption,
    mediaDuration: null,
    isVoiceNote,
    senderName: namesByWaId?.get(String(phone)) ?? null,
    /** Preserved so the inbound pipeline can attribute a reply. */
    replyToExternalId: message.context?.id ?? null,
    raw: message,
  };
}

const STATUS_MAP: Record<string, MsgStatus> = {
  sent: MsgStatus.SENT,
  delivered: MsgStatus.DELIVERED,
  read: MsgStatus.READ,
  failed: MsgStatus.FAILED,
};

/** Delivery progression, used to reject out-of-order status updates. */
const STATUS_RANK: Record<string, number> = {
  [MsgStatus.SENT]: 1,
  [MsgStatus.DELIVERED]: 2,
  [MsgStatus.READ]: 3,
};

/**
 * Apply a delivery status, and record what Meta billed.
 *
 * Statuses arrive out of order and Meta re-delivers them, so this never moves a
 * message backwards: a `sent` arriving after `read` would otherwise erase a
 * confirmed read receipt.
 */
async function applyStatus(status: MetaStatus): Promise<void> {
  const next = STATUS_MAP[status.status?.toLowerCase()];
  if (!next) return;

  const message = await prisma.message.findFirst({
    where: { externalId: status.id },
    select: { id: true, status: true, conversationId: true },
  });
  if (!message) return;

  const isFailure = next === MsgStatus.FAILED;
  const currentRank = STATUS_RANK[message.status] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;

  // A failure always wins; otherwise only move forward.
  if (!isFailure && nextRank <= currentRank) return;

  const error = status.errors?.[0];
  const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === MsgStatus.DELIVERED ? { deliveredAt: at } : {}),
      ...(next === MsgStatus.READ ? { readAt: at, deliveredAt: at } : {}),
      ...(isFailure
        ? { errorReason: error?.error_data?.details || error?.title || error?.message || 'Delivery failed' }
        : {}),
      // Billing arrives on the first status of a conversation and never again,
      // so it is captured whenever present rather than only on a chosen status.
      ...(status.conversation?.id ? { metaConversationId: status.conversation.id } : {}),
      ...(status.pricing?.category ? { metaPricingCategory: status.pricing.category } : {}),
      ...(status.pricing?.billable != null ? { metaBillable: status.pricing.billable } : {}),
    },
  });

  emitRealtime('message:status', {
    messageId: message.id,
    conversationId: message.conversationId,
    status: next,
    ...(isFailure ? { error: error?.title ?? 'Delivery failed' } : {}),
  });

  await applyCampaignStatus(status.id, next, at, error?.code ?? null);
}

/**
 * Mirror a delivery status onto the campaign recipient it belongs to, if any.
 *
 * Meta accepts most messages at send time and reports the real outcome here a
 * second later — "not on WhatsApp", "held back by Meta's marketing limit", "this
 * person stopped marketing messages". Without this a campaign counted those as
 * sent, and its report could never explain why people didn't get it.
 */
async function applyCampaignStatus(
  wamid: string,
  next: MsgStatus,
  at: Date,
  errorCode: number | null,
): Promise<void> {
  const recipient = await prisma.broadcastRecipient.findFirst({
    where: { messageId: wamid },
    select: { id: true, broadcastId: true, status: true, contactId: true },
  });
  if (!recipient) return;

  if (next === MsgStatus.FAILED) {
    const code = errorCode ?? -1;
    const moved = await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, status: 'sent' },
      data: {
        status: 'failed',
        errorCode: String(code),
        lastError: new MetaApiError({ code, message: 'Delivery failed', httpStatus: 400 }).userMessage.slice(0, 500),
      },
    });
    if (moved.count > 0) {
      await prisma.broadcast.update({
        where: { id: recipient.broadcastId },
        data: { totalSent: { decrement: 1 }, totalFailed: { increment: 1 } },
      });
    }
    // They switched off marketing messages in WhatsApp. Respect it everywhere,
    // so no later campaign spends money on a message Meta will refuse anyway.
    if (code === 131050 && recipient.contactId) {
      await prisma.contact.updateMany({ where: { id: recipient.contactId }, data: { marketingOptOut: true } });
    }
    return;
  }

  if (next === MsgStatus.DELIVERED) {
    await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, deliveredAt: null },
      data: { deliveredAt: at },
    });
  } else if (next === MsgStatus.READ) {
    await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, readAt: null },
      data: { readAt: at, deliveredAt: at },
    });
  }
}

// ── account + quality updates ────────────────────────────────────────────────

/**
 * Meta's warning shot. A number moving to a restricted state, or its quality
 * dropping, is the only advance notice before sends start failing — mirroring it
 * onto the channel lets the broadcast preflight refuse to launch a campaign into
 * a number that is already in trouble.
 */
async function handleAccountUpdate(value: any, tenantId: string): Promise<void> {
  const event = String(value?.event ?? '').toUpperCase();

  const restricting = ['ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE'].includes(event);
  const restrictionExpiry = value?.restriction_info?.[0]?.expiration
    ? new Date(Number(value.restriction_info[0].expiration) * 1000)
    : null;

  if (restricting) {
    await recordSync(tenantId, {
      // No stated expiry means indefinite; 24h keeps the block short enough that
      // a lifted restriction recovers on the next sync rather than needing support.
      restrictedUntil: restrictionExpiry ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      error: `Meta reported: ${event}`,
    });
    logger.error('meta.account_restricted', { tenantId, event, until: restrictionExpiry });
  } else if (event === 'ACCOUNT_UPDATE' || event === 'VERIFIED_ACCOUNT') {
    await recordSync(tenantId, { restrictedUntil: null, error: null });
  }

  emitRealtime('wa:account_update', { event, restrictedUntil: restrictionExpiry });
}

async function handleQualityUpdate(value: any, tenantId: string): Promise<void> {
  const rating = String(value?.current_limit ?? value?.event ?? '').toUpperCase();
  const quality = String(value?.current_quality_rating ?? '').toUpperCase();

  await recordSync(tenantId, {
    ...(quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED'
      ? { qualityRating: quality }
      : {}),
    ...(rating.startsWith('TIER_') ? { messagingLimit: rating } : {}),
  });

  logger.warn('meta.quality_update', { tenantId, quality, tier: rating });
  emitRealtime('wa:quality_update', { qualityRating: quality, messagingLimit: rating });
}
