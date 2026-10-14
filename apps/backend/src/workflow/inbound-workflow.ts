import { randomUUID } from 'node:crypto';
import { MsgStatus, MessageType } from '@prisma/client';
import type {
  MessageContent,
  Media,
  MediaType,
  NormalizedMessage,
  ProviderName,
  ReplyReference,
} from '@crm/messaging-schema';
import { prisma } from '../lib/prisma';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';
import { emitRealtime } from '../realtime/socket';
import { getOrCreateConversationByPhone } from '../conversations/conversation-resolver';
import { checkAutomationRules } from '../automations/engine';
import { autoAssignConversation } from '../conversations/auto-assign.service';
import { stopFlowExecutionsOnReply, triggerFlows } from '../automations/flow-executor';
import { compileRenderable } from '../messaging/compile-renderable';
import { getCapabilities } from '../messaging/capabilities';
import { persistNormalizedMessage } from '../messaging/persist';
import { aiBotService } from '../services/ai-bot.service';
import { scheduleQualification } from '../lead-qualification/debounce';

/**
 * Inbound orchestration for the WhatsApp Business Cloud API.
 *
 * This used to take Baileys socket payloads — nested protobuf containers, `key`
 * envelopes, echo messages for our own sends, and media that had to be pulled
 * off the socket. None of that exists here: Meta delivers a flat, already-parsed
 * JSON message over the webhook, exactly once per message, and never echoes our
 * own outbound traffic back at us.
 *
 * The parsing lives in providers/meta/webhook.ts, which owns the Meta payload
 * shape and downloads media before calling in. This module owns what happens
 * *after* a message is understood: dedup, contact and conversation resolution,
 * persistence, and the fan-out to automations, the AI bot and lead scoring.
 */

export type InboundResultStatus = 'processed' | 'duplicate' | 'ignored' | 'failed';

export interface InboundMessageInput {
  /** Meta's `wamid`. Unique per message and stable across webhook retries. */
  externalId: string;
  /** Sender, as Meta reports it (digits, no '+'). */
  phone: string;
  type: MessageType;
  /** Body text, or the caption/filename for media. */
  content: string;
  /** Unix seconds, as Meta sends it. */
  timestamp: number;
  /** Storage ref for media already downloaded by the webhook. */
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaCaption?: string | null;
  mediaDuration?: number | null;
  /** `context.id` — the message this one replies to. */
  replyToExternalId?: string | null;
  /** WhatsApp profile name, when the payload carries one. */
  senderName?: string | null;
  /** Whether an audio message was recorded as a voice note. */
  isVoiceNote?: boolean;
  /** Original Meta message object, retained for debugging. */
  raw?: unknown;
}

export interface InboundContext {
  /** The tenant's Meta phone number id — the CRM's per-channel session key. */
  sessionId: string;
  provider?: ProviderName;
  /** The business number in display form, for the message's `to` field. */
  systemPhone?: string;
}

function logStep(step: string, context: Record<string, unknown> = {}) {
  logger.info(`inbound.${step}`, context);
}

// ── Content building ─────────────────────────────────────────────────────────

function mediaTypeFor(type: MessageType, mime: string | null, isVoiceNote?: boolean): MediaType {
  if (isVoiceNote) return 'voice';
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/webp') return 'sticker';
  switch (type) {
    case MessageType.IMAGE: return 'image';
    case MessageType.VIDEO: return 'video';
    case MessageType.AUDIO: return 'audio';
    default: return 'document';
  }
}

function buildContent(input: InboundMessageInput): MessageContent {
  if (input.type === MessageType.TEXT || !input.mediaUrl) {
    return { kind: 'text', body: input.content ?? '', previewUrl: false };
  }

  const media: Media = {
    mediaType: mediaTypeFor(input.type, input.mediaMimeType ?? null, input.isVoiceNote),
    mime: input.mediaMimeType ?? 'application/octet-stream',
    url: input.mediaUrl,
    providerMediaId: null,
    fileName: input.mediaFileName ?? null,
    sizeBytes: null,
    durationSec: input.mediaDuration ?? null,
    width: null,
    height: null,
    thumbnailUrl: null,
  };

  return {
    kind: 'media',
    media,
    caption: input.mediaCaption ?? undefined,
  };
}

/** The one-line summary shown in the conversation list. */
function buildPreview(input: InboundMessageInput): string {
  if (input.content?.trim()) return input.content.trim();
  if (input.mediaCaption?.trim()) return input.mediaCaption.trim();
  switch (input.type) {
    case MessageType.IMAGE: return '📷 Photo';
    case MessageType.VIDEO: return '🎥 Video';
    case MessageType.AUDIO: return input.isVoiceNote ? '🎤 Voice message' : '🎵 Audio';
    case MessageType.DOCUMENT: return `📄 ${input.mediaFileName ?? 'Document'}`;
    default: return '';
  }
}

function buildNormalized(
  input: InboundMessageInput,
  ctx: {
    sessionId: string;
    systemPhone: string;
    conversationId: string;
    teamId: string | null;
    provider: ProviderName;
    replyToId: string | null;
    replyToBody: string | null;
  },
): NormalizedMessage {
  const timestamp = new Date(input.timestamp * 1000).toISOString();

  const reply: ReplyReference | null = input.replyToExternalId
    ? {
        messageId: ctx.replyToId,
        externalId: input.replyToExternalId,
        preview: ctx.replyToBody ?? '',
        kind: 'text',
      }
    : null;

  return {
    schemaVersion: 1,
    id: null,
    clientId: randomUUID(),
    externalId: input.externalId,
    provider: ctx.provider,
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId,
    contactPhone: input.phone,
    teamId: ctx.teamId,
    direction: 'inbound',
    content: buildContent(input),
    status: 'received',
    metadata: {
      sequenceNumber: 0,
      traceId: randomUUID(),
      attemptCount: 0,
      errorReason: null,
      errorCode: null,
      compatibilityMode: 'cloud_api',
      timestamps: { received: timestamp },
      // `origin` describes which part of *our* system produced a message; an
      // inbound message was not produced by us at all, so it is null.
      origin: null,
      originRef: null,
      rawRetained: true,
    },
    reply,
    timestamp,
    raw: (input.raw as Record<string, unknown> | undefined) ?? null,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Persist one inbound message and run everything that reacts to it.
 *
 * Idempotent by `(externalId, sessionId)`: Meta retries a webhook delivery for up
 * to seven days when it does not get a 2xx, so the same message legitimately
 * arrives more than once and must not create duplicate rows or fire automations
 * twice.
 */
export async function processIncomingMessage(
  input: InboundMessageInput,
  context: InboundContext,
): Promise<{
  status: InboundResultStatus;
  messageId?: string;
  conversationId?: string;
  error?: string;
}> {
  const sessionId = String(context?.sessionId || '').trim();
  if (!sessionId) {
    logger.error('inbound.failed', { step: 'validate', reason: 'missing sessionId' });
    return { status: 'failed', error: 'Missing sessionId' };
  }

  const provider: ProviderName = context.provider ?? 'meta';
  const phone = normalizePhone(input.phone);

  if (!input.externalId || !phone) {
    logger.error('inbound.failed', { step: 'validate', sessionId, reason: 'missing externalId or phone' });
    return { status: 'failed', error: 'Missing required fields' };
  }

  const normalized: InboundMessageInput = { ...input, phone };
  logStep('received', { sessionId, externalId: normalized.externalId });

  let createdMessageId: string | null = null;
  let createdConversationId: string | undefined;

  try {
    // ── Dedup ────────────────────────────────────────────────────────────────
    const duplicate = await prisma.message.findFirst({
      where: { externalId: normalized.externalId, sessionId },
      select: { id: true, conversationId: true },
    });
    if (duplicate) {
      logger.info('inbound.duplicate', { sessionId, externalId: normalized.externalId, messageId: duplicate.id });
      return { status: 'duplicate', messageId: duplicate.id, conversationId: duplicate.conversationId };
    }

    // ── Contact + conversation ───────────────────────────────────────────────
    const { contact, conversation, isNew } = (await getOrCreateConversationByPhone(
      normalized.phone,
      undefined,
      prisma,
    )) as any;
    createdConversationId = conversation.id;
    const teamId = conversation.teamId ?? null;
    logStep('conversation_resolved', { sessionId, conversationId: conversation.id, contactId: contact.id, isNew });

    // Adopt the WhatsApp profile name for contacts we have never seen named.
    if (normalized.senderName && (!contact.name || contact.name === normalized.phone)) {
      await prisma.contact
        .update({ where: { id: contact.id }, data: { name: normalized.senderName } })
        .catch(() => { /* cosmetic — never fail a message over a display name */ });
    }

    if (isNew && process.env.AUTO_ASSIGN_ENABLED !== 'false') {
      void autoAssignConversation(conversation.id).catch(() => { /* non-critical */ });
    }

    // ── Reply context ────────────────────────────────────────────────────────
    let replyToId: string | null = null;
    let replyToBody: string | null = null;
    if (normalized.replyToExternalId) {
      const quoted = await prisma.message
        .findFirst({
          where: { externalId: normalized.replyToExternalId, sessionId },
          select: { id: true, body: true },
        })
        .catch(() => null);
      if (quoted) {
        replyToId = quoted.id;
        replyToBody = quoted.body ?? null;
      }
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const systemPhone = context.systemPhone ?? sessionId;
    const nMsg = buildNormalized(normalized, {
      sessionId,
      systemPhone,
      conversationId: conversation.id,
      teamId,
      provider,
      replyToId,
      replyToBody,
    });

    const renderable = compileRenderable(nMsg, getCapabilities(provider).defaultMode);
    const { messageId: persistedId } = await persistNormalizedMessage(nMsg, renderable, {
      contactName: contact.name ?? null,
    });
    createdMessageId = persistedId;

    const body = buildPreview(normalized);
    logger.info('inbound.saved', {
      sessionId,
      externalId: normalized.externalId,
      messageId: persistedId,
      conversationId: conversation.id,
    });

    // Unread count is not part of persistNormalizedMessage — it is inbound-only.
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 } },
    });

    emitRealtime(
      'conversation:updated',
      {
        conversationId: conversation.id,
        lastMessageAt: new Date(normalized.timestamp * 1000).toISOString(),
        lastMessagePreview: body,
        unreadCount: (conversation.unreadCount ?? 0) + 1,
        isNewContact: isNew,
      },
      teamId,
    );

    // ── Fan-out ──────────────────────────────────────────────────────────────
    // Every one of these is fire-and-forget: an automation that throws must not
    // cost us the message that triggered it.
    const text = normalized.content || body;

    await checkAutomationRules(normalized.phone, text).catch((err) =>
      logger.warn('inbound.automation_failed', { error: String(err) }),
    );
    void stopFlowExecutionsOnReply(normalized.phone).catch(() => {});
    void triggerFlows(normalized.phone, text, 'ANY_MESSAGE', teamId ?? undefined).catch(() => {});
    if (normalized.content) {
      void triggerFlows(normalized.phone, normalized.content, 'KEYWORD', teamId ?? undefined).catch(() => {});
    }

    // Debounced: a burst of rapid messages produces one reply, after the
    // customer stops typing.
    aiBotService.scheduleInboundReply(conversation.id, text, {
      phone: normalized.phone,
      sessionId,
      teamId,
    });

    scheduleQualification(contact.id);

    await prisma.message.update({
      where: { id: persistedId },
      data: { status: MsgStatus.PROCESSED },
    });

    logger.info('inbound.finalized', {
      sessionId,
      externalId: normalized.externalId,
      messageId: persistedId,
      conversationId: conversation.id,
    });

    return { status: 'processed', messageId: persistedId, conversationId: conversation.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('inbound.failed', {
      sessionId,
      externalId: normalized.externalId,
      conversationId: createdConversationId,
      messageId: createdMessageId,
      error: message,
    });

    if (createdMessageId) {
      await prisma.message
        .update({
          where: { id: createdMessageId },
          data: { status: MsgStatus.FAILED, errorReason: message.slice(0, 500) },
        })
        .catch(() => { /* the original error is what matters */ });
    }

    return {
      status: 'failed',
      messageId: createdMessageId ?? undefined,
      conversationId: createdConversationId,
      error: message,
    };
  }
}
