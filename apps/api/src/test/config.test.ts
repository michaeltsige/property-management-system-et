/**
 * Environment configuration validation.
 *
 * Regression: `.env.example` ships `CHAPA_BASE_URL=` empty, and a plain
 * `.optional()` rejects the empty string as an invalid URL — every fresh clone
 * that copied the example verbatim failed to boot (`CHAPA_BASE_URL: Invalid
 * url`). An empty (or whitespace-only) optional URL must count as unset.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';

const baseEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://pms:pms@localhost:5432/pms_test',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
};

describe('environment configuration', () => {
  it('treats empty optional URLs as unset', () => {
    const config = loadConfig({
      ...baseEnv,
      CHAPA_BASE_URL: '',
      API_PUBLIC_URL: '',
      PORTAL_RETURN_ORIGIN: '   ',
    });
    expect(config.CHAPA_BASE_URL).toBeUndefined();
    expect(config.API_PUBLIC_URL).toBeUndefined();
    expect(config.PORTAL_RETURN_ORIGIN).toBeUndefined();
  });

  it('keeps real URLs and still rejects garbage', () => {
    const config = loadConfig({ ...baseEnv, CHAPA_BASE_URL: 'https://api.chapa.co/v1' });
    expect(config.CHAPA_BASE_URL).toBe('https://api.chapa.co/v1');

    expect(() => loadConfig({ ...baseEnv, CHAPA_BASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
