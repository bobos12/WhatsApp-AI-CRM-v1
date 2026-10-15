import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger';

export interface UploadResult {
  url: string;
  /** Opaque key for deletion. For local mode this is just the filename. */
  key: string;
}

// ── Local (dev / no-S3 fallback) ─────────────────────────────────────────────

export const LOCAL_UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

function ensureLocalDir(): void {
  if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
    fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
  }
}

function uploadLocal(buffer: Buffer, filename: string): UploadResult {
  ensureLocalDir();
  fs.writeFileSync(path.join(LOCAL_UPLOADS_DIR, filename), buffer);
  return { url: `/uploads/${filename}`, key: filename };
}

function deleteLocal(key: string): void {
  const filePath = path.join(LOCAL_UPLOADS_DIR, key);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn('storage.local_delete_failed', { key, error: String(err) });
  }
}

// ── S3-compatible (AWS S3 / Cloudflare R2 / MinIO) ───────────────────────────

interface S3Config {
  client: S3Client;
  bucket: string;
  resolveUrl: (key: string) => string;
}

function buildS3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT;       // optional: R2/MinIO endpoint
  const publicUrl = process.env.S3_PUBLIC_URL;    // optional: CDN / custom domain

  const client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
    ...(endpoint
      ? { endpoint, forcePathStyle: true }
      : {}),
  });

  function resolveUrl(key: string): string {
    if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/${key}`;
    if (endpoint) return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  return { client, bucket, resolveUrl };
}

// Initialized once at module load. Null means local-storage mode.
const s3: S3Config | null = buildS3Config();

async function uploadS3(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<UploadResult> {
  if (!s3) throw new Error('S3 not configured');
  const key = `uploads/${filename}`;
  await s3.client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      // Names are random and never reused, so a browser may keep a file
      // forever. Without this every chat scroll re-downloaded each image,
      // which is what spends a free plan's monthly bandwidth.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return { url: s3.resolveUrl(key), key };
}

async function deleteS3(key: string): Promise<void> {
  if (!s3) return;
  try {
    await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  } catch (err) {
    logger.warn('storage.s3_delete_failed', { key, error: String(err) });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** 'local' when S3_BUCKET is unset (dev fallback). 's3' in production. */
export const storageMode: 'local' | 's3' = s3 ? 's3' : 'local';

export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<UploadResult> {
  if (s3) return uploadS3(buffer, filename, mimeType);
  return uploadLocal(buffer, filename);
}

export async function deleteFile(key: string): Promise<void> {
  if (s3) return deleteS3(key);
  deleteLocal(key);
}
