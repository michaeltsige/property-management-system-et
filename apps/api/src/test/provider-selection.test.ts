/**
 * Provider selection: which adapter a payment actually runs through.
 *
 * Pure decision tests — no database, no HTTP. `platformEnvProvider` encodes
 * "credentials imply intent" (a set CHAPA_SECRET_KEY selects Chapa even when
 * PAYMENT_PROVIDER still carries the copied-from-.env.example `mock` default —
 * the exact configuration that left a real key testing against the demo
 * gateway), and `resolveGatewayTarget` encodes the org-row vs platform
 * precedence, including the demo-row exception: a stored `mock` configuration
 * must not lock out real platform credentials, because the gateway form
 * pre-selects the demo and such a row is far more likely an accidental save
 * than a decision to keep running fake money under a real key.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import {
  platformEnvProvider,
  platformRealProviderActive,
  resolveGatewayTarget,
} from '../providers/payments/index.js';

/** Minimal valid env; loadConfig fills every documented default. */
const ENV_BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://pms:pms@localhost:5432/pms_test?schema=public',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  FIELD_ENCRYPTION_KEY: 'test-key-0123456789abcdef0123456789abcdef',
};

function configWith(overrides: Record<string, string | undefined>): AppConfig {
  return loadConfig({ ...ENV_BASE, ...overrides });
}

describe('platformEnvProvider — credentials imply intent', () => {
  it('selects chapa when a secret key is set, even over PAYMENT_PROVIDER=mock', () => {
    const config = configWith({ PAYMENT_PROVIDER: 'mock', CHAPA_SECRET_KEY: 'CHAPA_TEST_PRIV_abc123' });
    expect(platformEnvProvider(config)).toBe('chapa');
    expect(platformRealProviderActive(config)).toBe(true);
  });

  it('selects chapa when a secret key is set and PAYMENT_PROVIDER is left at its default', () => {
    const config = configWith({ PAYMENT_PROVIDER: undefined, CHAPA_SECRET_KEY: 'CHASECK_TEST-abc123' });
    expect(platformEnvProvider(config)).toBe('chapa');
  });

  it('keeps the documented sandbox simulation for chapa with an empty key', () => {
    const config = configWith({ PAYMENT_PROVIDER: 'chapa', CHAPA_SECRET_KEY: '' });
    expect(platformEnvProvider(config)).toBe('chapa');
    // Still a demo: no key, no real provider.
    expect(platformRealProviderActive(config)).toBe(false);
  });

  it('honours an explicit telebirr switch and the mock default', () => {
    expect(platformEnvProvider(configWith({ PAYMENT_PROVIDER: 'telebirr' }))).toBe('telebirr');
    expect(platformEnvProvider(configWith({ PAYMENT_PROVIDER: 'mock' }))).toBe('mock');
    expect(platformEnvProvider(configWith({}))).toBe('mock');
    expect(platformRealProviderActive(configWith({ PAYMENT_PROVIDER: 'telebirr' }))).toBe(false);
  });
});

describe('resolveGatewayTarget — org row vs platform precedence', () => {
  it('prefers the payment intent provider (the completion path)', () => {
    expect(resolveGatewayTarget({ provider: 'mock' }, 'chapa', 'chapa', true)).toBe('chapa');
    expect(resolveGatewayTarget({ provider: 'chapa' }, 'mock', 'chapa', true)).toBe('mock');
  });

  it('runs the demo when nothing else is configured', () => {
    expect(resolveGatewayTarget(null, undefined, 'mock', false)).toBe('mock');
  });

  it('uses real platform credentials when no org row exists', () => {
    expect(resolveGatewayTarget(null, undefined, 'chapa', true)).toBe('chapa');
  });

  it('does not let a stored demo row lock out real platform credentials', () => {
    // The gateway form pre-selects the demo; a saved mock row under a real key
    // is an accidental save, not a decision to run fake money.
    expect(resolveGatewayTarget({ provider: 'mock' }, undefined, 'chapa', true)).toBe('chapa');
  });

  it('keeps a stored demo row when the platform has no real gateway', () => {
    expect(resolveGatewayTarget({ provider: 'mock' }, undefined, 'mock', false)).toBe('mock');
    // PAYMENT_PROVIDER=chapa with an empty key is the sandbox simulation —
    // still a demo, so the explicit org choice stands.
    expect(resolveGatewayTarget({ provider: 'mock' }, undefined, 'chapa', false)).toBe('mock');
  });

  it('a stored real provider is a deliberate choice and wins', () => {
    expect(resolveGatewayTarget({ provider: 'chapa' }, undefined, 'chapa', true)).toBe('chapa');
    expect(resolveGatewayTarget({ provider: 'telebirr' }, undefined, 'chapa', true)).toBe('telebirr');
  });
});
