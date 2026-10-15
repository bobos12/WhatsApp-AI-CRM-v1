/**
 * Upload size limits, shared by the browser (checks before uploading) and the
 * server (refuses anything larger).
 *
 * They follow WhatsApp's own maximums — a larger file could never be delivered
 * anyway — except documents, which WhatsApp accepts up to 100 MB but which are
 * capped lower so a single upload can't exhaust the server's memory or the
 * storage plan.
 */

export type UploadKind = 'image' | 'video' | 'audio' | 'document';

const MB = 1024 * 1024;

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  document: 25 * MB,
};

/** The largest any single upload may be — the transport-level cap. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(UPLOAD_LIMITS));

export function uploadKindOf(mimeType: string | null | undefined): UploadKind {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export interface UploadTooLarge {
  kind: UploadKind;
  sizeBytes: number;
  limitBytes: number;
}

/** Null when the file is within its limit. */
export function checkUploadSize(mimeType: string | null | undefined, sizeBytes: number): UploadTooLarge | null {
  const kind = uploadKindOf(mimeType);
  const limitBytes = UPLOAD_LIMITS[kind];
  return sizeBytes > limitBytes ? { kind, sizeBytes, limitBytes } : null;
}

export function toMegabytes(bytes: number): string {
  const mb = bytes / MB;
  return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1).replace(/\.0$/, '');
}
