import fs from 'fs';
import path from 'path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { MsgStatus, MessageType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { normalizePhone, parseWhatsAppJid, isGroupJid } from '../lib/phone';
import { logger } from '../lib/logger';
import { getSock } from '../whatsapp/client';
import { emitRealtime } from '../realtime/socket';
import { getOrCreateConversationByPhone } from '../conversations/conversation-resolver';
import { checkAutomationRules } from '../automations/engine';
import { autoAssignConversation } from '../conversations/auto-assign.service';
import { stopFlowExecutionsOnReply, triggerFlows } from '../automations/flow-executor';
import { buildNormalizedFromFlat, buildBaileysOutbound } from '../messaging/normalizers/baileys.normalizer';
import { compileRenderable } from '../messaging/compile-renderable';
import { getCapabilities } from '../messaging/capabilities';
import { persistNormalizedMessage } from '../messaging/persist';
import { aiBotService } from '../services/ai-bot.service';
import { scheduleQualification } from '../lead-qualification/debounce';
import { applyInboundConsent } from '../broadcasts/safety/suppression';
import type { ProviderName } from '@crm/messaging-schema';

export type InboundResultStatus = 'processed' | 'duplicate' | 'ignored' | 'failed';

type NormalizedInboundMessage = {
  externalId: string;
  phone: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  rawType: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  mediaCaption: string | null;
  mediaDuration: number | null;
  rawMessage: any;
  /** key.id of the message being replied to, extracted from contextInfo.stanzaId. */
  replyToExternalId: string | null;
};

function logStep(step: string, context: Record<string, unknown> = {}) {
  logger.info(`inbound.${step}`, context);
}

function unwrapMessageContainer(message: any): any {
  let current = message;
  while (current) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;

    if (!next) return current;
    current = next;
  }
  return message;
}

function extractSocketMessage(rawMessage: any) {
  return rawMessage?.message?.message || rawMessage?.message || rawMessage?.msg || null;
}

function getMessageContent(message: any) {
  const normalizedMessage = unwrapMessageContainer(message);
  return (
    normalizedMessage?.conversation ||
    normalizedMessage?.extendedTextMessage?.text ||
    normalizedMessage?.imageMessage?.caption ||
    normalizedMessage?.videoMessage?.caption ||
    normalizedMessage?.documentMessage?.caption ||
    normalizedMessage?.stickerMessage?.caption ||
    // Button / list / interactive flow responses (customer tapping a button)
    normalizedMessage?.buttonsResponseMessage?.selectedDisplayText ||
    normalizedMessage?.listResponseMessage?.title ||
    normalizedMessage?.interactiveResponseMessage?.body?.text ||
    ''
  );
}

function extractContextInfo(normalizedMessage: any) {
  return (
    normalizedMessage?.extendedTextMessage?.contextInfo ||
    normalizedMessage?.imageMessage?.contextInfo ||
    normalizedMessage?.videoMessage?.contextInfo ||
    normalizedMessage?.audioMessage?.contextInfo ||
    normalizedMessage?.documentMessage?.contextInfo ||
    normalizedMessage?.buttonsResponseMessage?.contextInfo ||
    normalizedMessage?.listResponseMessage?.contextInfo ||
    normalizedMessage?.interactiveResponseMessage?.contextInfo ||
    null
  );
}

function mapIncomingMessageType(rawType: string): MessageType {
  switch (String(rawType || '').toLowerCase()) {
    case 'image':
    case 'imagemessage':
    case 'sticker':
    case 'stickermessage':
      return MessageType.IMAGE;
    case 'document':
    case 'documentmessage':
      return MessageType.DOCUMENT;
    case 'audio':
    case 'audiomessage':
      return MessageType.AUDIO;
    case 'video':
    case 'videomessage':
      return MessageType.VIDEO;
    default:
      return MessageType.TEXT;
  }
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return new Date(numeric > 1e12 ? numeric : numeric * 1000);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function isBroadcast(remoteJid: string) {
  return remoteJid.endsWith('@broadcast') || remoteJid === 'status@broadcast';
}

async function ensureUploadsDir() {
  const uploadsDir = path.resolve(process.cwd(), 'uploads', 'whatsapp');
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  return uploadsDir;
}

async function saveBufferToUploads(buffer: Buffer, fileName: string) {
  const uploadsDir = await ensureUploadsDir();
  const safeName = `${Date.now()}-${fileName}`.replace(/[^\w.\-]/g, '_');
  const filePath = path.join(uploadsDir, safeName);
  await fs.promises.writeFile(filePath, buffer);
  return `/uploads/whatsapp/${safeName}`;
}

async function downloadMediaToUrl(message: any) {
  const normalizedMessage = unwrapMessageContainer(extractSocketMessage(message) || message);
  const mediaMessage =
    normalizedMessage?.imageMessage ||
    normalizedMessage?.videoMessage ||
    normalizedMessage?.audioMessage ||
    normalizedMessage?.documentMessage ||
    normalizedMessage?.stickerMessage;
  if (!mediaMessage) return null;

  try {
    const buffer = await Promise.race([
      downloadMediaMessage(
        message as any,
        'buffer',
        {},
        {
          logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          } as any,
          reuploadRequest: async (msg: any) => {
            const sock = getSock();
            if (sock?.updateMediaMessage) {
              return await sock.updateMediaMessage(msg);
            }
            return msg;
          },
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Media download timed out')), 15000),
      ),
    ]);
    const mediaType = normalizedMessage.imageMessage
      ? 'image'
      : normalizedMessage.videoMessage
      ? 'video'
      : normalizedMessage.audioMessage
      ? 'audio'
      : normalizedMessage.stickerMessage
      ? 'image'
      : 'document';
    const fileName = mediaMessage.fileName || `${mediaMessage.mimetype?.split('/')[0] || mediaType || 'media'}-${Date.now()}`;
    return await saveBufferToUploads(buffer, fileName);
  } catch (error) {
    logger.warn('inbound.media_download_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mediaMessage.url || mediaMessage.directPath || null;
  }
}

function normalizeSocketMessage(rawMessage: any): NormalizedInboundMessage | null {
  const socketMessage = extractSocketMessage(rawMessage) || rawMessage;
  const rawRemoteJidCandidate =
    rawMessage?.key?.remoteJid ||
    rawMessage?.key?.remoteJidAlt ||
    rawMessage?.remoteJid ||
    rawMessage?.sender ||
    rawMessage?.from ||
    '';

  if (!rawRemoteJidCandidate) return null;
  const rawRemoteJid = String(rawRemoteJidCandidate).split(':')[0];

  // Drop status broadcasts, broadcast lists, and group chats — 1-to-1 only
  if (isBroadcast(rawRemoteJid)) return null;
  if (isGroupJid(rawRemoteJid)) return null;

  const phoneDigits =
    parseWhatsAppJid(rawRemoteJid) ||
    parseWhatsAppJid(rawMessage?.key?.remoteJidAlt || '') ||
    parseWhatsAppJid(rawMessage?.key?.participantAlt || '') ||
    normalizePhone(rawRemoteJid);
  const phone: string | null = phoneDigits ? normalizePhone(phoneDigits) : null;
  if (!phone) return null;

  const normalizedMessage = unwrapMessageContainer(socketMessage);
  const rawType = Object.keys(normalizedMessage).find((key) => key !== 'messageContextInfo') || 'conversation';
  const content = getMessageContent(normalizedMessage);
  const timestamp = normalizeTimestamp(rawMessage.messageTimestamp ?? rawMessage.message?.messageTimestamp ?? Date.now());
  const externalId =
    String(rawMessage?.key?.id || rawMessage?.id || rawMessage?.messageId || rawMessage?.message?.key?.id || '').trim() ||
    `${rawRemoteJid}-${timestamp.getTime()}-${content || rawType}`;

  const contextInfo = extractContextInfo(normalizedMessage);
  const replyToExternalId: string | null = contextInfo?.stanzaId ? String(contextInfo.stanzaId) : null;

  return {
    externalId,
    phone,
    type: mapIncomingMessageType(rawType),
    content: String(content || '').trim(),
    timestamp,
    rawType,
    mediaUrl: null,
    mediaMimeType:
      normalizedMessage.imageMessage?.mimetype ||
      normalizedMessage.videoMessage?.mimetype ||
      normalizedMessage.audioMessage?.mimetype ||
      normalizedMessage.documentMessage?.mimetype ||
      normalizedMessage.stickerMessage?.mimetype ||
      null,
    mediaFileName:
      normalizedMessage.documentMessage?.fileName ||
      normalizedMessage.imageMessage?.fileName ||
      normalizedMessage.videoMessage?.fileName ||
      normalizedMessage.audioMessage?.fileName ||
      normalizedMessage.stickerMessage?.fileName ||
      null,
    mediaCaption:
      normalizedMessage.imageMessage?.caption ||
      normalizedMessage.videoMessage?.caption ||
      normalizedMessage.documentMessage?.caption ||
      normalizedMessage.stickerMessage?.caption ||
      null,
    mediaDuration: normalizedMessage.audioMessage?.seconds || null,
    rawMessage,
    replyToExternalId,
  };
}

function isIgnorableSocketPayload(rawMessage: any) {
  const normalizedMessage = unwrapMessageContainer(extractSocketMessage(rawMessage) || rawMessage?.message || rawMessage);
  if (!normalizedMessage) return true;

  const keys = Object.keys(normalizedMessage);
  return (
    keys.length === 0 ||
    keys.every((key) => ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'].includes(key))
  );
}

async function handleIncomingReaction(rawMessage: any, sessionId: string) {
  try {
    const msgContainer = rawMessage?.message || rawMessage;
    const reactionMsg = msgContainer?.reactionMessage;
    if (!reactionMsg) return;

    const emoji = reactionMsg.text ?? '';
    const originalExternalId = reactionMsg.key?.id;
    if (!originalExternalId) return;

    const reactorJid = rawMessage?.key?.remoteJid || '';
    const reactorPhone = parseWhatsAppJid(reactorJid) || normalizePhone(reactorJid) || '';
    if (!reactorPhone) return;

    const original = await prisma.message.findFirst({
      where: { externalId: originalExternalId },
      select: { id: true, conversationId: true },
    });
    if (!original) return;

    if (emoji === '') {
      await prisma.messageReaction.deleteMany({
        where: { messageId: original.id, contactPhone: reactorPhone },
      });
    } else {
      const existingContactReaction = await (prisma as any).messageReaction.findFirst({
        where: { messageId: original.id, contactPhone: reactorPhone },
      });
      if (existingContactReaction) {
        await prisma.messageReaction.update({ where: { id: existingContactReaction.id }, data: { emoji } });
      } else {
        await (prisma as any).messageReaction.create({
          data: { messageId: original.id, contactPhone: reactorPhone, emoji },
        });
      }
    }

    const reactions = await prisma.messageReaction.findMany({
      where: { messageId: original.id },
      include: { user: { select: { id: true, name: true } } },
    });
    const conv = await prisma.conversation.findUnique({ where: { id: original.conversationId }, select: { teamId: true } });
    emitRealtime('message:reaction', {
      conversationId: original.conversationId,
      messageId: original.id,
      reactions,
    }, conv?.teamId ?? null);
  } catch (err) {
    logger.warn('inbound.reaction_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

function normalizeWebhookMessage(rawMessage: any): NormalizedInboundMessage | null {
  if (!rawMessage) return null;
  const externalId = String(rawMessage.externalId || rawMessage.id || rawMessage.messageId || '').trim();
  const phone = normalizePhone(rawMessage.phone || rawMessage.from || rawMessage.sender || '');
  if (!externalId || !phone) return null;

  const rawType = String(rawMessage.type || rawMessage.messageType || 'text');
  const content = String(rawMessage.content || rawMessage.message || rawMessage.body || rawMessage.text || '').trim();

  return {
    externalId,
    phone,
    type: mapIncomingMessageType(rawType),
    content,
    timestamp: normalizeTimestamp(rawMessage.timestamp || rawMessage.createdAt || Date.now()),
    rawType,
    mediaUrl: rawMessage.mediaUrl || null,
    mediaMimeType: rawMessage.mediaMimeType || null,
    mediaFileName: rawMessage.mediaFileName || null,
    mediaCaption: rawMessage.mediaCaption || null,
    mediaDuration: rawMessage.mediaDuration || null,
    rawMessage,
    replyToExternalId: null,
  };
}

function normalizeRawMessage(rawMessage: any): NormalizedInboundMessage | null {
  if (rawMessage?.key || rawMessage?.message || rawMessage?.remoteJid) {
    return normalizeSocketMessage(rawMessage);
  }
  return normalizeWebhookMessage(rawMessage);
}

function resolveSystemPhone(sessionId: string) {
  return parseWhatsAppJid(sessionId) || normalizePhone(sessionId) || '';
}

function buildPreview(message: NormalizedInboundMessage) {
  return (message.content || message.mediaCaption || message.type).slice(0, 200);
}

async function saveOutboundEcho(normalized: NormalizedInboundMessage, rawMessage: any, sessionId: string) {
  const systemPhone = resolveSystemPhone(sessionId);
  const { conversation } = await getOrCreateConversationByPhone(normalized.phone, undefined, prisma) as any;

  let next = normalized;
  if (!next.mediaUrl && next.type !== MessageType.TEXT) {
    const downloadedMediaUrl = await downloadInboundMedia(rawMessage);
    if (downloadedMediaUrl) next = { ...next, mediaUrl: downloadedMediaUrl };
  }
  if (!next.mediaUrl && next.type === MessageType.IMAGE) {
    next = { ...next, mediaCaption: next.mediaCaption || next.content || 'image' };
  }

  const existing = await prisma.message.findFirst({
    where: { externalId: normalized.externalId, sessionId },
    select: { id: true },
  });
  if (existing) {
    return { status: 'duplicate' as const, messageId: existing.id, conversationId: conversation.id };
  }

  const teamId = (conversation as any).teamId ?? null;
  const provider: ProviderName = 'baileys';

  const nMsg = buildBaileysOutbound({
    phone: next.phone,
    sentMessageId: next.externalId,
    sessionId,
    systemPhone,
    timestamp: next.timestamp,
    conversationId: conversation.id,
    teamId,
    text: next.content || next.mediaCaption || '',
    media: next.mediaUrl ? {
      mediaUrl: next.mediaUrl,
      mediaMimeType: next.mediaMimeType ?? undefined,
      mediaFileName: next.mediaFileName ?? undefined,
      mediaCaption: next.mediaCaption ?? undefined,
      mediaDuration: next.mediaDuration ?? undefined,
    } : undefined,
  });

  const caps = getCapabilities(provider);
  const renderable = compileRenderable(nMsg, caps.defaultMode);
  const { messageId: persistedId } = await persistNormalizedMessage(nMsg, renderable);

  return { status: 'processed' as const, messageId: persistedId, conversationId: conversation.id };
}

async function finalizeFailedMessage(messageId: string, externalId: string, sessionId: string, error: string) {
  await prisma.message.updateMany({
    where: { id: messageId },
    data: {
      status: MsgStatus.FAILED,
      errorReason: error,
      retryCount: { increment: 1 },
    },
  });
  emitRealtime('message:status', { id: messageId, externalId, sessionId, status: 'failed', error });
}

export async function processIncomingMessage(rawMessage: any, context: { sessionId: string; provider?: ProviderName }) {
  const sessionId = String(context?.sessionId || '').trim();
  const systemPhone = resolveSystemPhone(sessionId);
  const receivedAt = new Date();
  logStep('received', { sessionId });
  logger.debug('inbound.raw_shape', {
    sessionId,
    keys: rawMessage ? Object.keys(rawMessage) : [],
    keyShape: rawMessage?.key ? Object.keys(rawMessage.key) : [],
    keyId: rawMessage?.key?.id,
    keyRemoteJid: rawMessage?.key?.remoteJid,
    keyParticipant: rawMessage?.key?.participant,
    messageKeys: rawMessage?.message ? Object.keys(rawMessage.message) : [],
  });

  if (!sessionId) {
    logger.error('inbound.failed', { step: 'validate', reason: 'missing sessionId' });
    return { status: 'failed' as const, error: 'Missing sessionId' };
  }

  try {
    // Handle contact reactions before the ignorable check
    const msgContainer = rawMessage?.message || rawMessage;
    if (msgContainer?.reactionMessage) {
      await handleIncomingReaction(rawMessage, sessionId);
      return { status: 'processed' as const };
    }

    if (rawMessage?.key && isIgnorableSocketPayload(rawMessage)) {
      logStep('ignored', {
        sessionId,
        reason: 'unsupported_socket_payload',
        externalId: rawMessage?.key?.id,
      });
      return { status: 'ignored' as const };
    }

    let normalized = normalizeRawMessage(rawMessage);

    if (!normalized) {
      logStep('ignored', { sessionId, reason: 'unrecognized payload' });
      logger.debug('inbound.payload_shape', {
        sessionId,
        keys: rawMessage ? Object.keys(rawMessage) : [],
        keyShape: rawMessage?.key ? Object.keys(rawMessage.key) : [],
        keyId: rawMessage?.key?.id,
        remoteJid: rawMessage?.key?.remoteJid,
        messageKeys: rawMessage?.message ? Object.keys(rawMessage.message) : [],
        nestedMessageKeys: rawMessage?.message?.message ? Object.keys(rawMessage.message.message) : [],
      });
      return { status: 'ignored' as const };
    }

    logger.info('inbound.normalized', {
      sessionId,
      externalId: normalized.externalId,
      phone: normalized.phone,
      type: normalized.type,
    });

    if (!normalized.externalId || !normalized.phone || (normalized.type === MessageType.TEXT && !normalized.content)) {
      logger.warn('inbound.failed', {
        sessionId,
        externalId: normalized.externalId,
        reason: 'missing required fields',
      });
      return { status: 'failed' as const, error: 'Missing required fields' };
    }

    if (rawMessage?.key?.fromMe) {
      return await saveOutboundEcho(normalized, rawMessage, sessionId);
    }

    if (!normalized.mediaUrl && normalized.type !== MessageType.TEXT) {
      const downloadedMediaUrl = await downloadInboundMedia(rawMessage);
      if (downloadedMediaUrl) {
        normalized = {
          ...normalized,
          mediaUrl: downloadedMediaUrl,
        };
      }
    }

    if (!normalized.mediaUrl && normalized.type === MessageType.IMAGE) {
      normalized = {
        ...normalized,
        mediaCaption: normalized.mediaCaption || normalized.content || 'image',
      };
    }

    logStep('validated', { sessionId, externalId: normalized.externalId, phone: normalized.phone });

    const duplicate = await prisma.message.findFirst({
      where: { externalId: normalized.externalId, sessionId },
      select: { id: true, conversationId: true },
    });
    if (duplicate) {
      logger.info('inbound.duplicate', { sessionId, externalId: normalized.externalId, messageId: duplicate.id });
      return { status: 'duplicate' as const, messageId: duplicate.id, conversationId: duplicate.conversationId };
    }

    logStep('dedupe_ok', { sessionId, externalId: normalized.externalId });

    const { contact, conversation, isNew } = await getOrCreateConversationByPhone(normalized.phone, undefined, prisma) as any;
    logStep('contact_resolved', { sessionId, contactId: contact.id, phone: normalized.phone });
    logStep('conversation_resolved', { sessionId, conversationId: conversation.id, contactId: contact.id, isNew });

    // Auto-assign new conversations to the least-busy available agent
    if (isNew && process.env.AUTO_ASSIGN_ENABLED !== 'false') {
      void autoAssignConversation(conversation.id).catch(() => { /* non-critical */ });
    }

    let createdMessageId: string | null = null;
    let createdConversationId = conversation.id;
    const body = buildPreview(normalized);
    const teamId = (conversation as any).teamId ?? null;

    try {
      // Resolve reply context — look up the DB message that was quoted
      let replyToId: string | null = null;
      let replyToBody: string | null = null;
      if (normalized.replyToExternalId) {
        try {
          const quoted = await prisma.message.findFirst({
            where: { externalId: normalized.replyToExternalId, sessionId },
            select: { id: true, body: true },
          });
          if (quoted) { replyToId = quoted.id; replyToBody = quoted.body ?? null; }
        } catch { /* non-critical — reply context is best-effort */ }
      }

      // Build NormalizedMessage + dual-write (legacy + normalized columns in one row)
      const provider: ProviderName = context.provider ?? 'baileys';
      const nMsg = buildNormalizedFromFlat(
        normalized,
        { sessionId, systemPhone, conversationId: conversation.id, teamId, provider, replyToId, replyToBody },
        rawMessage,
      );
      const caps = getCapabilities(provider);
      const renderable = compileRenderable(nMsg, caps.defaultMode);
      const { messageId: persistedId } = await persistNormalizedMessage(nMsg, renderable, {
        contactName: contact.name ?? null,
      });
      createdMessageId = persistedId;
      logger.info('inbound.saved', { sessionId, externalId: normalized.externalId, messageId: persistedId, conversationId: conversation.id });

      // unreadCount increment is not in persistNormalizedMessage — keep it separate
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: { increment: 1 } },
      });
      // Emit with isNewContact + unreadCount (supercedes the one from persistNormalizedMessage)
      emitRealtime('conversation:updated', {
        conversationId: conversation.id,
        lastMessageAt: normalized.timestamp.toISOString(),
        lastMessagePreview: body,
        unreadCount: conversation.unreadCount + 1,
        isNewContact: isNew,
      }, teamId);
      logStep('conversation_updated', { sessionId, conversationId: conversation.id });

      // ── Marketing consent ──────────────────────────────────────────────────
      // Runs before automations and the bot, and deliberately so. A customer who
      // types STOP must not receive an automated reply, a flow trigger, or a
      // chatbot greeting: answering an opt-out with more messages is precisely
      // what converts an annoyed recipient into a spam report, and a spam report
      // is what gets the business number restricted.
      let optedOut = false;
      try {
        ({ optedOut } = await applyInboundConsent(normalized.phone, normalized.content || body));
      } catch (consentError) {
        logger.warn('inbound.consent_check_failed', {
          phone: normalized.phone,
          error: consentError instanceof Error ? consentError.message : String(consentError),
        });
      }

      if (optedOut) {
        logStep('opt_out_honoured', { sessionId, conversationId: conversation.id });
        emitRealtime('contact:opted_out', { phone: normalized.phone, conversationId: conversation.id }, teamId);
      } else {
        await checkAutomationRules(normalized.phone, normalized.content || body);
        void stopFlowExecutionsOnReply(normalized.phone).catch(() => {});
        const teamId2 = teamId ?? undefined;
        void triggerFlows(normalized.phone, normalized.content || body, 'ANY_MESSAGE', teamId2).catch(() => {});
        if (normalized.content) {
          void triggerFlows(normalized.phone, normalized.content, 'KEYWORD', teamId2).catch(() => {});
        }
        logStep('automations_triggered', { sessionId, conversationId: conversation.id, messageId: persistedId });

        // ── Sprint 5: AI Bot hook ────────────────────────────────────────────
        // Debounced: a burst of rapid messages → one reply, after the customer pauses.
        aiBotService.scheduleInboundReply(
          conversation.id,
          normalized.content || body,
          { phone: normalized.phone, sessionId, teamId },
        );
      }

      // ── AI Lead Qualification hook ────────────────────────────────────────────
      // Debounced so a burst of messages triggers a single LLM pass after a quiet period.
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

      return {
        status: 'processed' as const,
        messageId: persistedId,
        conversationId: conversation.id,
      };
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
        await finalizeFailedMessage(createdMessageId, normalized.externalId, sessionId, message);
      }
      return { status: 'failed' as const, messageId: createdMessageId || undefined, conversationId: createdConversationId, error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('inbound.failed', { sessionId, error: message });
    return { status: 'failed' as const, error: message };
  } finally {
    void receivedAt;
  }
}

export async function downloadInboundMedia(rawMessage: any) {
  return await downloadMediaToUrl(rawMessage);
}
