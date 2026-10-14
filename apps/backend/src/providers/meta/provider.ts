import type { MessageContent, Media } from '@crm/messaging-schema';
import type {
  MessagingProvider,
  ProviderName,
  ProviderStatus,
  SendMessageInput,
  OutboundInteractive,
  OutboundTemplate,
} from '../types';
import { asMetaError, graphRequest } from './graph';
import { uploadMedia } from './media';
import { buildTemplatePayload } from './templates';
import { getChannel, recordSync, type CloudApiConfig } from '../channel.service';
import { normalizePhone } from '../../lib/phone';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { requireTenantId } from '../../lib/tenant-context';
import { loadMedia } from '../../lib/media';
import { getOrCreateConversationByPhone } from '../../conversations/conversation-resolver';
import { buildMetaOutbound } from '../../messaging/normalizers/meta.normalizer';
import { compileRenderable } from '../../messaging/compile-renderable';
import { persistNormalizedMessage } from '../../messaging/persist';
import { HttpError } from '../../auth/authorize';

/**
 * WhatsApp Business Cloud API provider.
 *
 * Credentials are resolved from the tenant's WhatsAppChannel on every call
 * rather than captured at construction. That costs a cached lookup per send and
 * buys the guarantee that a tenant who has just fixed an expired token starts
 * working immediately — a provider instance holding stale credentials would keep
 * failing until the process restarted.
 */
export class MetaWhatsAppProvider implements MessagingProvider {
  readonly name: ProviderName = 'meta';

  private async config(): Promise<CloudApiConfig> {
    const channel = await getChannel();
    if (!channel.cloud) {
      throw new HttpError(
        409,
        'This account is not connected to the WhatsApp Business API yet. Add your Phone Number ID and access token in Settings.',
        'CLOUD_API_NOT_CONFIGURED',
      );
    }
    if (channel.restrictedUntil && channel.restrictedUntil > new Date()) {
      throw new HttpError(
        403,
        'Meta has temporarily restricted this WhatsApp number. Sending will resume automatically once the restriction lifts.',
        'CHANNEL_RESTRICTED',
      );
    }
    return channel.cloud;
  }

  /**
   * Verify the stored credentials and mirror Meta's view of the number.
   *
   * There is no socket to open — "connecting" a Cloud API channel means proving
   * the token works and caching what Meta says about the number's health, which
   * is exactly what the Settings screen needs to show.
   */
  async connect(): Promise<void> {
    const tenantId = requireTenantId();
    const cloud = await this.config();

    try {
      const info = await graphRequest<{
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        messaging_limit_tier?: string;
      }>({
        path: `/${cloud.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
        accessToken: cloud.accessToken,
      });

      const rating = (info.quality_rating ?? '').toUpperCase();
      await recordSync(tenantId, {
        displayPhoneNumber: normalizePhone(info.display_phone_number ?? '') ?? info.display_phone_number ?? null,
        verifiedName: info.verified_name ?? null,
        qualityRating: rating === 'GREEN' || rating === 'YELLOW' || rating === 'RED' ? rating : 'UNKNOWN',
        messagingLimit: info.messaging_limit_tier ?? null,
        error: null,
      });

      logger.info('meta.connected', {
        tenantId,
        phone: info.display_phone_number,
        quality: rating,
        tier: info.messaging_limit_tier,
      });
    } catch (err) {
      const meta = asMetaError(err);
      // Record the failure so Settings can explain it instead of showing a
      // number that looks connected but silently refuses every send.
      await recordSync(tenantId, { error: meta.userMessage });
      throw new HttpError(meta.requiresReauth ? 401 : 502, meta.userMessage, `META_${meta.kind}`);
    }
  }

  /**
   * Nothing to tear down — there is no persistent connection. Credential removal
   * is `channel.service.disconnectCloud()`, a deliberately separate and more
   * explicit action.
   */
  async disconnect(): Promise<void> {
    /* no-op */
  }

  async getStatus(): Promise<ProviderStatus> {
    const channel = await getChannel();

    if (!channel.cloud) {
      return {
        status: 'disconnected',
        connectedPhone: null,
        error: channel.lastSyncError ? { message: channel.lastSyncError } : null,
        health: null,
      };
    }

    const restricted = channel.restrictedUntil != null && channel.restrictedUntil > new Date();

    return {
      // A restricted number is configured but cannot send, which is materially
      // different from "not set up" — report it as disconnected so every
      // existing gate (broadcast preflight, send guards) refuses rather than
      // burning attempts against a number Meta is rejecting.
      status: restricted ? 'disconnected' : 'connected',
      connectedPhone: channel.cloud.displayPhoneNumber ?? channel.cloud.phoneNumberId,
      error: restricted
        ? { message: 'Meta has temporarily restricted this number.' }
        : channel.lastSyncError
          ? { message: channel.lastSyncError }
          : null,
      health: {
        qualityRating: channel.qualityRating,
        messagingLimit: channel.messagingLimit,
        restrictedUntil: channel.restrictedUntil,
      },
    };
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<{ messageId: string }> {
    const cloud = await this.config();

    const phone = normalizePhone(input.phone);
    if (!phone) throw new HttpError(400, 'Invalid phone number');
    // Meta wants digits only, no leading '+'.
    const to = phone.replace(/\D/g, '');

    // Resolve the reply target once; both the Graph payload and the persisted
    // row need it.
    let replyExternalId: string | null = null;
    if (input.replyTo?.id) {
      const original = await prisma.message.findUnique({
        where: { id: input.replyTo.id },
        select: { externalId: true },
      });
      replyExternalId = original?.externalId ?? null;
    }

    const base: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...(replyExternalId ? { context: { message_id: replyExternalId } } : {}),
    };

    const built = await this.buildPayload(input, base, cloud);

    let wamid: string;
    try {
      const result = await graphRequest<{ messages?: Array<{ id: string }> }>({
        path: `/${cloud.phoneNumberId}/messages`,
        accessToken: cloud.accessToken,
        method: 'POST',
        body: built.payload,
        // A send is not idempotent at Meta: a retried request the server did
        // receive delivers the message twice and bills two conversations.
        // Retries here are limited to failures Meta marks transient, which by
        // definition were not accepted.
        maxAttempts: 2,
      });

      wamid = result?.messages?.[0]?.id ?? '';
      if (!wamid) throw new HttpError(502, 'WhatsApp accepted the message but returned no ID.');
    } catch (err) {
      const meta = asMetaError(err);
      logger.error('meta.send_failed', {
        phone: to,
        kind: built.kind,
        code: meta.code,
        failure: meta.kind,
        trace: meta.traceId,
      });
      throw new HttpError(
        meta.requiresTemplate ? 409 : meta.requiresReauth ? 401 : 502,
        meta.userMessage,
        `META_${meta.kind}`,
      );
    }

    // ── Persist through the shared pipeline ─────────────────────────────────
    let conversation: { id: string; teamId?: string | null };
    if (input.conversationId) {
      const found = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, teamId: true },
      });
      if (!found) throw new HttpError(404, 'Conversation not found');
      conversation = found;
    } else {
      const { conversation: resolved } = await getOrCreateConversationByPhone(phone);
      conversation = resolved;
    }

    const msg = buildMetaOutbound({
      clientId: input.clientId,
      contactPhone: phone,
      wamid,
      sessionId: cloud.phoneNumberId,
      fromPhone: cloud.displayPhoneNumber ?? cloud.phoneNumberId,
      conversationId: conversation.id,
      teamId: conversation.teamId ?? null,
      text: built.storedText,
      media: input.media
        ? {
            url: input.media.url,
            mimetype: input.media.mimetype,
            filename: input.media.filename,
            caption: input.media.caption,
            duration: input.media.duration,
          }
        : undefined,
      replyToExternalId: replyExternalId,
      replyToPreview: input.replyTo?.body ?? null,
      contentOverride: built.content,
    });

    const renderable = compileRenderable(msg, 'cloud_api');
    await persistNormalizedMessage(msg, renderable);

    return { messageId: wamid };
  }

  /**
   * Turn a SendMessageInput into a Graph payload plus the canonical content to
   * store. Order matters: a template is the whole message, so it wins over any
   * text that was also supplied.
   */
  private async buildPayload(
    input: SendMessageInput,
    base: Record<string, unknown>,
    cloud: CloudApiConfig,
  ): Promise<{ payload: any; kind: string; storedText?: string; content?: MessageContent }> {
    if (input.template) {
      return this.buildTemplate(input.template, base, cloud);
    }

    if (input.interactive) {
      return this.buildInteractive(input.interactive, base);
    }

    if (input.media) {
      return this.buildMedia(input, base, cloud);
    }

    const text = input.text ?? '';
    if (!text.trim()) throw new HttpError(400, 'Message text is empty');

    return {
      payload: { ...base, type: 'text', text: { preview_url: true, body: text } },
      kind: 'text',
      storedText: text,
    };
  }

  private async buildTemplate(
    template: OutboundTemplate,
    base: Record<string, unknown>,
    cloud: CloudApiConfig,
  ) {
    let headerMedia: { mediaId?: string; format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; filename?: string } | null = null;

    if (template.headerMedia?.storageRef) {
      const loaded = await loadMedia(
        template.headerMedia.storageRef,
        template.headerMedia.format,
        template.headerMedia.filename,
      );
      if (loaded) {
        const mediaId = await uploadMedia({
          buffer: loaded.buffer,
          mimetype: loaded.mimetype,
          filename: template.headerMedia.filename ?? undefined,
          phoneNumberId: cloud.phoneNumberId,
          accessToken: cloud.accessToken,
        });
        headerMedia = {
          mediaId,
          format: template.headerMedia.format,
          filename: template.headerMedia.filename ?? undefined,
        };
      } else {
        // The approved template declares a header, so sending without one is a
        // guaranteed 132000 from Meta. Fail with something the tenant can act on.
        throw new HttpError(400, 'The template header attachment could not be read. Re-upload it and try again.');
      }
    }

    const payload = {
      ...base,
      type: 'template',
      template: buildTemplatePayload({
        name: template.name,
        language: template.language,
        bodyValues: template.bodyValues,
        headerMedia,
      }),
    };

    const variables: Record<string, string> = {};
    template.bodyValues.forEach((v, i) => { variables[String(i + 1)] = v; });

    const content: MessageContent = {
      kind: 'template',
      templateName: template.name,
      templateLanguage: template.language,
      templateId: template.templateId ?? null,
      metaTemplateId: null,
      components: [{ type: 'body', text: template.renderedBody ?? template.bodyValues.join(' ') }],
      variables,
    };

    return {
      payload,
      kind: 'template',
      // The rendered body is what the customer saw, so it is what the chat
      // transcript and the conversation preview must show.
      storedText: template.renderedBody,
      content,
    };
  }

  private buildInteractive(interactive: OutboundInteractive, base: Record<string, unknown>) {
    const header = interactive.headerText ? { type: 'text', text: interactive.headerText } : undefined;
    const footer = interactive.footer ? { text: interactive.footer } : undefined;

    let action: any;
    let content: MessageContent;

    switch (interactive.kind) {
      case 'interactive_buttons': {
        const buttons = interactive.buttons ?? [];
        if (buttons.length === 0) throw new HttpError(400, 'An interactive message needs at least one button.');
        action = {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        };
        content = {
          kind: 'interactive_buttons',
          ...(interactive.headerText ? { header: { type: 'text', text: interactive.headerText } } : {}),
          body: interactive.body,
          ...(interactive.footer ? { footer: interactive.footer } : {}),
          buttons: buttons.map((b) => ({ id: b.id, title: b.title })),
        };
        break;
      }

      case 'interactive_list': {
        const sections = interactive.sections ?? [];
        if (sections.length === 0) throw new HttpError(400, 'A list message needs at least one section.');
        action = {
          button: (interactive.buttonText || 'Options').slice(0, 20),
          sections: sections.slice(0, 10).map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          })),
        };
        content = {
          kind: 'interactive_list',
          ...(interactive.headerText ? { header: { type: 'text', text: interactive.headerText } } : {}),
          body: interactive.body,
          ...(interactive.footer ? { footer: interactive.footer } : {}),
          buttonText: interactive.buttonText || 'Options',
          sections: sections.map((s) => ({
            title: s.title,
            rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
          })),
        };
        break;
      }

      case 'interactive_cta': {
        if (!interactive.cta) throw new HttpError(400, 'A call-to-action message needs a URL.');
        action = {
          name: 'cta_url',
          parameters: {
            display_text: interactive.cta.displayText.slice(0, 20),
            url: interactive.cta.url,
          },
        };
        content = {
          kind: 'interactive_cta',
          ...(interactive.headerText ? { header: { type: 'text', text: interactive.headerText } } : {}),
          body: interactive.body,
          ...(interactive.footer ? { footer: interactive.footer } : {}),
          cta: interactive.cta,
        };
        break;
      }
    }

    const typeByKind: Record<OutboundInteractive['kind'], string> = {
      interactive_buttons: 'button',
      interactive_list: 'list',
      interactive_cta: 'cta_url',
    };

    return {
      payload: {
        ...base,
        type: 'interactive',
        interactive: {
          type: typeByKind[interactive.kind],
          ...(header ? { header } : {}),
          body: { text: interactive.body },
          ...(footer ? { footer } : {}),
          action,
        },
      },
      kind: interactive.kind,
      storedText: interactive.body,
      content,
    };
  }

  private async buildMedia(input: SendMessageInput, base: Record<string, unknown>, cloud: CloudApiConfig) {
    const media = input.media!;
    const mime = media.mimetype.toLowerCase();
    const caption = media.caption ?? input.text;

    // Prefer uploading bytes over passing a link: a link makes delivery depend
    // on Meta reaching our storage at that moment, so a private bucket or a
    // momentary outage becomes an undeliverable message.
    let ref: Record<string, string>;
    if (media.buffer?.length) {
      ref = {
        id: await uploadMedia({
          buffer: media.buffer,
          mimetype: media.mimetype,
          filename: media.filename,
          phoneNumberId: cloud.phoneNumberId,
          accessToken: cloud.accessToken,
        }),
      };
    } else if (media.url) {
      ref = { link: media.url };
    } else {
      throw new HttpError(400, 'Attachment has no file data.');
    }

    let payload: any;
    let mediaType: Media['mediaType'];

    if (mime.startsWith('image/')) {
      payload = { ...base, type: 'image', image: { ...ref, ...(caption ? { caption } : {}) } };
      mediaType = 'image';
    } else if (mime.startsWith('video/')) {
      payload = { ...base, type: 'video', video: { ...ref, ...(caption ? { caption } : {}) } };
      mediaType = 'video';
    } else if (mime.startsWith('audio/')) {
      // Meta has no caption on audio and no separate voice-note type — a voice
      // note is simply an audio message with an OGG/Opus body.
      payload = { ...base, type: 'audio', audio: ref };
      mediaType = media.isVoiceNote ? 'voice' : 'audio';
    } else {
      payload = {
        ...base,
        type: 'document',
        document: {
          ...ref,
          ...(media.filename ? { filename: media.filename } : {}),
          ...(caption ? { caption } : {}),
        },
      };
      mediaType = 'document';
    }

    return {
      payload,
      kind: `media:${mediaType}`,
      storedText: caption,
    };
  }

  // ── Reactions ──────────────────────────────────────────────────────────────

  async sendReaction(
    phone: string,
    messageExternalId: string,
    _fromMe: boolean,
    emoji: string,
  ): Promise<void> {
    const cloud = await this.config();
    try {
      await graphRequest({
        path: `/${cloud.phoneNumberId}/messages`,
        accessToken: cloud.accessToken,
        method: 'POST',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone.replace(/\D/g, ''),
          type: 'reaction',
          // An empty emoji is how Meta models removing a reaction.
          reaction: { message_id: messageExternalId, emoji },
        },
      });
    } catch (err) {
      const meta = asMetaError(err);
      throw new HttpError(502, meta.userMessage, `META_${meta.kind}`);
    }
  }

  /**
   * Meta does not expose customer profile photos — there is no endpoint for it,
   * by design. Null is the honest answer; the UI falls back to initials.
   */
  async getProfilePictureUrl(_phone: string): Promise<string | null> {
    return null;
  }
}
