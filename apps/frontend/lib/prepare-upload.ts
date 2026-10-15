import { checkUploadSize, toMegabytes } from '@crm/messaging-schema';
import i18n from './i18n';

/**
 * Get a file ready to upload: shrink photos, then enforce the shared limits.
 *
 * Phone photos are 4–8 MB at full resolution, but WhatsApp delivers them at about
 * 1600 px anyway — storing the original only spent storage and, every time
 * someone scrolled past it, the free plan's bandwidth. Shrinking here typically
 * turns 4 MB into ~300 KB with no visible difference in the chat.
 *
 * Throws an Error whose message is ready to show, so callers can display it as
 * they would any other upload failure.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const SHRINK_ABOVE_BYTES = 600 * 1024;

export async function prepareUpload(file: File): Promise<File> {
  const ready = await shrinkPhoto(file);
  const tooLarge = checkUploadSize(ready.type, ready.size);
  if (tooLarge) {
    throw new Error(
      i18n.t('errors:plain.fileTooLarge', {
        kind: i18n.t(`errors:plain.fileKinds.${tooLarge.kind}`),
        size: toMegabytes(tooLarge.sizeBytes),
        limit: toMegabytes(tooLarge.limitBytes),
      }),
    );
  }
  return ready;
}

async function shrinkPhoto(file: File): Promise<File> {
  // GIFs would lose their animation; small photos aren't worth re-encoding.
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // unreadable here — let the server decide
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SHRINK_ABOVE_BYTES) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // JPEG has no transparency; paint white behind PNG cut-outs instead of black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
