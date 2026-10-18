import { GRAPH_BASE, MetaApiError, asMetaError, graphRequest } from './graph';
import type { CloudApiConfig } from '../channel.service';
import { prisma } from '../../lib/prisma';
import { loadMedia } from '../../lib/media';
import { uploadFile } from '../../lib/storage';
import { logger } from '../../lib/logger';
import { HttpError } from '../../auth/authorize';
import {
  normalizeButtons,
  buttonProblems,
  type CanonicalTemplate,
  type MetaExtras,
  type TemplateButtonDef,
} from '../../lib/template-compiler';
import { emitDataChanged } from '../../realtime/socket';

/**
 * WhatsApp message templates on the Cloud API.
 *
 * Templates are the only way to message a customer outside the 24h window, which
 * makes this module load-bearing for broadcasts rather than a convenience.
 *
 * Two impedance mismatches are handled here:
 *
 *  1. **Named vs positional variables.** This CRM's templates use readable named
 *     placeholders (`{{name}}`); Meta only accepts positional ones (`{{1}}`).
 *     The mapping is computed once at submission and stored on the row, so the
 *     order can never drift from what Meta approved — if it did, every send
 *     would put the wrong value in the wrong slot, silently.
 *
 *  2. **Media headers need an upload handle**, not a media id. Meta's template
 *     review needs a sample of the header image, obtained from the Resumable
 *     Upload API, which is a different endpoint with different auth to the
 *     ordinary media upload used when sending.
 */

// ── Naming and category ──────────────────────────────────────────────────────

/**
 * Meta accepts only lowercase letters, digits and underscores in a template
 * name. This is applied on submission rather than on save so the tenant keeps
 * seeing the name they typed in the CRM.
 */
export function toMetaTemplateName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 512);
  return slug || 'template';
}

export type MetaCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

/**
 * Map this CRM's business-flavoured categories onto Meta's three billing
 * categories. Getting this wrong is not cosmetic: Meta prices MARKETING and
 * UTILITY conversations differently and rejects a template whose content does
 * not match its declared category.
 */
export function toMetaCategory(raw?: string | null): MetaCategory {
  const c = (raw ?? '').toUpperCase();
  if (c === 'MARKETING' || c === 'UTILITY' || c === 'AUTHENTICATION') return c;

  switch (c) {
    case 'ONBOARDING':
    case 'SUPPORT':
    case 'APPOINTMENTS':
      return 'UTILITY';
    case 'SALES':
    case 'ECOMMERCE':
    case 'FOLLOW_UP':
    case 'GENERAL':
    default:
      // Defaulting to MARKETING is the safe direction: Meta will down-categorise
      // a marketing-declared template that is really utility, but sending
      // promotional content under a UTILITY template is a policy violation.
      return 'MARKETING';
  }
}

// ── Variable mapping ─────────────────────────────────────────────────────────

export interface PositionalMapping {
  /** Body text with `{{name}}` rewritten to `{{1}}`, `{{2}}`, … */
  text: string;
  /** Ordered variable names — index 0 is `{{1}}`. */
  order: string[];
}

/**
 * Rewrite named placeholders to Meta's positional form, preserving first-seen
 * order. `preferredOrder` (a previously approved mapping) wins so re-submitting
 * an edited template cannot silently renumber existing variables.
 */
export function toPositional(bodyText: string, preferredOrder?: string[]): PositionalMapping {
  const seen: string[] = [];
  for (const match of bodyText.matchAll(/\{\{(\w+)\}\}/g)) {
    const name = match[1];
    // A body already written positionally passes through untouched.
    if (/^\d+$/.test(name)) continue;
    if (!seen.includes(name)) seen.push(name);
  }

  const order = preferredOrder?.length
    ? [...preferredOrder.filter((n) => seen.includes(n)), ...seen.filter((n) => !preferredOrder.includes(n))]
    : seen;

  const text = bodyText.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    if (/^\d+$/.test(name)) return whole;
    const index = order.indexOf(name);
    return index === -1 ? whole : `{{${index + 1}}}`;
  });

  return { text, order };
}

/**
 * Meta rejects variable values containing newlines, tabs, or 4+ consecutive
 * spaces (error 132007), and a broadcast that trips it fails per-recipient at
 * send time — long after the tenant could have done anything about it. Clean the
 * value instead of letting Meta refuse it.
 */
export function sanitizeVariableValue(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
}

// ── Media header handles (Resumable Upload API) ───────────────────────────────

/**
 * Obtain the `header_handle` Meta requires as the sample for a media header.
 *
 * This is NOT the media upload used when sending a message — it is the
 * Resumable Upload API, namespaced by App ID, and its second leg authenticates
 * with `Authorization: OAuth <token>` rather than `Bearer`. Both differences are
 * undocumented enough to be worth stating.
 */
async function createHeaderHandle(params: {
  buffer: Buffer;
  mimetype: string;
  filename: string;
  appId: string;
  accessToken: string;
}): Promise<string> {
  const { buffer, mimetype, filename, appId, accessToken } = params;

  const startUrl =
    `${GRAPH_BASE}/${appId}/uploads` +
    `?file_length=${buffer.length}` +
    `&file_type=${encodeURIComponent(mimetype)}` +
    `&file_name=${encodeURIComponent(filename)}`;

  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const startText = await startRes.text();
  if (!startRes.ok) {
    let parsed: any = null;
    try { parsed = JSON.parse(startText); } catch { /* non-JSON */ }
    throw new MetaApiError({
      code: Number(parsed?.error?.code ?? -1),
      message: parsed?.error?.message || `Could not start the header upload (${startRes.status})`,
      httpStatus: startRes.status,
    });
  }

  const sessionId = JSON.parse(startText)?.id as string | undefined;
  if (!sessionId) {
    throw new MetaApiError({ code: -1, message: 'Upload session id missing from Meta response', httpStatus: 502 });
  }

  const uploadRes = await fetch(`${GRAPH_BASE}/${sessionId}`, {
    method: 'POST',
    headers: {
      // Deliberately `OAuth`, not `Bearer` — this endpoint rejects Bearer.
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(buffer),
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) {
    let parsed: any = null;
    try { parsed = JSON.parse(uploadText); } catch { /* non-JSON */ }
    throw new MetaApiError({
      code: Number(parsed?.error?.code ?? -1),
      message: parsed?.error?.message || `Header upload failed (${uploadRes.status})`,
      httpStatus: uploadRes.status,
    });
  }

  const handle = JSON.parse(uploadText)?.h as string | undefined;
  if (!handle) {
    throw new MetaApiError({ code: -1, message: 'Upload handle missing from Meta response', httpStatus: 502 });
  }
  return handle;
}

// ── Component building ───────────────────────────────────────────────────────

type HeaderFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

function headerFormatFor(mediaType?: string | null): HeaderFormat | null {
  switch ((mediaType ?? '').toUpperCase()) {
    case 'IMAGE': return 'IMAGE';
    case 'VIDEO': return 'VIDEO';
    case 'DOCUMENT': return 'DOCUMENT';
    // Meta has no audio header format. An audio template is submitted body-only
    // and the clip is dropped rather than failing the whole submission.
    default: return null;
  }
}

export interface BuiltTemplate {
  name: string;
  language: string;
  category: MetaCategory;
  components: any[];
  /** Variable order that `components` was built against — persist alongside. */
  variableOrder: string[];
  /** Footer + buttons as submitted — the snapshot sends and the chat render from. */
  extras: MetaExtras;
}

/** Meta's BUTTONS component entry for one of our buttons. */
function toMetaButton(b: TemplateButtonDef): any {
  switch (b.type) {
    case 'QUICK_REPLY': return { type: 'QUICK_REPLY', text: b.text };
    case 'URL': return { type: 'URL', text: b.text, url: b.url, ...(b.url.includes('{{') && b.example ? { example: [b.example] } : {}) };
    case 'PHONE_NUMBER': return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number.replace(/[\s()-]/g, '') };
    case 'COPY_CODE': return { type: 'COPY_CODE', example: b.example };
  }
}

/** Read footer + buttons out of the components Meta returns for a template. */
export function extrasFromComponents(components?: Array<{ type: string; text?: string; buttons?: any[] }>): MetaExtras {
  const footer = components?.find((c) => c.type?.toUpperCase() === 'FOOTER')?.text?.trim();
  const buttons = normalizeButtons(components?.find((c) => c.type?.toUpperCase() === 'BUTTONS')?.buttons);
  return { ...(footer ? { footer } : {}), ...(buttons.length ? { buttons } : {}) };
}

/**
 * Footer + buttons as Meta approved them for a stored template row. The snapshot
 * taken at submission/sync wins over the editable payload: a template edited
 * after approval must keep rendering — and sending — what Meta actually holds.
 */
export function approvedExtras(row: { payload?: any }): MetaExtras {
  const snap = row.payload?._meta?.meta;
  if (snap && typeof snap === 'object') {
    const buttons = normalizeButtons(snap.buttons);
    return { ...(snap.footer ? { footer: String(snap.footer) } : {}), ...(buttons.length ? { buttons } : {}) };
  }
  const buttons = normalizeButtons(row.payload?.buttons);
  const footer = typeof row.payload?.footer?.text === 'string' ? row.payload.footer.text.trim() : '';
  return { ...(footer ? { footer } : {}), ...(buttons.length ? { buttons } : {}) };
}

/**
 * Compile a stored template into the payload Meta's review API expects.
 * `sampleValues` fills `example`, which Meta requires whenever a body has
 * variables and rejects the submission without.
 */
export async function buildTemplateForSubmission(params: {
  canonical: CanonicalTemplate;
  displayName: string;
  language: string;
  category?: string | null;
  previousOrder?: string[];
  cloud: CloudApiConfig;
}): Promise<BuiltTemplate> {
  const { canonical, displayName, language, category, previousOrder, cloud } = params;

  const bodyText = canonical.body?.text?.trim();
  if (!bodyText) throw new HttpError(400, 'A template needs body text before it can be submitted to WhatsApp.');

  const { text, order } = toPositional(bodyText, previousOrder);
  const components: any[] = [];

  // ── Header (media only; text headers are folded into the body by the compiler)
  const format = headerFormatFor(canonical.media?.type);
  if (canonical.media?.url && format) {
    if (!cloud.appId) {
      throw new HttpError(
        400,
        'Templates with an image, video or document header need your Meta App ID. Add it in Settings → WhatsApp, or remove the attachment.',
        'META_APP_ID_REQUIRED',
      );
    }
    const loaded = await loadMedia(canonical.media.url, canonical.media.type, canonical.media.filename);
    if (!loaded) {
      throw new HttpError(400, 'The template attachment could not be read. Re-upload it and try again.');
    }
    const handle = await createHeaderHandle({
      buffer: loaded.buffer,
      mimetype: loaded.mimetype,
      filename: canonical.media.filename || 'header',
      appId: cloud.appId,
      accessToken: cloud.accessToken,
    });
    components.push({ type: 'HEADER', format, example: { header_handle: [handle] } });
  }

  // ── Body
  const bodyComponent: any = { type: 'BODY', text };
  if (order.length > 0) {
    const samples = order.map((name) => {
      const preview = canonical._meta?.previewValues?.[name];
      return sanitizeVariableValue(preview || name.replace(/_/g, ' '));
    });
    bodyComponent.example = { body_text: [samples] };
  }
  components.push(bodyComponent);

  // ── Footer + buttons — validated here so Meta's terse rejection never reaches the tenant
  const footer = canonical.footer?.text?.trim() || undefined;
  const buttons = normalizeButtons(canonical.buttons);
  const problems = buttonProblems(buttons, footer);
  if (problems.length) throw new HttpError(400, problems[0], 'TEMPLATE_BUTTONS_INVALID');
  if (footer) components.push({ type: 'FOOTER', text: footer });
  if (buttons.length) components.push({ type: 'BUTTONS', buttons: buttons.map(toMetaButton) });

  return {
    name: toMetaTemplateName(displayName),
    language,
    category: toMetaCategory(category),
    components,
    variableOrder: order,
    extras: { ...(footer ? { footer } : {}), ...(buttons.length ? { buttons } : {}) },
  };
}

// ── Submission and sync ──────────────────────────────────────────────────────

/**
 * Submit a stored template to Meta for review.
 *
 * Meta identifies a template by (name, language) within the WABA, so a
 * re-submission of an already-known template is an update of the existing object
 * rather than a create — otherwise the second attempt fails as a duplicate and
 * the tenant is stuck.
 */
export async function submitTemplate(templateId: string, cloud: CloudApiConfig): Promise<{
  metaTemplateId: string;
  metaStatus: string;
  category: MetaCategory;
}> {
  if (!cloud.wabaId) {
    throw new HttpError(
      400,
      'Add your WhatsApp Business Account ID (WABA ID) in Settings before submitting templates.',
      'WABA_ID_REQUIRED',
    );
  }

  const row = await prisma.messageTemplate.findUnique({ where: { id: templateId } });
  if (!row) throw new HttpError(404, 'Template not found');

  // Imported lazily: template.service imports the sender, which imports the
  // provider registry, which imports this module. A static import closes that
  // cycle at require time.
  const { resolveCanonical } = await import('../../services/template.service');
  const canonical = resolveCanonical(row);

  const built = await buildTemplateForSubmission({
    canonical,
    displayName: row.name,
    language: row.language,
    category: row.category,
    previousOrder: Array.isArray(row.variables) ? (row.variables as string[]) : undefined,
    cloud,
  });

  try {
    let metaTemplateId: string;

    if (row.metaTemplateId) {
      // Editing an approved/rejected template in place. Meta does not accept
      // `name` or `language` on an edit — they are the identity of the object.
      await graphRequest({
        path: `/${row.metaTemplateId}`,
        accessToken: cloud.accessToken,
        method: 'POST',
        body: { category: built.category, components: built.components },
      });
      metaTemplateId = row.metaTemplateId;
    } else {
      const created = await graphRequest<{ id: string; status?: string; category?: string }>({
        path: `/${cloud.wabaId}/message_templates`,
        accessToken: cloud.accessToken,
        method: 'POST',
        body: {
          name: built.name,
          language: built.language,
          category: built.category,
          components: built.components,
          // Let Meta re-file a miscategorised template instead of rejecting it.
          allow_category_change: true,
        },
      });
      metaTemplateId = created.id;
    }

    await prisma.messageTemplate.update({
      where: { id: templateId },
      data: {
        metaTemplateId,
        metaStatus: 'PENDING',
        metaRejectedReason: null,
        metaSubmittedAt: new Date(),
        metaSyncedAt: new Date(),
        category: built.category,
        variables: built.variableOrder,
        payload: clearEditFlags(withMetaSnapshot(row.payload, built.extras)),
      },
    });

    logger.info('meta.template_submitted', { templateId, metaTemplateId, name: built.name });
    return { metaTemplateId, metaStatus: 'PENDING', category: built.category };
  } catch (err) {
    const meta = asMetaError(err);
    // Meta refused an EDIT of a live template: the approved version is untouched
    // and still sends. Marking the row REJECTED would hide that, so keep the
    // status and record why the edit failed.
    const liveEdit = row.metaTemplateId && ['APPROVED', 'PAUSED'].includes((row.metaStatus ?? '').toUpperCase());
    if (liveEdit) {
      const base = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as any) : {};
      await prisma.messageTemplate.update({
        where: { id: templateId },
        data: {
          payload: { ...base, _meta: { ...(base._meta ?? {}), pendingEdits: true, editError: meta.userMessage } },
          metaSyncedAt: new Date(),
        },
      });
      throw new HttpError(meta.httpStatus >= 500 ? 502 : 400, meta.userMessage, `META_${meta.kind}`);
    }
    await prisma.messageTemplate.update({
      where: { id: templateId },
      data: { metaStatus: 'REJECTED', metaRejectedReason: meta.userMessage, metaSyncedAt: new Date() },
    });
    throw new HttpError(meta.httpStatus >= 500 ? 502 : 400, meta.userMessage, `META_${meta.kind}`);
  }
}

/** A successful submission means Meta now holds the edited version. */
function clearEditFlags(payload: any): any {
  if (!payload?._meta) return payload;
  const { pendingEdits: _p, editError: _e, ...meta } = payload._meta;
  return { ...payload, _meta: meta };
}

/** Store the approved footer/buttons inside the payload's `_meta` without touching the rest. */
function withMetaSnapshot(payload: any, extras: MetaExtras): any {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return { ...base, _meta: { ...(base._meta ?? {}), meta: extras } };
}

interface MetaTemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejected_reason?: string;
  quality_score?: { score?: string };
  components?: Array<{
    type: string;
    format?: string;
    text?: string;
    example?: { header_handle?: string[] };
    buttons?: any[];
  }>;
}

const HEADER_MEDIA_EXT: Record<string, { ext: string; mime: string }> = {
  IMAGE: { ext: 'jpg', mime: 'image/jpeg' },
  VIDEO: { ext: 'mp4', mime: 'video/mp4' },
  DOCUMENT: { ext: 'pdf', mime: 'application/pdf' },
};

/**
 * Create a local row for a template that exists only in Meta (made in WhatsApp
 * Manager, or on a WABA connected after the templates were written). Without it
 * a tenant's existing approved templates are unusable from the CRM.
 *
 * A media header must be sent with an attachment, so the sample Meta stored at
 * review time is copied into our storage as the default header.
 */
async function importRemoteTemplate(r: MetaTemplateRow): Promise<void> {
  const body = r.components?.find((c) => c.type === 'BODY')?.text ?? '';
  const header = r.components?.find((c) => c.type === 'HEADER');
  const slots = [...new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

  let media: { mediaUrl: string; mediaType: string; mediaMimeType: string; mediaFilename: string } | null = null;
  const headerFormat = header?.format?.toUpperCase();
  const sampleUrl = header?.example?.header_handle?.[0];
  if (headerFormat && HEADER_MEDIA_EXT[headerFormat] && sampleUrl) {
    try {
      const res = await fetch(sampleUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = res.headers.get('content-type')?.split(';')[0] || HEADER_MEDIA_EXT[headerFormat].mime;
      const filename = `meta-template-${r.id}.${HEADER_MEDIA_EXT[headerFormat].ext}`;
      const uploaded = await uploadFile(Buffer.from(await res.arrayBuffer()), filename, mime);
      media = { mediaUrl: uploaded.url, mediaType: headerFormat, mediaMimeType: mime, mediaFilename: filename };
    } catch (err) {
      logger.warn('meta.template_import_header_failed', { metaTemplateId: r.id, error: String(err) });
    }
  }

  const status = r.status?.toUpperCase() ?? null;
  const extras = extrasFromComponents(r.components);
  await prisma.messageTemplate.create({
    data: {
      name: r.name,
      language: r.language,
      content: body,
      // Footer and buttons live in the payload so the builder, previews and
      // chat show the template as Meta holds it.
      payload: {
        name: r.name,
        category: r.category?.toUpperCase() ?? 'GENERAL',
        language: r.language,
        body: { text: body },
        ...(extras.footer ? { footer: { text: extras.footer } } : {}),
        ...(extras.buttons ? { buttons: extras.buttons } : {}),
        _meta: { variableNames: slots, meta: extras },
      } as any,
      category: r.category?.toUpperCase() ?? null,
      type: media ? 'MEDIA' : 'TEXT',
      status: 'PUBLISHED',
      variables: slots,
      metaTemplateId: r.id,
      metaStatus: status,
      metaRejectedReason: status === 'REJECTED' ? r.rejected_reason ?? 'Rejected by WhatsApp' : null,
      metaQualityScore: r.quality_score?.score?.toUpperCase() ?? null,
      metaSyncedAt: new Date(),
      ...(media ?? {}),
    },
  });
}

/**
 * Pull every template Meta knows about for this WABA and reconcile local rows.
 *
 * The status webhook is the primary signal; this exists because webhooks get
 * missed (delivery failures, downtime, a tenant who configured the callback
 * late) and a template stuck at PENDING forever is indistinguishable from one
 * whose approval notification was simply lost.
 */
export async function syncTemplates(
  cloud: CloudApiConfig,
): Promise<{ matched: number; updated: number; imported: number; detached: number; synced: number }> {
  if (!cloud.wabaId) return { matched: 0, updated: 0, imported: 0, detached: 0, synced: 0 };

  const remote: MetaTemplateRow[] = [];
  let after: string | undefined;
  do {
    const res = await graphRequest<{ data: MetaTemplateRow[]; paging?: { cursors?: { after?: string }; next?: string } }>({
      path:
        `/${cloud.wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=100` +
        (after ? `&after=${encodeURIComponent(after)}` : ''),
      accessToken: cloud.accessToken,
    });
    remote.push(...(res?.data ?? []));
    after = res?.paging?.next ? res.paging.cursors?.after : undefined;
  } while (after);

  let matched = 0;
  let updated = 0;
  let imported = 0;
  let detached = 0;

  const locals = await prisma.messageTemplate.findMany({
    select: { id: true, name: true, language: true, metaTemplateId: true, metaStatus: true, payload: true },
  });

  // A Meta id this WABA does not know belongs to another account (typically the
  // test number used during setup). Sending it fails with a permission error,
  // so it must stop showing as approved.
  const remoteIds = new Set(remote.map((r) => r.id));
  for (const l of locals) {
    if (!l.metaTemplateId || remoteIds.has(l.metaTemplateId)) continue;
    if (remote.some((r) => toMetaTemplateName(l.name) === r.name && l.language === r.language)) continue;
    await prisma.messageTemplate.update({
      where: { id: l.id },
      data: { metaTemplateId: null, metaStatus: null, metaRejectedReason: null, metaSyncedAt: new Date() },
    });
    detached++;
  }

  for (const r of remote) {
    // Match on the Meta id when we have it, otherwise on the (name, language)
    // identity Meta itself uses — that second path adopts templates created
    // directly in Meta Business Manager.
    const local =
      locals.find((l) => l.metaTemplateId === r.id) ??
      locals.find((l) => toMetaTemplateName(l.name) === r.name && l.language === r.language);

    if (!local) {
      if (r.status?.toUpperCase() === 'DELETED') continue;
      try {
        await importRemoteTemplate(r);
        imported++;
      } catch (err) {
        logger.warn('meta.template_import_failed', { metaTemplateId: r.id, name: r.name, error: String(err) });
      }
      continue;
    }
    matched++;

    const nextStatus = r.status?.toUpperCase() ?? null;
    const nextQuality = r.quality_score?.score?.toUpperCase() ?? null;

    // Meta's components are the truth for what a send carries; keep the snapshot current.
    const extras = extrasFromComponents(r.components);
    const snapshotStale = JSON.stringify((local.payload as any)?._meta?.meta ?? null) !== JSON.stringify(extras);

    if (local.metaStatus === nextStatus && local.metaTemplateId === r.id && !snapshotStale) continue;

    await prisma.messageTemplate.update({
      where: { id: local.id },
      data: {
        ...(snapshotStale ? { payload: withMetaSnapshot(local.payload, extras) } : {}),
        metaTemplateId: r.id,
        metaStatus: nextStatus,
        metaRejectedReason: nextStatus === 'REJECTED' ? r.rejected_reason ?? 'Rejected by WhatsApp' : null,
        metaQualityScore: nextQuality,
        metaSyncedAt: new Date(),
        ...(r.category ? { category: r.category.toUpperCase() } : {}),
      },
    });
    updated++;
  }

  if (updated || imported || detached) emitDataChanged('templates');
  return { matched, updated, imported, detached, synced: updated + imported };
}

/** Apply a `message_template_status_update` webhook to the local row. */
export async function applyTemplateStatusUpdate(value: {
  message_template_id?: string | number;
  message_template_name?: string;
  message_template_language?: string;
  event?: string;
  reason?: string;
}): Promise<void> {
  const metaId = value.message_template_id != null ? String(value.message_template_id) : null;

  const local =
    (metaId ? await prisma.messageTemplate.findFirst({ where: { metaTemplateId: metaId } }) : null) ??
    (value.message_template_name
      ? (await prisma.messageTemplate.findMany({ select: { id: true, name: true, language: true } })).find(
          (l) =>
            toMetaTemplateName(l.name) === value.message_template_name &&
            (!value.message_template_language || l.language === value.message_template_language),
        ) ?? null
      : null);

  if (!local) {
    logger.warn('meta.template_status_unmatched', {
      metaId,
      name: value.message_template_name,
      event: value.event,
    });
    return;
  }

  const event = (value.event ?? '').toUpperCase();
  await prisma.messageTemplate.update({
    where: { id: local.id },
    data: {
      ...(metaId ? { metaTemplateId: metaId } : {}),
      metaStatus: event || null,
      metaRejectedReason: event === 'REJECTED' ? value.reason ?? 'Rejected by WhatsApp' : null,
      metaSyncedAt: new Date(),
    },
  });

  logger.info('meta.template_status_applied', { templateId: local.id, event });
  emitDataChanged('templates', local.id);
}

/** Delete a template at Meta. Local rows are kept — history should survive. */
export async function deleteRemoteTemplate(name: string, cloud: CloudApiConfig): Promise<void> {
  if (!cloud.wabaId) return;
  try {
    await graphRequest({
      path: `/${cloud.wabaId}/message_templates?name=${encodeURIComponent(toMetaTemplateName(name))}`,
      accessToken: cloud.accessToken,
      method: 'DELETE',
    });
  } catch (err) {
    logger.warn('meta.template_delete_failed', { name, error: asMetaError(err).message });
  }
}

// ── Send-time payload ────────────────────────────────────────────────────────

export interface TemplateSendSpec {
  name: string;
  language: string;
  /** Positional values, index 0 → `{{1}}`. */
  bodyValues: string[];
  /** Storage ref for a media header, if the approved template has one. */
  headerMedia?: { mediaId?: string; link?: string; format: HeaderFormat; filename?: string } | null;
  /** The approved buttons — only dynamic URLs and copy-code need a send-time parameter. */
  buttons?: TemplateButtonDef[];
}

/**
 * Send-time parameters for the buttons that require one. Static quick replies,
 * links and call buttons need nothing; a URL ending in `{{1}}` needs its suffix
 * and a copy-code button needs its code, or Meta refuses the whole message.
 */
/** For a URL ending in `{{1}}`, the suffix Meta's approved example implies. */
export function urlSuffix(b: { url: string; example?: string }): string {
  const prefix = b.url.split('{{')[0];
  return b.example?.startsWith(prefix) ? b.example.slice(prefix.length) : b.example ?? '';
}

/** The link a customer actually opens — dynamic suffix filled in. */
export function resolvedButtonUrl(b: { url: string; example?: string }): string {
  return b.url.includes('{{') ? b.url.split('{{')[0] + urlSuffix(b) : b.url;
}

function buttonComponents(buttons: TemplateButtonDef[] = []): any[] {
  const out: any[] = [];
  buttons.forEach((b, index) => {
    if (b.type === 'URL' && b.url.includes('{{')) {
      out.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: urlSuffix(b) || '-' }] });
    } else if (b.type === 'COPY_CODE') {
      out.push({ type: 'button', sub_type: 'copy_code', index: String(index), parameters: [{ type: 'coupon_code', coupon_code: b.example }] });
    }
  });
  return out;
}

/** Build the `template` object for POST /{phone_number_id}/messages. */
export function buildTemplatePayload(spec: TemplateSendSpec): any {
  const components: any[] = [];

  if (spec.headerMedia) {
    const key = spec.headerMedia.format.toLowerCase(); // image | video | document
    const ref = spec.headerMedia.mediaId
      ? { id: spec.headerMedia.mediaId }
      : { link: spec.headerMedia.link };
    components.push({
      type: 'header',
      parameters: [
        {
          type: key,
          [key]: {
            ...ref,
            ...(key === 'document' && spec.headerMedia.filename
              ? { filename: spec.headerMedia.filename }
              : {}),
          },
        },
      ],
    });
  }

  if (spec.bodyValues.length > 0) {
    components.push({
      type: 'body',
      parameters: spec.bodyValues.map((v) => ({ type: 'text', text: sanitizeVariableValue(v) })),
    });
  }

  components.push(...buttonComponents(spec.buttons));

  return {
    name: spec.name,
    language: { code: spec.language },
    ...(components.length > 0 ? { components } : {}),
  };
}
