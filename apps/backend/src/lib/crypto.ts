import crypto from 'node:crypto';

/**
 * Authenticated encryption for credentials held at rest.
 *
 * A Meta System User token is not a password — it is a long-lived bearer
 * credential that can send messages as the customer's business, read their
 * conversations, and mutate their templates. A database dump that leaks one is a
 * full account compromise for that tenant, so these never touch a column in
 * plaintext.
 *
 * AES-256-GCM, so the ciphertext is tamper-evident: a modified row fails to
 * decrypt rather than silently yielding different bytes.
 *
 * Ciphertext format — `v1:<iv>:<authTag>:<ciphertext>`, each part base64. The
 * version prefix exists so the algorithm can be changed later without having to
 * guess how any given stored value was produced.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits — the size GCM is specified for.
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/**
 * The encryption key, from `CREDENTIAL_ENCRYPTION_KEY` (base64 or hex, 32 bytes).
 *
 * Deliberately NOT derived from JWT_SECRET. Sharing one secret across signing
 * and encryption means rotating the JWT secret — a routine, encouraged operation
 * — would silently render every stored Meta token undecryptable, and the failure
 * would only surface later as tenants mysteriously unable to send.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set, so WhatsApp Cloud API credentials cannot be stored securely. ' +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  // Accept either encoding — hex is what `openssl rand -hex 32` prints, base64 is
  // what the Node one-liner above prints, and operators reach for both.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        'Use a base64 or hex encoding of 32 random bytes.',
    );
  }

  cachedKey = key;
  return key;
}

/** True when a usable encryption key is configured. Never throws. */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the key at boot when one is present, so a malformed value fails on
 * startup rather than at the moment a tenant tries to save their credentials.
 * Absent is fine — only Cloud API tenants need it.
 */
export function assertCredentialKeyValidIfPresent(): void {
  if (process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()) getKey();
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored credential is malformed or was written by an incompatible version.');
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Decrypt without throwing, for read paths that must degrade rather than fail.
 * A key rotated without re-encrypting leaves undecryptable rows; a tenant seeing
 * "reconnect your number" is a better outcome than a 500 on every send.
 */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

/**
 * A non-reversible hint for the UI, e.g. `EAAG…7bQZD`. Lets a tenant confirm
 * which token is saved without the API ever returning the credential itself.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 10) return '•'.repeat(plaintext.length);
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}
