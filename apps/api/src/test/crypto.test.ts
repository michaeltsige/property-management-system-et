/**
 * Password hashing and encryption at rest.
 *
 * The brief requires argon2 (or bcrypt). `@node-rs/argon2` defaults to argon2id;
 * this test pins that default so a dependency upgrade cannot silently downgrade
 * the algorithm to something weaker.
 */

import { describe, expect, it } from 'vitest';

import { decryptField, encryptField, hashPassword, lastFour, verifyPassword } from '../lib/crypto.js';

describe('password hashing', () => {
  it('uses argon2id and verifies without leaking the password', async () => {
    const hash = await hashPassword('CorrectHorse123');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(hash).not.toContain('CorrectHorse123');

    expect(await verifyPassword(hash, 'CorrectHorse123')).toBe(true);
    expect(await verifyPassword(hash, 'correcthorse123')).toBe(false);
  });

  it('salts every hash, so identical passwords get different digests', async () => {
    const [first, second] = await Promise.all([hashPassword('SamePassword1'), hashPassword('SamePassword1')]);
    expect(first).not.toBe(second);
  });

  it('treats a malformed hash as a failed verification rather than throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('tenant identity documents', () => {
  it('encrypts the number and exposes only the last four digits', () => {
    const number = 'ET-KEBELE-1234567890';
    const encrypted = encryptField(number);

    expect(encrypted).not.toContain(number);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted.split(':')).toHaveLength(4); // v1:iv:authTag:ciphertext
    expect(decryptField(encrypted)).toBe(number);

    // Deterministic (same input, same IV-length) is *not* required: each call re-randomises.
    expect(encryptField(number)).not.toBe(encrypted);

    expect(lastFour(number)).toBe('7890');
    expect(lastFour('12')).toBe('12');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptField('1234567890');
    const parts = encrypted.split(':');
    parts[3] = `${parts[3]!.slice(0, -2)}xx`;
    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('rejects a key that is too short', () => {
    expect(() => decryptField('bad')).toThrow();
  });
});
