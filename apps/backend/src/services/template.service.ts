import {
  isCanonicalPayload,
  isLegacyPayload,
  toRenderable,
  legacyBlocksToCanonical,
  foldLegacyCanonical,
  extractVariableNames,
  type CanonicalMedia,
  type CanonicalTemplate,
  type MediaType,
  type RenderableTemplate,
} from '../lib/template-compiler';
import { providerManager } from '../providers/manager';
import { loadMedia, isAudioMediaType, resolveMediaUrl, toStorageRef } from '../lib/media';
import { logger } from '../lib/logger';
import { toMetaTemplateName, approvedExtras } from '../providers/meta/templates';

/**
 * A template's attachment is recorded in two places: inside the canonical
 * `payload.media` blob, and in the dedicated `mediaUrl`/`mediaType`/
 * `mediaFilename`/`mediaMimeType` columns.
 *
 * That is deliberate, not redundant. Templates saved before the canonical
 * payload existed only have the columns; templates written by the builder only
 * used to have the payload; and a broadcast saved as a template needs its
 * attachment queryable without parsing JSON. Reading merges both, preferring the
 * payload but never dropping an attachment that lives only in a column — which
 * is exactly how media used to disappear when a template was loaded back.
 */
function mediaFromColumns(template: any): CanonicalMedia | undefined {
  const url = toStorageRef(template.mediaUrl);
  if (!url) return undefined;
  return {
    type: (template.mediaType as MediaType) || 'DOCUMENT',
    url,
    filename: template.mediaFilename ?? undefined,
    mimeType: template.mediaMimeType ?? undefined,
  };
}

function withColumnMedia(canonical: CanonicalTemplate, template: any): CanonicalTemplate {
  const fromColumns = mediaFromColumns(template);
  if (!canonical.media && fromColumns) return { ...canonical, media: fromColumns };

  // The payload knows the type; the columns may know the filename/mime it lacks.
  if (canonical.media && fromColumns) {
    return {
      ...canonical,
      media: {
        ...canonical.media,
        url: canonical.media.url ?? fromColumns.url,
        filename: canonical.media.filename ?? fromColumns.filename,
        mimeType: canonical.media.mimeType ?? fromColumns.mimeType,
      },
    };
  }
  return canonical;
}

export function resolveCanonical(template: any): CanonicalTemplate {
  if (isLegacyPayload(template.payload)) {
    return withColumnMedia(
      legacyBlocksToCanonical(
        template.payload.blocks,
        template.name,
        template.payload.category ?? template.category ?? undefined,
        template.language ?? undefined,
      ),
      template,
    );
  }
  if (isCanonicalPayload(template.payload)) {
    // fold any legacy header/footer/button fields into the body
    return withColumnMedia(foldLegacyCanonical(template.payload), template);
  }
  return withColumnMedia(
    {
      name: template.name,
      category: template.category ?? 'GENERAL',
      language: template.language ?? 'en_US',
      body: { text: template.content ?? '' },
      _meta: { variableNames: Array.isArray(template.variables) ? template.variables : [] },
    },
    template,
  );
}

export function renderTemplate(
  template: any,
  vars: Record<string, string> = {},
): { text: string; renderable: RenderableTemplate; variables: string[] } {
  const canonical = resolveCanonical(template);
  const renderable = toRenderable(canonical, vars);
  // The wire wants something a browser can load; storage wants a portable ref.
  if (renderable.media?.url) {
    renderable.media = { ...renderable.media, url: resolveMediaUrl(renderable.media.url) ?? undefined };
  }
  return {
    text: renderable.body,
    renderable,
    variables: extractVariableNames(canonical),
  };
}

function makeResolver(canonical: CanonicalTemplate, variables: Record<string, string>) {
  const varNames = canonical._meta?.variableNames ?? [];
  return (text: string): string => {
    let result = text;
    varNames.forEach((name, i) => {
      result = result.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), variables[name] ?? `[${name}]`);
    });
    return result.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? `[${k}]`);
  };
}

/**
 * Send a template via Baileys with full fidelity — the recipient gets exactly
 * what the builder previewed:
 *
 *   - Media template (image/video/document) → media message with the resolved
 *     text as caption.
 *   - Audio template                        → a WhatsApp voice message (no caption).
 *   - Text template                         → a single formatted text message.
 *
 * No buttons, no footer — those are not part of the template model.
 */
export async function sendTemplate(
  phone: string,
  template: any,
  variables: Record<string, string> = {},
  opts: { conversationId?: string; clientId?: string } = {},
): Promise<{ messageId: string }> {
  const canonical = resolveCanonical(template);
  const resolve = makeResolver(canonical, variables);
  const caption = resolve(canonical.body.text);

  // ── Meta-approved template ─────────────────────────────────────────────────
  // Sent as a real template message: it is the only thing WhatsApp delivers to
  // someone outside the 24-hour window. Slots are named by the template's
  // `variables` order ("1", "2" for templates imported from Meta).
  if (template.metaStatus === 'APPROVED' && template.metaTemplateId) {
    const slots: string[] = Array.isArray(template.variables) ? template.variables : [];
    const result = await providerManager.sendMessage({
      phone,
      template: {
        templateId: template.id,
        name: toMetaTemplateName(template.name),
        language: template.language,
        bodyValues: slots.map((slot) => variables[slot] ?? ''),
        headerMedia: template.mediaUrl
          ? {
              storageRef: template.mediaUrl,
              format: (template.mediaType as 'IMAGE' | 'VIDEO' | 'DOCUMENT') ?? 'IMAGE',
              filename: template.mediaFilename,
            }
          : null,
        renderedBody: (template.content ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, k: string) => variables[k] ?? ''),
        ...approvedExtras(template),
      },
      clientId: opts.clientId,
      conversationId: opts.conversationId,
    });
    logger.info('template.meta_sent', { templateName: template.name, phone });
    return { messageId: result.messageId };
  }

  // ── Media template ─────────────────────────────────────────────────────────
  const media = canonical.media;
  if (media?.url) {
    const loaded = await loadMedia(media.url, media.type, media.filename);
    if (loaded) {
      const isVoice = isAudioMediaType(media.type);
      const result = await providerManager.sendMessage({
        phone,
        media: {
          buffer: loaded.buffer,
          mimetype: media.mimeType || loaded.mimetype,
          filename: media.filename || undefined,
          // WhatsApp audio carries no caption; anything else does.
          caption: isVoice ? undefined : caption || undefined,
          isVoiceNote: isVoice,
          // Points the persisted CRM message at the stored file so it renders in chat.
          url: resolveMediaUrl(media.url) ?? undefined,
        },
        clientId: opts.clientId,
        conversationId: opts.conversationId,
      });

      logger.info('template.media_sent', { templateName: canonical.name, phone, type: media.type });
      return { messageId: result.messageId };
    }

    // The attachment is gone from storage. Falling back to text would quietly
    // turn an image template into a bare caption, so say so loudly instead of
    // pretending the send succeeded as intended.
    logger.warn('template.media_missing_falling_back_to_text', {
      templateName: canonical.name,
      url: media.url,
    });
    if (!caption.trim()) {
      throw new Error('This template\'s attachment is missing from storage and it has no text to fall back on.');
    }
  }

  // ── Text template ────────────────────────────────────────────────────────────
  if (!caption.trim()) throw new Error('Template produced no sendable content.');
  const result = await providerManager.sendMessage({
    phone,
    text: caption,
    clientId: opts.clientId,
    conversationId: opts.conversationId,
  });
  logger.info('template.text_sent', { templateName: canonical.name, phone });
  return { messageId: result.messageId };
}

export default { renderTemplate, sendTemplate };
