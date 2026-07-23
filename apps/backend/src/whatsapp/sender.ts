import { prisma } from '../lib/prisma';
import { getTenantId } from '../lib/tenant-context';
import { getSock, getWaStatus, getSessionId, getAuthSessionId } from './client';
import { normalizePhone, normalizeRecipient, parseWhatsAppJid } from '../lib/phone';
import { getOrCreateConversationByPhone } from '../conversations/conversation-resolver';
import { retryAsync } from '../lib/retry';
import { logger } from '../lib/logger';
import { getWarmupPhase, createWarmupLimitError, startOfToday } from './warmup';
import { invalidateCache } from '../lib/status-cache';
import { buildBaileysOutbound } from '../messaging/normalizers/baileys.normalizer';
import { compileRenderable } from '../messaging/compile-renderable';
import { persistNormalizedMessage } from '../messaging/persist';
import { BAILEYS_CAPABILITIES } from '../messaging/capabilities';
import { interactiveMessageService } from '../services/interactive-message.service';
import { sendCarousel } from '../interactive/carousel';
import { sendButtons, sendCtaButtons, type ButtonHeader } from '../interactive/buttons';
import { sendListMenu } from '../interactive/lists';
import ffmpegPath from 'ffmpeg-static';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

type SendPayload = {
  text?: string;
  image?: Buffer;
  video?: Buffer;
  document?: Buffer;
  audio?: Buffer;
  sticker?: Buffer;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  ptt?: boolean;
};

function pickPayloadFromMedia(input?: {
  mediaBuffer?: Buffer;
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaCaption?: string;
  mediaDuration?: number;
  mediaIsVoiceNote?: boolean;
}) {
  if (!input?.mediaBuffer) return null;
  return {
    fileBuffer: input.mediaBuffer,
    fileName: input.mediaFileName || 'attachment',
    mimetype: input.mediaMimeType || 'application/octet-stream',
    caption: input.mediaCaption,
    duration: input.mediaDuration,
    isVoiceNote: input.mediaIsVoiceNote || false,
  };
}

/**
 * Check if the session has hit its warm-up daily limit.
 * Only enforced when the operator has enabled warm-up for this number via the UI.
 * Throws WarmupLimitError if limit is exceeded.
 */
async function checkWarmupGate(): Promise<void> {
  const sessionId = getAuthSessionId();
  if (!sessionId) return;
  const whatsappSession = await prisma.whatsAppSession.findUnique({
    where: { sessionId },
    select: { createdAt: true, warmupEnabled: true },
  });

  if (!whatsappSession) return;
  if (!whatsappSession.warmupEnabled) return; // Warm-up not enabled for this number

  const warmup = getWarmupPhase(whatsappSession.createdAt);
  if (!warmup.active || warmup.dailyLimit === null) return;

  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  let dailySent = 0;
  try {
    const analytics = await prisma.analytics.findFirst({
      where: { date: today },
      select: { outgoingMessages: true },
    });
    dailySent = analytics?.outgoingMessages ?? 0;
  } catch {
    dailySent = await prisma.message.count({
      where: { fromMe: true, timestamp: { gte: today, lt: tomorrow } },
    });
  }

  if (dailySent >= warmup.dailyLimit) {
    throw createWarmupLimitError(warmup.dailyLimit, dailySent, warmup);
  }
}

/** Atomically increment today's outgoing count and bust the 30-s status cache. */
async function incrementDailyOutgoingCount(): Promise<void> {
  const today = startOfToday();
  // Analytics is per-tenant per-day. Outbound sends always run inside a tenant
  // scope; if somehow none is set, skip (analytics is best-effort, non-critical).
  const tenantId = getTenantId();
  if (tenantId) {
    await prisma.analytics.upsert({
      where: { tenantId_date: { tenantId, date: today } },
      create: { date: today, outgoingMessages: 1, incomingMessages: 0 },
      update: { outgoingMessages: { increment: 1 } },
    }).catch(() => {});
  }
  invalidateCache(`whatsapp_session_${getAuthSessionId() ?? getSessionId()}`);
}

// Prefer the bundled ffmpeg-static binary when present; otherwise fall back to a
// system `ffmpeg` on PATH (the Docker image installs it via apt and skips the
// static download). If neither exists, spawn throws and the caller falls back to
// sending the original audio unconverted.
const FFMPEG_BIN: string = ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';

async function convertAudioToOggOpus(buffer: Buffer): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wa-audio-'));
  const inputPath = path.join(tempDir, 'input');
  const outputPath = path.join(tempDir, 'output.ogg');

  try {
    await writeFile(inputPath, buffer);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(FFMPEG_BIN, [
        '-y',
        '-i', inputPath,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '64k',
        '-f', 'ogg',
        outputPath,
      ]);

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });
    });

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function sendMessage(
  inputPhone: string,
  message: string,
  media?: {
    mediaBuffer?: Buffer;
    mediaMimeType?: string;
    mediaFileName?: string;
    mediaCaption?: string;
    mediaDuration?: number;
    mediaIsVoiceNote?: boolean;
    mediaUrl?: string;
  },
  replyTo?: { replyToId?: string; replyToBody?: string },
  clientId?: string,
  knownConversationId?: string,
  options?: { byBot?: boolean },
) {
  // Resolve the current tenant's socket from the ambient context.
  const sock = getSock();
  if (!sock || getWaStatus() !== 'connected') throw new Error('WhatsApp is not connected');

  // Check warm-up daily limit before proceeding
  await checkWarmupGate();

  const normalizedPhone = normalizePhone(inputPhone);
  if (!normalizedPhone) {
    logger.warn('invalid_phone', { inputPhone });
    throw new Error('Invalid phone number');
  }
  if (!message?.trim() && !media?.mediaBuffer) throw new Error('Message cannot be empty');

  const jid = normalizeRecipient(normalizedPhone);
  if (!jid) throw new Error('Invalid recipient');

  const waLookup = await sock.onWhatsApp(jid);
  const waEntry = waLookup?.[0];
  if (!waEntry?.exists) {
    throw new Error(`Recipient ${inputPhone} is not available on WhatsApp`);
  }

  const targetJid = waEntry.jid || jid;
  const mediaPayload = pickPayloadFromMedia(media);
  let payload: SendPayload = { text: message.trim() };

  if (mediaPayload) {
    const mime = mediaPayload.mimetype.toLowerCase();
    const isAudio = mime.startsWith('audio/');
    const isVoiceNote = Boolean(mediaPayload.isVoiceNote);
    let buffer = mediaPayload.fileBuffer;
    if (isAudio) {
      try {
        buffer = await convertAudioToOggOpus(mediaPayload.fileBuffer);
      } catch (err) {
        logger.warn('audio_convert_failed_using_original', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (mime.startsWith('image/')) {
      payload = { image: buffer, caption: mediaPayload.caption?.trim() || undefined, mimetype: mime };
    } else if (mime.startsWith('video/')) {
      payload = { video: buffer, caption: mediaPayload.caption?.trim() || undefined, mimetype: mime };
    } else if (isAudio) {
      payload = {
        audio: buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: isVoiceNote,
      };
    } else if (mime.includes('sticker')) {
      payload = { sticker: buffer };
    } else {
      payload = {
        document: buffer,
        fileName: mediaPayload.fileName,
        mimetype: mime,
        caption: mediaPayload.caption?.trim() || undefined,
      };
    }
  }

  // Build quoted message for Baileys if this is a reply
  let quotedMsg: any = undefined;
  if (replyTo?.replyToId) {
    try {
      const original = await prisma.message.findFirst({
        where: { id: replyTo.replyToId },
        select: { externalId: true, fromMe: true, body: true, type: true, mediaMimeType: true },
      });
      if (original?.externalId) {
        const msgType = (original.type || 'TEXT').toUpperCase();
        quotedMsg = {
          key: { remoteJid: targetJid, fromMe: original.fromMe, id: original.externalId },
          message:
            msgType === 'IMAGE'
              ? { imageMessage: { caption: original.body || '' } }
              : msgType === 'VIDEO'
              ? { videoMessage: { caption: original.body || '' } }
              : msgType === 'AUDIO'
              ? { audioMessage: { ptt: false } }
              : msgType === 'DOCUMENT'
              ? { documentMessage: { fileName: original.body || 'file' } }
              : { conversation: original.body || '' },
        };
      }
    } catch {
      // non-critical — send without quote if lookup fails
    }
  }

  const sentMessage = await retryAsync(
    async () => sock.sendMessage(targetJid, payload as any, quotedMsg ? { quoted: quotedMsg } : {}),
    {
      attempts: 3,
      delayMs: 300,
      onRetry: (error, attempt, delayMs) => {
        logger.warn('Retrying WhatsApp send', {
          phone: normalizedPhone,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    },
  );
  const sentMessageId = sentMessage?.key?.id;
  const sessionId = String(sock?.user?.id || process.env.WHATSAPP_SESSION_ID || 'default').trim();
  const systemPhone = parseWhatsAppJid(sock?.user?.id || '') || normalizePhone(sock?.user?.id || '') || normalizedPhone;
  const sentTimestamp = new Date((sentMessage?.messageTimestamp ? Number(sentMessage.messageTimestamp) : Date.now() / 1000) * 1000);

  let conversationRow: { id: string; teamId?: string | null };
  if (knownConversationId) {
    const found = await prisma.conversation.findUnique({
      where: { id: knownConversationId },
      select: { id: true, teamId: true },
    });
    if (!found) throw new Error('Conversation not found');
    conversationRow = found;
  } else {
    const { conversation: resolved } = await getOrCreateConversationByPhone(normalizedPhone);
    conversationRow = resolved;
  }
  const conversation = conversationRow;
  const teamId = (conversation as any).teamId ?? null;

  const normalizedMsg = buildBaileysOutbound({
    clientId,
    phone: normalizedPhone,
    sentMessageId: sentMessageId || `local-${Date.now()}`,
    sessionId,
    systemPhone,
    timestamp: sentTimestamp,
    conversationId: conversation.id,
    teamId,
    text: message,
    media: media
      ? {
          mediaUrl: media.mediaUrl,
          mediaMimeType: media.mediaMimeType,
          mediaFileName: media.mediaFileName,
          mediaCaption: media.mediaCaption,
          mediaDuration: media.mediaDuration,
          mediaIsVoiceNote: media.mediaIsVoiceNote,
        }
      : undefined,
    replyToId: replyTo?.replyToId ?? null,
    replyToBody: replyTo?.replyToBody ?? null,
  });

  const renderable = compileRenderable(normalizedMsg, BAILEYS_CAPABILITIES.defaultMode);
  const { messageId } = await persistNormalizedMessage(normalizedMsg, renderable);

  void incrementDailyOutgoingCount();

  // NOTE: a teammate replying no longer auto-pauses the bot. That "pause on
  // human reply" behaviour silently stopped the bot mid-conversation for hours,
  // which is not what we want: an enabled bot answers until it's explicitly
  // turned off (per-contact header toggle or the global switch). To hand a
  // single chat to a human, flip that chat's bot toggle OFF.

  return { id: messageId };
}

/**
 * Resolve an interactive message header to the ButtonHeader format expected by
 * sendButtons / sendCtaButtons / sendListMenu.
 *
 * The frontend sends headers in the messaging-schema format:
 *   { type: 'text', text: '...' }
 *   { type: 'media', media: { mediaType: 'image'|'video'|'document', url, mime, ... } }
 *
 * This helper normalises both shapes and fetches media from its URL when needed.
 */
async function resolveInteractiveHeader(header: unknown): Promise<import('../interactive/buttons').ButtonHeader | undefined> {
  if (!header || typeof header !== 'object') return undefined;
  const h = header as Record<string, any>;

  if (h.type === 'text' && h.text) {
    return { type: 'text', text: h.text };
  }

  // New schema: { type: 'media', media: { mediaType, url, mime, fileName } }
  if (h.type === 'media' && h.media?.url) {
    const mediaType = h.media.mediaType as 'image' | 'video' | 'document';
    if (!['image', 'video', 'document'].includes(mediaType)) return undefined;
    try {
      const resp = await fetch(h.media.url as string);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      return {
        type: mediaType,
        buffer,
        mimetype: h.media.mime as string | undefined,
        filename: h.media.fileName as string | undefined,
      };
    } catch (err) {
      logger.warn('interactive_header_media_fetch_failed', {
        url: h.media.url,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  return undefined;
}

/**
 * Send an interactive message (buttons/list/CTA/carousel) via Baileys native flow.
 * All four kinds send proper nativeFlowMessage / carouselMessage protos.
 * The full interactive structure is also persisted so the CRM renders real UI.
 */
export async function sendInteractiveViaBaileys(
  inputPhone: string,
  content: Record<string, unknown> & { kind: string },
  conversationId: string,
  clientId?: string,
): Promise<{ id: string }> {
  // Resolve the current tenant's socket from the ambient context.
  const sock = getSock();
  if (!sock || getWaStatus() !== 'connected') throw new Error('WhatsApp is not connected');

  // Check warm-up daily limit before proceeding
  await checkWarmupGate();

  const normalizedPhone = normalizePhone(inputPhone);
  if (!normalizedPhone) throw new Error('Invalid phone number');
  const jid = normalizeRecipient(normalizedPhone);
  if (!jid) throw new Error('Invalid recipient');

  // Text fallback stored in DB for legacy search/preview even when native is sent.
  const baileysText = interactiveMessageService.buildText(content as any);

  const onRetryLog = (error: unknown, attempt: number, delayMs: number) => {
    logger.warn('Retrying interactive WhatsApp send', {
      phone: normalizedPhone,
      attempt,
      delayMs,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  let sentMessage: any;
  let nativeMsgId: string | undefined;

  if (content.kind === 'interactive_carousel') {
    // ── Carousel: each card may carry an imageUrl that we fetch into a Buffer ──
    const rawCards = ((content as any).cards ?? []) as Array<{
      body: string;
      footer?: string;
      imageUrl?: string;
      buttons?: Array<{ kind: string; id?: string; title?: string; displayText?: string; url?: string }>;
    }>;

    const cards = await Promise.all(
      rawCards.map(async (card) => {
        let mediaBuffer: Buffer | undefined;
        if (card.imageUrl) {
          try {
            const resp = await fetch(card.imageUrl);
            if (resp.ok) mediaBuffer = Buffer.from(await resp.arrayBuffer());
          } catch {
            logger.warn('carousel_image_fetch_failed', { url: card.imageUrl });
          }
        }
        return {
          body:    card.body,
          footer:  card.footer,
          media:   mediaBuffer ? { buffer: mediaBuffer, type: 'image' as const } : undefined,
          buttons: (card.buttons ?? []).map((b) =>
            b.kind === 'cta_url'
              ? { kind: 'cta_url' as const, displayText: b.displayText ?? '', url: b.url ?? '' }
              : { kind: 'quick_reply' as const, id: b.id ?? '', title: b.title ?? '' },
          ),
        };
      }),
    );

    const result = await sendCarousel(sock, jid, cards, { simulateTyping: false });
    nativeMsgId = result.messageId;

  } else if (content.kind === 'interactive_buttons') {
    const buttons = ((content as any).buttons ?? []) as Array<{ id: string; title: string }>;
    if (!buttons.length) throw new Error('interactive_buttons requires at least one button');

    const header = await resolveInteractiveHeader((content as any).header);
    const result = await sendButtons(sock, jid, {
      // Enforce non-empty body — an empty body renders as an invisible bubble on mobile.
      body:   ((content as any).body as string | undefined)?.trim() || 'Choose an option',
      footer: (content as any).footer,
      header,
      buttons,
      simulateTyping: false,
    });
    nativeMsgId = result.messageId;

  } else if (content.kind === 'interactive_list') {
    // List messages only support plain-text headers — extract text string, drop media headers
    const rawHeader = (content as any).header;
    const listHeader: string | undefined = rawHeader?.type === 'text' && rawHeader?.text
      ? String(rawHeader.text)
      : undefined;
    const result = await sendListMenu(sock, jid, {
      body:       ((content as any).body as string | undefined)?.trim() || 'Select an option',
      buttonText: (content as any).buttonText,
      sections:   (content as any).sections ?? [],
      footer:     (content as any).footer,
      header:     listHeader,
      simulateTyping: false,
    });
    nativeMsgId = result.messageId;

  } else if (content.kind === 'interactive_cta') {
    // Support both schema format (cta: {displayText, url}) and array format (ctaButtons: [...])
    const rawCta = (content as any).cta as { displayText: string; url: string } | undefined;
    const rawCtaButtons = (content as any).ctaButtons as Array<{ displayText: string; url: string }> | undefined;
    const ctaButtons = rawCtaButtons?.length
      ? rawCtaButtons
      : rawCta ? [{ displayText: rawCta.displayText, url: rawCta.url }] : [];

    if (!ctaButtons.length) throw new Error('interactive_cta requires at least one CTA button');

    const header = await resolveInteractiveHeader((content as any).header);
    const result = await sendCtaButtons(sock, jid, {
      body:       ((content as any).body as string | undefined)?.trim() || 'View details',
      ctaButtons,
      footer:     (content as any).footer,
      header,
      simulateTyping: false,
    });
    nativeMsgId = result.messageId;

  } else {
    // Unknown kind — fall back to plain text.
    sentMessage = await retryAsync(
      async () => sock.sendMessage(jid, { text: baileysText }),
      { attempts: 3, delayMs: 300, onRetry: onRetryLog },
    );
  }

  if (nativeMsgId) {
    sentMessage = {
      key: { id: nativeMsgId, remoteJid: jid, fromMe: true },
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }

  const sentMessageId = sentMessage?.key?.id;
  const sessionId = String(sock?.user?.id || process.env.WHATSAPP_SESSION_ID || 'default').trim();
  const systemPhone = parseWhatsAppJid(sock?.user?.id || '') || normalizePhone(sock?.user?.id || '') || normalizedPhone;
  const sentTimestamp = new Date(
    (sentMessage?.messageTimestamp ? Number(sentMessage.messageTimestamp) : Date.now() / 1000) * 1000,
  );

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, teamId: true },
  });
  if (!conversation) throw new Error('Conversation not found');

  // Build normalized message with text content (for legacy columns), then
  // override content with the full interactive structure for DB + renderable.
  const base = buildBaileysOutbound({
    clientId,
    phone: normalizedPhone,
    sentMessageId: sentMessageId || `local-${Date.now()}`,
    sessionId,
    systemPhone,
    timestamp: sentTimestamp,
    conversationId,
    teamId: (conversation as any).teamId ?? null,
    text: baileysText,
  });

  const normalizedMsg = { ...base, content: content as any };
  const renderable = compileRenderable(normalizedMsg, 'baileys_native');
  const { messageId } = await persistNormalizedMessage(normalizedMsg, renderable);

  void incrementDailyOutgoingCount();

  return { id: messageId };
}
