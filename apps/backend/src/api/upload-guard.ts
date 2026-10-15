import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { MAX_UPLOAD_BYTES, checkUploadSize, toMegabytes } from '@crm/messaging-schema';

/**
 * Single-file upload with the shared size limits.
 *
 * Multer stops reading at MAX_UPLOAD_BYTES, so an oversized file never fills the
 * server's memory (the free instance has 512 MB — one 300 MB video used to be
 * enough to take the whole CRM down). The per-type limit (photo 5 MB, video
 * 16 MB, …) is checked once the type is known. Both answer 413 with a sentence a
 * person can act on, and the browser checks the same limits before uploading.
 */
export function singleUpload(field: string, fileFilter?: multer.Options['fileFilter']) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter,
  }).single(field);

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `This file is larger than ${toMegabytes(MAX_UPLOAD_BYTES)} MB, the most the CRM accepts.`,
          code: 'FILE_TOO_LARGE',
        });
      }
      if (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const tooLarge = file ? checkUploadSize(file.mimetype, file.size) : null;
      if (tooLarge) {
        return res.status(413).json({
          error: `This ${tooLarge.kind} is ${toMegabytes(tooLarge.sizeBytes)} MB. WhatsApp allows up to ${toMegabytes(tooLarge.limitBytes)} MB.`,
          code: 'FILE_TOO_LARGE',
        });
      }
      next();
    });
  };
}
