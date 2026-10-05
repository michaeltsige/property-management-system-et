/**
 * Password hashing, token generation and field-level encryption.
 *
 * - Passwords: argon2id via `@node-rs/argon2` (native, no node-gyp).
 * - Refresh tokens: random 256-bit values, stored as SHA-256 hashes so a database
 *   leak cannot be replayed.
 * - Tenant ID numbers: AES-256-GCM with the key from `FIELD_ENCRYPTION_KEY`.
 *   Only the last four digits are stored in clear for search/display.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

import { getConfig } from '../config.js';

/**
 * Argon2id parameters (OWASP 2024: 19 MiB, t=2, p=1).
 *
 * The algorithm is not passed explicitly because `Algorithm` is an ambient const
 * enum, which `isolatedModules` (used by the web app's compiler settings) forbids
 * us from referencing. `@node-rs/argon2` defaults to Argon2id, and the generated
 * hash prefix is asserted in `crypto.test.ts` so a change of default cannot slip by.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, plain);
  } catch {
    // A malformed hash must behave like a wrong password, never like a crash.
    return false;
  }
}

/** Opaque refresh token: 32 random bytes, base64url. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRequestId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Field encryption (tenant ID numbers)
// ---------------------------------------------------------------------------

function fieldKey(): Buffer {
  const secret = getConfig().FIELD_ENCRYPTION_KEY;
  // Derive a fixed 32-byte key from the configured secret so operators can use a
  // passphrase without breaking AES-256-GCM's key length requirement.
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Encrypt a sensitive field. Output format: `v1:<iv>:<tag>:<ciphertext>` (base64url). */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fieldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    ':',
  );
}

export function decryptField(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(':');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('Unsupported encrypted field format');
  }
  const decipher = createDecipheriv('aes-256-gcm', fieldKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

/** Only the last four characters are shown back to users. */
export function lastFour(value: string): string {
  return value.replace(/\s+/g, '').slice(-4);
}

/** Mask everything but the last four digits for display: `****6789`. */
export function maskIdNumber(value: string): string {
  const clean = value.replace(/\s+/g, '');
  const tail = clean.slice(-4);
  return `${'*'.repeat(Math.max(0, clean.length - 4))}${tail}`;
}
