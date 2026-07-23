import { MessageDirection as PrismaDirection, MessageType, MsgStatus } from '@prisma/client';
import type { NormalizedMessage, RenderablePayload, MessageContent, MessageStatus, MessageDTO } from '@crm/messaging-schema';
import { prisma } from '../lib/prisma';
import { emitRealtime } from '../realtime/socket';
import { emitEvent } from '../realtime/event-bus';

// ── Raw payload sanitisation ──────────────────────────────────────────────────

/**
 * Convert a provider's raw payload into something that can actually be stored in
 * a JSON column.
 *
 * Baileys hands us protobuf-backed objects. Prisma serialises a Json column with
 * `JSON.stringify`, which calls the payload's `toJSON()`, which delegates to
 * `this.constructor.toObject` — a method that does not exist on every generated
 * class in Baileys 7.x. The result was `TypeError: this.constructor.toObject is
 * not a function` thrown at the final INSERT, AFTER the message had been
 * normalised, validated, deduped and had its contact and conversation resolved.
 * Every inbound message was lost at the last step, and because `raw` is only
 * kept for debugging, the whole message was discarded for the sake of a field
 * nothing reads.
 *
 * Walking it into plain values sidesteps `toJSON()` entirely. Binary becomes
 * base64 and protobuf Longs become strings, both of which JSON can represent;
 * functions are dropped; depth is bounded so a cyclic or absurdly nested payload
 * can never hang the insert.
 */
function toStorableJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 16) return '[truncated]';

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value as number) ? value : null;
  if (type === 'bigint') return (value as bigint).toString();
  if (type === 'function' || type === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map((v) => toStorableJson(v, depth + 1));

  const obj = value as Record<string, unknown>;

  // protobufjs Long ({ low, high, unsigned }) — stringify rather than lose precision.
  if (typeof (obj as any).toString === 'function' && 'low' in obj && 'high' in obj) {
    try { return String(obj); } catch { return null; }
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    let child: unknown;
    try {
      child = toStorableJson(obj[key], depth + 1);
    } catch {
      continue; // a getter that throws must not take the message with it
    }
    if (child !== undefined) out[key] = child;
  }
  return out;
}

// ── Legacy column derivation ──────────────────────────────────────────────────

function legacyBody(content: MessageContent): string {
  switch (content.kind) {
    case 'text':                     return content.body;
    case 'media':                    return content.caption ?? '';
    case 'template':                 return content.templateName;
    case 'interactive_buttons':      return content.body;
    case 'interactive_list':         return content.body;
    case 'interactive_cta':          return content.body;
    case 'interactive_product':      return content.body ?? '';
    case 'interactive_product_list': return content.body;
    case 'location':                 return content.name ?? `${content.latitude},${content.longitude}`;
    case 'contact_card':             return content.contacts[0]?.name.formattedName ?? '';
    case 'order':                    return content.text ?? '';
    case 'system':                   return content.detail ?? content.event;
    case 'unknown':                  return content.text ?? '';
  }
}

function legacyType(content: MessageContent): MessageType {
  if (content.kind === 'media') {
    const mt = content.media.mediaType;
    if (mt === 'image' || mt === 'sticker') return MessageType.IMAGE;
    if (mt === 'video') return MessageType.VIDEO;
    if (mt === 'audio' || mt === 'voice') return MessageType.AUDIO;
    return MessageType.DOCUMENT;
  }
  if (content.kind.startsWith('interactive')) return MessageType.INTERACTIVE;
  return MessageType.TEXT;
}

function legacyMediaFields(content: MessageContent): {
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  mediaCaption: string | null;
  mediaDuration: number | null;
} {
  if (content.kind !== 'media') {
    return { mediaUrl: null, mediaMimeType: null, mediaFileName: null, mediaCaption: null, mediaDuration: null };
  }
  return {
    mediaUrl: content.media.url ?? null,
    mediaMimeType: content.media.mime ?? null,
    mediaFileName: content.media.fileName ?? null,
    mediaCaption: content.caption ?? null,
    mediaDuration: content.media.durationSec != null ? Math.round(content.media.durationSec) : null,
  };
}

const STATUS_MAP: Record<MessageStatus, MsgStatus> = {
  queued:             MsgStatus.QUEUED,
  sending:            MsgStatus.SENDING,
  provider_accepted:  MsgStatus.PROVIDER_ACCEPTED,
  server_confirmed:   MsgStatus.SERVER_CONFIRMED,
  delivered:          MsgStatus.DELIVERED,
  read:               MsgStatus.READ,
  received:           MsgStatus.RECEIVED,
  processed:          MsgStatus.PROCESSED,
  failed:             MsgStatus.FAILED,
  expired:            MsgStatus.EXPIRED,
};

function conversationPreview(content: MessageContent): string {
  const body = legacyBody(content);
  if (body) return body.slice(0, 120);
  switch (content.kind) {
    case 'media': return `[${content.media.mediaType}]`;
    case 'location': return '[Location]';
    case 'contact_card': return '[Contact]';
    case 'order': return '[Order]';
    case 'interactive_product': return '[Product]';
    case 'interactive_product_list': return '[Products]';
    default: return '[Message]';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PersistResult {
  /** The Prisma row id assigned by the DB. */
  messageId: string;
  /** The conversation that was updated. */
  conversationId: string;
}

/**
 * Single write path for the normalized message pipeline.
 *
 * Writes BOTH the legacy flat columns (schemaVersion=0 consumers keep working)
 * AND the Phase A normalized columns (schemaVersion=1). Equivalent to what
 * sender.ts and persist-outbound.ts do individually — those paths remain
 * untouched until Track B migrates providers to call this function instead.
 *
 * Pure side-effecting function: no return value beyond the assigned IDs.
 * The caller is responsible for resolving conversationId before calling.
 */
export interface PersistExtra {
  /** For group messages: E.164 phone of the individual participant who sent this. */
  senderPhone?: string | null;
  /** For group messages: WhatsApp display name (pushName) of the sender. */
  senderName?: string | null;
  /** CRM contact name (overrides phone/pushName in notification title). */
  contactName?: string | null;
}

export async function persistNormalizedMessage(
  msg: NormalizedMessage,
  renderable: RenderablePayload,
  extra?: PersistExtra,
): Promise<PersistResult> {
  const content = msg.content;
  // msg.direction is the schema's 'INBOUND'|'OUTBOUND' string literal, but the Prisma
  // generated MessageDirection enum shadows the name in scope — cast through any.
  const fromMe: boolean = (msg.direction as any) === 'outbound';
  const direction = fromMe ? PrismaDirection.OUTBOUND : PrismaDirection.INBOUND;
  const timestamp = new Date(msg.timestamp);

  // Legacy from/to: outbound = session sends to contact, inbound = contact sends to session
  const from = fromMe ? msg.sessionId : msg.contactPhone;
  const to   = fromMe ? msg.contactPhone : msg.sessionId;

  const body = legacyBody(content);
  const type = legacyType(content);
  const mediaFields = legacyMediaFields(content);
  const status = STATUS_MAP[msg.status] ?? MsgStatus.SENT;
  const externalId = msg.externalId ?? `pending-${msg.clientId}`;

  // ── Single atomic write ───────────────────────────────────────────────────
  const created = await prisma.message.create({
    data: {
      // ── Legacy columns (schemaVersion=0 readers) ──────────────────────────
      externalId,
      sessionId:     msg.sessionId,
      direction,
      from,
      to,
      phone:         msg.contactPhone,
      conversationId: msg.conversationId,
      fromMe,
      body,
      type,
      ...mediaFields,
      timestamp,
      status,
      errorReason:   msg.metadata.errorReason ?? null,
      retryCount:    msg.metadata.attemptCount ?? 0,
      replyToId:     msg.reply?.messageId ?? null,
      replyToBody:   msg.reply?.preview ?? null,
      // ── Group sender attribution ──────────────────────────────────────────
      ...(extra?.senderPhone != null ? { senderPhone: extra.senderPhone } : {}),
      ...(extra?.senderName  != null ? { senderName:  extra.senderName  } : {}),

      // ── Normalized columns (schemaVersion=1 readers) ──────────────────────
      schemaVersion: 1,
      clientId:      msg.clientId,
      provider:      msg.provider,
      kind:          content.kind,
      content:       content as any,
      metadata:      msg.metadata as any,
      raw:           toStorableJson(msg.raw) as any,
      renderable:    renderable as any,
    } as any,
    select: { id: true, conversationId: true },
  });

  const preview = conversationPreview(content);

  // ── Conversation update ───────────────────────────────────────────────────
  await prisma.conversation.update({
    where: { id: msg.conversationId },
    data: {
      lastMessage:        preview,
      lastMessagePreview: preview,
      lastMessageAt:      timestamp,
      // Track the customer's last message for the Meta 24h session window
      ...(!fromMe
        ? { lastInboundAt: timestamp }
        : {}),
    },
  });

  // ── Realtime event ────────────────────────────────────────────────────────
  // Emits the existing legacy shape so the current frontend keeps working.
  // Track D will migrate this to the RealtimeEvent envelope with seq numbers.
  emitRealtime(
    'message:new',
    {
      conversationId: msg.conversationId,
      contactName: extra?.contactName ?? null,
      message: {
        id:               created.id,
        externalId,
        sessionId:        msg.sessionId,
        direction:        msg.direction.toUpperCase(),
        from,
        to,
        phone:            msg.contactPhone,
        conversationId:   msg.conversationId,
        fromMe,
        body,
        type:             type.toString(),
        ...mediaFields,
        timestamp,
        status:           status.toString(),
        replyToId:        msg.reply?.messageId ?? null,
        replyToBody:      msg.reply?.preview ?? null,
        senderPhone:      extra?.senderPhone ?? null,
        senderName:       extra?.senderName  ?? null,
        contactName:      extra?.contactName ?? null,
        // Normalized fields — new renderer uses these when present
        schemaVersion:    1,
        clientId:         msg.clientId,
        kind:             content.kind,
        renderable,
      },
    },
    msg.teamId,
  );

  emitRealtime(
    'conversation:updated',
    {
      conversationId: msg.conversationId,
      lastMessage:    preview,
      lastMessageAt:  timestamp.toISOString(),
      fromMe,
    },
    msg.teamId,
  );

  // ── New envelope events (crm:event) — consumed by the Zustand store ──────
  if (msg.teamId) {
    const dto: MessageDTO = {
      schemaVersion: 1,
      id: created.id,
      clientId: msg.clientId,
      externalId: msg.externalId,
      provider: msg.provider,
      sessionId: msg.sessionId,
      conversationId: msg.conversationId,
      contactPhone: msg.contactPhone,
      teamId: msg.teamId,
      direction: msg.direction,
      content: msg.content,
      status: msg.status,
      reply: msg.reply,
      timestamp: msg.timestamp,
      renderable,
      meta: {
        sequenceNumber: 0,
        origin: msg.metadata.origin,
        errorReason: msg.metadata.errorReason,
        errorCode: msg.metadata.errorCode,
        compatibilityMode: msg.metadata.compatibilityMode,
        timestamps: msg.metadata.timestamps,
      },
    };
    emitEvent('message.created', { message: dto }, msg.teamId);
    emitEvent('conversation.updated', {
      conversationId: msg.conversationId,
      patch: {
        lastMessageAt:      timestamp.toISOString(),
        lastMessagePreview: preview,
        ...(!fromMe ? {} : {}),
      },
    }, msg.teamId);
  }

  return { messageId: created.id, conversationId: msg.conversationId };
}
