/**
 * Payment provider registry with per-organization resolution.
 *
 * Two layers select the active adapter:
 *
 * 1. **Organization configuration** (preferred): the row stored in
 *    `OrganizationSetting` under `payment_gateway` — provider, mode and
 *    AES-256-GCM-encrypted credentials, managed by the org's admins from the
 *    Organization screen. This is what makes "get the business license, save the
 *    merchant credentials, switch provider" a settings edit instead of a deploy.
 * 2. **Platform environment** (fallback): the `PAYMENT_PROVIDER` +
 *    provider-specific environment variables, used when the organization has not
 *    configured its own gateway (the pre-gateway behavior, and the default in
 *    development/CI where the mock adapter serves as the demo).
 *
 * Unconfigured providers are still resolvable (so `/ready` and the UI can report
 * their state) but every call throws `ProviderNotConfiguredError` with the exact
 * missing pieces instead of silently pretending to work.
 */

import type { PrismaClient } from '@prisma/client';

import {
  PAYMENT_GATEWAY_CREDENTIAL_FIELDS,
  PAYMENT_GATEWAY_SETTING_KEY,
  type PaymentGatewayMode,
} from '@pms/shared';

import { getConfig } from '../../config.js';
import { decryptField } from '../../lib/crypto.js';
import { ChapaPaymentProvider } from './chapa.js';
import { MockPaymentProvider, mockPaymentProvider } from './mock.js';
import { TelebirrPaymentProvider } from './telebirr.js';
import { ProviderNotConfiguredError, type PaymentProviderAdapter, type ProviderName } from './types.js';

/** What an organization has saved (credential values already decrypted). */
export interface OrgGatewayConfig {
  provider: ProviderName;
  mode: PaymentGatewayMode;
  credentials: Record<string, string>;
}

/** Environment-derived credentials for one provider (the platform default). */
function envCredentials(name: ProviderName): Record<string, string> {
  const config = getConfig();
  switch (name) {
    case 'chapa':
      return {
        ...(config.CHAPA_SECRET_KEY ? { secretKey: config.CHAPA_SECRET_KEY } : {}),
        ...(config.CHAPA_WEBHOOK_SECRET ? { webhookSecret: config.CHAPA_WEBHOOK_SECRET } : {}),
      };
    case 'telebirr':
      return {
        ...(config.TELEBIRR_APP_ID ? { appId: config.TELEBIRR_APP_ID } : {}),
        ...(config.TELEBIRR_APP_KEY ? { appKey: config.TELEBIRR_APP_KEY } : {}),
        ...(config.TELEBIRR_SHORT_CODE ? { shortCode: config.TELEBIRR_SHORT_CODE } : {}),
        ...(config.TELEBIRR_PUBLIC_KEY ? { publicKey: config.TELEBIRR_PUBLIC_KEY } : {}),
        ...(config.TELEBIRR_PRIVATE_KEY ? { privateKey: config.TELEBIRR_PRIVATE_KEY } : {}),
      };
    case 'mock':
      return {};
  }
}

/** Build an adapter instance for a provider from an explicit credential map. */
export function buildPaymentProvider(
  name: ProviderName,
  credentials: Record<string, string> = {},
): PaymentProviderAdapter {
  switch (name) {
    // The mock keeps a single in-process transaction ledger, so the demo checkout
    // (initiate in one request, confirm+complete in later ones) shares state.
    case 'mock':
      return mockPaymentProvider;
    case 'chapa':
      return new ChapaPaymentProvider({
        secretKey: credentials.secretKey,
        webhookSecret: credentials.webhookSecret,
      });
    case 'telebirr':
      return new TelebirrPaymentProvider({
        appId: credentials.appId,
        appKey: credentials.appKey,
        shortCode: credentials.shortCode,
        publicKey: credentials.publicKey,
        privateKey: credentials.privateKey,
      });
  }
}

/**
 * The platform-default adapter from environment variables. Kept for callers
 * outside an organization context (health, jobs) and as the org fallback.
 */
export function getPaymentProvider(
  name: ProviderName = getConfig().PAYMENT_PROVIDER as ProviderName,
): PaymentProviderAdapter {
  return buildPaymentProvider(name, envCredentials(name));
}

export function listPaymentProviders(): { name: ProviderName; configured: boolean }[] {
  return (['mock', 'telebirr', 'chapa'] as ProviderName[]).map((name) => ({
    name,
    configured: buildPaymentProvider(name, envCredentials(name)).isConfigured(),
  }));
}

/** Required credential fields an adapter of `name` still lacks. */
export function missingGatewayCredentials(
  name: ProviderName,
  credentials: Record<string, string>,
): string[] {
  return PAYMENT_GATEWAY_CREDENTIAL_FIELDS[name]
    .filter((field) => field.required && !credentials[field.key])
    .map((field) => field.key);
}

/**
 * Read the organization's stored gateway config and decrypt its credentials.
 * Returns `null` when the organization has never configured a gateway, so the
 * caller falls back to the platform environment. Unknown provider names (e.g.
 * after a provider was retired) are treated as absent rather than crashing
 * every payment.
 */
export async function readOrgGatewayConfig(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OrgGatewayConfig | null> {
  const row = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: PAYMENT_GATEWAY_SETTING_KEY } },
  });
  if (!row) return null;

  const value = row.value as {
    provider?: string;
    mode?: string;
    credentials?: Record<string, string>;
  } | null;
  if (!value || !value.provider) return null;
  if (!(['mock', 'telebirr', 'chapa'] as string[]).includes(value.provider)) return null;

  const credentials: Record<string, string> = {};
  const allowed = new Set(PAYMENT_GATEWAY_CREDENTIAL_FIELDS[value.provider as ProviderName].map((f) => f.key));
  for (const [key, encrypted] of Object.entries(value.credentials ?? {})) {
    if (!allowed.has(key) || typeof encrypted !== 'string') continue;
    try {
      credentials[key] = decryptField(encrypted);
    } catch {
      // A credential that cannot be decrypted (e.g. the encryption key was
      // rotated) must not take the whole payment path down; the adapter will
      // report it as missing and the org re-saves it.
    }
  }

  return {
    provider: value.provider as ProviderName,
    mode: value.mode === 'live' ? 'live' : 'test',
    credentials,
  };
}

export interface OrgPaymentProviderResolution {
  adapter: PaymentProviderAdapter;
  provider: ProviderName;
  /** Where the effective configuration came from. */
  source: 'organization' | 'platform';
  mode: PaymentGatewayMode | null;
}

/**
 * Resolve the adapter an organization's payment must run through.
 *
 * - No `preferred`: the org's configured provider, else the platform default.
 * - `preferred` (completion path — the intent records which provider started
 *   it): resolve that provider with the org's credentials when they cover it,
 *   else the platform environment. An intent started under a since-changed
 *   provider therefore verifies against the platform default or fails with a
 *   clear "not configured" error instead of mixing credential sets.
 */
export async function resolveOrgPaymentProvider(
  prisma: PrismaClient,
  organizationId: string,
  preferred?: ProviderName,
): Promise<OrgPaymentProviderResolution> {
  const stored = await readOrgGatewayConfig(prisma, organizationId);
  const envDefault = getConfig().PAYMENT_PROVIDER as ProviderName;
  const target: ProviderName = preferred ?? stored?.provider ?? envDefault;

  if (stored && stored.provider === target) {
    const missing = missingGatewayCredentials(target, stored.credentials);
    if (missing.length > 0) {
      throw new ProviderNotConfiguredError(target, missing.join(', '));
    }
    return { adapter: buildPaymentProvider(target, stored.credentials), provider: target, source: 'organization', mode: stored.mode };
  }

  const adapter = getPaymentProvider(target);
  if (!adapter.isConfigured()) {
    throw new ProviderNotConfiguredError(target, missingGatewayCredentials(target, envCredentials(target)).join(', '));
  }
  return { adapter, provider: target, source: 'platform', mode: null };
}

export { MockPaymentProvider, mockPaymentProvider };
export * from './types.js';
