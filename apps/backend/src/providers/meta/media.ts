import crypto from 'node:crypto';
import path from 'node:path';
import { GRAPH_BASE, MetaApiError, asMetaError, graphRequest } from './graph';
import { uploadFile } from '../../lib/storage';
import { logger } from '../../lib/logger';

/**
 * Media transfer for the Cloud API.
 *
 * Meta does not accept or serve media inline. Outbound bytes must be uploaded to
 * get an opaque id; inbound media arrives as an id that has to be resolved to a
 * short-lived signed URL and then fetched with the tenant's bearer token.
 *
 * That second half is what the previous implementation skipped: it recorded
 * `meta-media://<id>` in mediaUrl and nothing ever resolved it, so every inbound
 * image, voice note and document was a dead reference. Meta deletes the bytes
 * after 30 days, so a missed download is permanent data loss — the copy is taken
 * eagerly, on receipt, into the same storage layer the rest of the app uses.
 */

/** Extension to give a stored file when Meta only tells us the MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gp': '.3gp',
  'video/3gpp': '.3gp',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
};

function extensionFor(mime: string, fallbackName?: string | null): string {
  const clean = mime.split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[clean]) return EXT_BY_MIME[clean];
  if (fallbackName) {
    const ext = path.extname(fallbackName);
    if (ext && ext.length <= 8) return ext;
  }
  return '.bin';
}

// ── Outbound ─────────────────────────────────────────────────────────────────

/**
 * Upload bytes and return Meta's media id.
 *
 * Uploading is preferred over passing a public `link`: a link makes delivery
 * depend on Meta being able to reach our storage at that instant, which turns a
 * private bucket or a brief outage into an undeliverable message.
 */
export async function uploadMedia(params: {
  buffer: Buffer;
  mimetype: string;
  filename?: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<string> {
  const { buffer, mimetype, filename, phoneNumberId, accessToken } = params;

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimetype);
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: mimetype }),
    filename || `upload${extensionFor(mimetype)}`,
  );

  // Not routed through graphRequest: that helper sets a JSON content-type, and
  // multipart needs fetch to set its own boundary header.
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    throw new MetaApiError({
      code: Number(parsed?.error?.code ?? -1),
      message: parsed?.error?.error_user_msg || parsed?.error?.message || `Media upload failed (${res.status})`,
      httpStatus: res.status,
      traceId: parsed?.error?.fbtrace_id ?? null,
    });
  }

  const id = JSON.parse(text)?.id as string | undefined;
  if (!id) throw new MetaApiError({ code: -1, message: 'Media upload returned no id', httpStatus: 502 });
  return id;
}

// ── Inbound ──────────────────────────────────────────────────────────────────

export interface DownloadedMedia {
  /** Storage-relative ref (e.g. "/uploads/ab12.jpg"), ready for mediaUrl. */
  storageRef: string;
  mimetype: string;
  sizeBytes: number;
}

interface MetaMediaHandle {
  url: string;
  mime_type: string;
  file_size?: number;
  sha256?: string;
}

/**
 * Resolve a Meta media id and copy the bytes into our own storage.
 *
 * Two calls by design: Graph returns a signed lookaside URL valid for minutes,
 * which still requires the bearer token to fetch. Returns null rather than
 * throwing — a message whose photo failed to download is still a message worth
 * keeping, and losing the text because of a media blip would be worse.
 */
export async function downloadMedia(params: {
  mediaId: string;
  accessToken: string;
  filename?: string | null;
  /** Refuse anything larger, so a hostile or corrupt payload cannot exhaust memory. */
  maxBytes?: number;
}): Promise<DownloadedMedia | null> {
  const { mediaId, accessToken, filename } = params;
  const maxBytes = params.maxBytes ?? 100 * 1024 * 1024; // Meta's own document ceiling.

  try {
    const handle = await graphRequest<MetaMediaHandle>({
      path: `/${mediaId}`,
      accessToken,
    });

    if (!handle?.url) {
      logger.warn('meta.media_no_url', { mediaId });
      return null;
    }

    if (handle.file_size != null && handle.file_size > maxBytes) {
      logger.warn('meta.media_too_large', { mediaId, size: handle.file_size, maxBytes });
      return null;
    }

    // The lookaside host is not graph.facebook.com, so this is an absolute-URL
    // fetch that still carries the tenant's token.
    const res = await fetch(handle.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Meta rejects this fetch without a UA on some edges.
        'User-Agent': 'meta-crm/1.0',
      },
    });

    if (!res.ok) {
      logger.warn('meta.media_fetch_failed', { mediaId, status: res.status });
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      logger.warn('meta.media_too_large_after_fetch', { mediaId, size: buffer.length });
      return null;
    }

    const mimetype = handle.mime_type || res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    const storedName = `${crypto.randomUUID()}${extensionFor(mimetype, filename)}`;
    const { url } = await uploadFile(buffer, storedName, mimetype);

    return { storageRef: url, mimetype, sizeBytes: buffer.length };
  } catch (err) {
    const meta = asMetaError(err);
    logger.error('meta.media_download_failed', {
      mediaId,
      code: meta.code,
      kind: meta.kind,
      error: meta.message,
    });
    return null;
  }
}
