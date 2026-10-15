import { Router } from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../../auth/auth.middleware';
import { uploadFile } from '../../lib/storage';
import { singleUpload } from '../upload-guard';

const router = Router();

// Allowlist of accepted upload types. The stored file extension is derived from
// the (validated) MIME type rather than the user-supplied filename, so a
// malicious name like `x.html` can never be written or served back as HTML.
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

// Browsers tag recorded audio as e.g. "audio/webm;codecs=opus" — the codec
// parameter must be stripped before matching the allowlist and picking an ext.
function baseMimeOf(mimetype: string): string {
  return mimetype.split(';')[0].trim().toLowerCase();
}

const uploadFileField = singleUpload('file', (_req, file, cb) => {
  if (ALLOWED_TYPES[baseMimeOf(file.mimetype)]) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
});

router.use(authMiddleware);

router.post('/', uploadFileField, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const baseMime = baseMimeOf(req.file.mimetype);
      const ext = ALLOWED_TYPES[baseMime];
      const filename = `${crypto.randomUUID()}${ext}`;
      const result = await uploadFile(req.file.buffer, filename, baseMime);
      res.json({
        url: result.url,
        key: result.key,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Upload failed' });
    }
});

export default router;
