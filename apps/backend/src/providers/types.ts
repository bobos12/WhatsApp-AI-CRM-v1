import type { ProviderName as SchemaProviderName } from '@crm/messaging-schema';

/**
 * The transports this build implements — the official Cloud API, and only it.
 *
 * The shared schema's union is deliberately wider (baileys, twilio, 360dialog)
 * for forward compatibility and to keep historical rows readable. Narrowing here
 * means reintroducing a transport without implementing it is a type error rather
 * than a runtime `undefined` at the first send.
 */
export type ProviderName = Extract<SchemaProviderName, 'meta'>;

/**
 * An approved WhatsApp template plus the values to fill it with.
 *
 * On the Cloud API this is the only content that delivers outside the 24h
 * customer service window, so it is a first-class send input rather than a
 * special case layered on top of text.
 */
export interface OutboundTemplate {
  /** Local MessageTemplate.id, for attribution on the persisted message. */
  templateId?: string;
  /** Template name as approved by Meta (already slugified). */
  name: string;
  /** BCP-47 code Meta approved it under, e.g. "en_US". */
  language: string;
  /** Positional values — index 0 fills `{{1}}`. */
  bodyValues: string[];
  /** Header attachment, when the approved template declares one. */
  headerMedia?: {
    /** Storage-relative ref; uploaded to Meta at send time. */
    storageRef?: string | null;
    format: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    filename?: string | null;
  } | null;
  /** Rendered body text, stored so the CRM shows what the customer received. */
  renderedBody?: string;
}

/**
 * Structured interactive content.
 *
 * Baileys flattens this to a numbered text menu (WhatsApp Web cannot deliver
 * real interactive payloads); the Cloud API sends it natively as tappable
 * buttons. Passing the structure through — instead of pre-flattening it at the
 * call site, as the old code did — is what lets each provider do its best.
 */
export interface OutboundInteractive {
  kind: 'interactive_buttons' | 'interactive_list' | 'interactive_cta';
  headerText?: string;
  body: string;
  footer?: string;
  /** interactive_buttons: 1–3 quick replies. */
  buttons?: Array<{ id: string; title: string }>;
  /** interactive_list: the label on the button that opens the sheet. */
  buttonText?: string;
  sections?: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  /** interactive_cta: a single URL button. */
  cta?: { displayText: string; url: string };
}

export interface SendMessageInput {
  /** Caller-generated UUID for idempotency and optimistic reconciliation. */
  clientId?: string;
  /** Known conversation ID — skips resolver lookup so the socket event lands in the right chat. */
  conversationId?: string;
  phone: string;
  text?: string;
  media?: {
    buffer: Buffer;
    mimetype: string;
    filename?: string;
    caption?: string;
    duration?: number;
    isVoiceNote?: boolean;
    url?: string;
  };
  /** Mutually exclusive with `text`/`media` — a template IS the message. */
  template?: OutboundTemplate;
  /** Structured interactive content, rendered per provider capability. */
  interactive?: OutboundInteractive;
  replyTo?: {
    id: string;
    body: string;
  };
}

export interface ProviderStatus {
  /**
   * There is no socket to be "connecting" on the Cloud API — a channel either
   * has working credentials or it does not. `connecting` is retained only for
   * the brief window while the setup wizard verifies newly entered credentials.
   */
  status: 'connected' | 'disconnected' | 'connecting';
  connectedPhone?: string | null;
  error?: { statusCode?: number; reason?: string; message?: string } | null;
  /**
   * Cloud API only — Meta's own health signals, surfaced so the UI can warn
   * before a number is restricted rather than after sends start failing.
   */
  health?: {
    qualityRating: 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED';
    messagingLimit: string | null;
    restrictedUntil: Date | null;
  } | null;
}

export interface MessagingProvider {
  readonly name: ProviderName;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Async because Cloud API status is a database read (per-tenant credentials),
   * where Baileys status is in-process socket state.
   */
  getStatus(): Promise<ProviderStatus>;
  sendMessage(input: SendMessageInput): Promise<{ messageId: string }>;
  sendReaction(phone: string, messageExternalId: string, fromMe: boolean, emoji: string): Promise<void>;
  getProfilePictureUrl(phone: string): Promise<string | null>;
}
