import { randomUUID } from 'crypto';
import type {
  NormalizedMessage,
  MessageContent,
  MessageMetadata,
  ReplyReference,
  Media,
  MediaType,
} from '@crm/messaging-schema';

// ── Shared context passed by the workflow layer ───────────────────────────────

export interface InboundContext {
  sessionId: string;       // Meta phoneNumberId
  systemPhone: string;     // Business phone number (human-readable)
  conversationId: string;
  teamId: string | null;
}

export interface MetaOutboundParams {
  /** Caller-generated UUID for optimistic reconciliation. Generated here if absent. */
  clientId?: string;
  contactPhone: string;    // recipient E.164
  wamid: string;
  sessionId: string;       // Meta phoneNumberId
  fromPhone: string;       // Business display phone
  conversationId: string;
  teamId: string | null;
  text?: string;
  media?: {
    url?: string;
    mimetype?: string;
    filename?: string;
    caption?: string;
    duration?: number;
  };
  replyToExternalId?: string | null;
  replyToPreview?: string | null;
  /**
   * Pre-built content for kinds this builder cannot infer from text/media alone
   * — templates and interactive messages. When present it wins outright, so the
   * CRM stores what was actually sent rather than a flattened text
   * approximation of it.
   */
  contentOverride?: MessageContent;
}

// ── Media helpers ─────────────────────────────────────────────────────────────

function metaMediaType(webhookType: string, isVoice?: boolean): MediaType {
  if (webhookType === 'sticker') return 'sticker';
  if (webhookType === 'audio' && isVoice) return 'voice';
  const map: Record<string, MediaType> = {
    image: 'image', video: 'video', audio: 'audio', document: 'document',
  };
  return map[webhookType] ?? 'document';
}

function buildInboundMedia(msg: any, type: string): Media {
  const entry = msg[type] ?? {};
  return {
    mediaType: metaMediaType(type, entry.voice),
    mime: entry.mime_type ?? null,
    url: entry.id ? `meta-media://${entry.id}` : null,
    providerMediaId: entry.id ?? null,
    fileName: entry.filename ?? null,
    sizeBytes: null,
    durationSec: null,
    width: null,
    height: null,
    thumbnailUrl: null,
  };
}

// ── Inbound content parser ────────────────────────────────────────────────────

function parseInboundContent(msg: any): MessageContent | null {
  const type: string = msg.type ?? 'text';

  switch (type) {
    case 'text':
      return { kind: 'text', body: msg.text?.body ?? '', previewUrl: false };

    case 'image':
    case 'sticker':
      return {
        kind: 'media',
        media: buildInboundMedia(msg, type === 'sticker' ? 'sticker' : 'image'),
        caption: msg[type === 'sticker' ? 'sticker' : 'image']?.caption ?? undefined,
      };

    case 'video':
      return { kind: 'media', media: buildInboundMedia(msg, 'video'), caption: msg.video?.caption ?? undefined };

    case 'audio':
      return { kind: 'media', media: buildInboundMedia(msg, 'audio') };

    case 'document':
      return {
        kind: 'media',
        media: buildInboundMedia(msg, 'document'),
        caption: msg.document?.caption ?? undefined,
      };

    case 'button':
      // Quick-reply selection — customer echoes button text as a text message
      return { kind: 'text', body: msg.button?.text ?? msg.button?.payload ?? '' };

    case 'interactive': {
      const sub = msg.interactive?.type;
      if (sub === 'button_reply') return { kind: 'text', body: msg.interactive.button_reply?.title ?? '' };
      if (sub === 'list_reply')   return { kind: 'text', body: msg.interactive.list_reply?.title ?? '' };
      return { kind: 'unknown', providerKind: `interactive/${sub ?? '?'}`, text: '' };
    }

    case 'location':
      return {
        kind: 'location',
        latitude: Number(msg.location?.latitude ?? 0),
        longitude: Number(msg.location?.longitude ?? 0),
        name: msg.location?.name ?? undefined,
        address: msg.location?.address ?? undefined,
      };

    case 'contacts':
      return {
        kind: 'contact_card',
        contacts: (msg.contacts ?? []).map((c: any) => ({
          name: {
            formattedName: c.name?.formatted_name ?? '',
            firstName: c.name?.first_name,
            lastName: c.name?.last_name,
          },
          phones: c.phones?.map((p: any) => ({ phone: p.phone, type: p.type, waId: p.wa_id })),
          emails: c.emails?.map((e: any) => ({ email: e.email, type: e.type })),
          org: c.org,
          addresses: c.addresses,
          birthday: c.birthday,
        })),
      };

    case 'order': {
      const o = msg.order ?? {};
      return {
        kind: 'order',
        catalogId: o.catalog_id ?? '',
        text: o.text ?? undefined,
        items: (o.product_items ?? []).map((i: any) => ({
          productRetailerId: i.product_retailer_id ?? '',
          quantity: Number(i.quantity ?? 1),
          itemPrice: Number(i.item_price ?? 0),
          currency: i.currency ?? 'USD',
        })),
      };
    }

    default:
      return { kind: 'unknown', providerKind: type, text: '' };
  }
}

function buildMetadata(overrides: Partial<MessageMetadata> = {}): MessageMetadata {
  const now = new Date().toISOString();
  return {
    sequenceNumber: 0,
    traceId: randomUUID(),
    attemptCount: 0,
    errorReason: null,
    errorCode: null,
    compatibilityMode: 'cloud_api',
    timestamps: { received: now },
    origin: null,
    originRef: null,
    rawRetained: true,
    ...overrides,
  };
}

// ── Public: inbound normalizer ────────────────────────────────────────────────

/**
 * Convert a single Meta Cloud API webhook message object into a NormalizedMessage.
 * Called AFTER the workflow layer resolves the conversation and sets context.
 * Returns null for reaction messages (handled via the reaction side-channel).
 */
export function normalizeMetaInbound(
  msg: any,
  context: InboundContext,
): NormalizedMessage | null {
  if (!msg?.id || !msg?.from) return null;
  if (msg.type === 'reaction') return null;

  const content = parseInboundContent(msg);
  if (!content) return null;

  const reply: ReplyReference | null = msg.context?.id
    ? { messageId: null, externalId: msg.context.id, preview: '', kind: 'text' }
    : null;

  return {
    schemaVersion: 1,
    id: null,
    clientId: randomUUID(),
    externalId: msg.id,
    provider: 'meta',
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    contactPhone: msg.from,
    teamId: context.teamId,
    direction: 'inbound',
    content,
    status: 'received',
    metadata: buildMetadata(),
    reply,
    timestamp: msg.timestamp
      ? new Date(Number(msg.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    raw: msg,
  };
}

// ── Public: outbound builder ──────────────────────────────────────────────────

/**
 * Build a NormalizedMessage for an outbound Meta send.
 * Called AFTER the Meta API returns the wamid — status is `provider_accepted`.
 */
export function buildMetaOutbound(params: MetaOutboundParams): NormalizedMessage {
  const now = new Date().toISOString();

  let content: MessageContent;
  if (params.contentOverride) {
    content = params.contentOverride;
  } else if (params.media?.url || params.media?.mimetype) {
    const mime = params.media.mimetype ?? 'application/octet-stream';
    let mediaType: MediaType = 'document';
    if (mime.startsWith('image/')) mediaType = mime === 'image/webp' ? 'sticker' : 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';
    else if (mime.startsWith('audio/')) mediaType = 'audio';
    content = {
      kind: 'media',
      media: {
        mediaType,
        mime,
        url: params.media.url ?? null,
        providerMediaId: null,
        fileName: params.media.filename ?? null,
        sizeBytes: null,
        durationSec: params.media.duration ?? null,
        width: null,
        height: null,
        thumbnailUrl: null,
      },
      caption: params.media.caption ?? undefined,
    };
  } else {
    content = { kind: 'text', body: params.text ?? '', previewUrl: false };
  }

  const reply: ReplyReference | null = params.replyToExternalId
    ? { messageId: null, externalId: params.replyToExternalId, preview: params.replyToPreview ?? '', kind: 'text' }
    : null;

  return {
    schemaVersion: 1,
    id: null,
    clientId: params.clientId ?? randomUUID(),
    externalId: params.wamid,
    provider: 'meta',
    sessionId: params.sessionId,
    conversationId: params.conversationId,
    contactPhone: params.contactPhone,
    teamId: params.teamId,
    direction: 'outbound',
    content,
    status: 'provider_accepted',
    metadata: buildMetadata({
      attemptCount: 1,
      compatibilityMode: 'cloud_api',
      timestamps: { provider_accepted: now },
      origin: 'agent',
      rawRetained: false,
    }),
    reply,
    timestamp: now,
    raw: null,
  };
}
