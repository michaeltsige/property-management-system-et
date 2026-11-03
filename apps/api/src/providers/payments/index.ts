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
 *    A stored **demo (`mock`) row is the one exception**: it cannot outrank real
 *    platform credentials (see `resolveGatewayTarget`) — the gateway form
 *    pre-selects the demo, so such a row is far more likely an accidental save
 *    than a decision to keep running fake money under a real key.
 * 2. **Platform environment** (fallback): provider-specific environment
 *    variables, used when the organization has not configured its own gateway.
 *    Credentials imply intent: a non-empty `CHAPA_SECRET_KEY` selects Chapa on
 *    its own, even when `PAYMENT_PROVIDER` still carries the copied-from-.env
 *    .example default `mock` — the #1 "the demo gateway is still running"
 *    report. `PAYMENT_PROVIDER` only decides between providers that have no
 *    credentials in the environment (`chapa` + empty key = the documented
 *    built-in sandbox simulation; `mock` = the demo).
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

import { getConfig, type AppConfig } from '../../config.js';
import { decryptField } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { ChapaPaymentProvider, type ChapaMode } from './chapa.js';
import { MockPaymentProvider, mockPaymentProvider } from './mock.js';
import { TelebirrPaymentProvider } from './telebirr.js';
import { ProviderNotConfiguredError, type PaymentProviderAdapter, type ProviderName } from './types.js';

/** What an organization has saved (credential values already decrypted). */
export interface OrgGatewayConfig {
  provider: ProviderName;
  mode: PaymentGatewayMode;
  credentials: Record<string, string>;
}

/**
 * The provider the platform environment points at. Real credentials imply
 * intent: a set `CHAPA_SECRET_KEY` means Chapa regardless of what
 * `PAYMENT_PROVIDER` says (its `mock` default ships uncommented in .env.example
 * and survives every verbatim copy). `PAYMENT_PROVIDER` only decides among
 * credential-less modes: `chapa` with an empty key is the documented built-in
 * sandbox simulation, `telebirr` stays the scaffold, everything else is mock.
 */
export function platformEnvProvider(config: AppConfig = getConfig()): ProviderName {
  if (config.CHAPA_SECRET_KEY) return 'chapa';
  if (config.PAYMENT_PROVIDER === 'telebirr' || config.PAYMENT_PROVIDER === 'chapa') {
    return config.PAYMENT_PROVIDER;
  }
  return 'mock';
}

/**
 * Whether the platform environment actually carries a **real** gateway — one
 * that talks to an outside provider. Chapa counts only with a secret key: the
 * credential-free mode is the built-in sandbox simulation, which is still a
 * demo and must not outrank an explicit organization choice either.
 */
export function platformRealProviderActive(config: AppConfig = getConfig()): boolean {
  const provider = platformEnvProvider(config);
  if (provider === 'mock') return false;
  if (provider === 'chapa') return Boolean(config.CHAPA_SECRET_KEY);
  return getPaymentProvider(provider, config).isConfigured();
}

/**
 * The gateway an organization's payments actually run through, as a pure
 * decision so the status endpoint (`getGatewayStatus`) and the adapter
 * resolution (`resolveOrgPaymentProvider`) can never disagree.
 *
 * - `preferred` wins: the completion path verifies against the provider that
 *   started the payment, whatever changed since.
 * - Real platform credentials outrank an **absent** org config and a stored
 *   **demo (`mock`)** row — the form pre-selects the demo, so that row is an
 *   accidental save until proven otherwise. A stored real provider (chapa /
 *   telebirr) is a deliberate choice and still wins.
 * - Otherwise: the org's row, else the platform environment.
 */
export function resolveGatewayTarget(
  stored: { provider: ProviderName } | null,
  preferred: ProviderName | undefined,
  envProvider: ProviderName,
  envRealConfigured: boolean,
): ProviderName {
  if (preferred) return preferred;
  if (envRealConfigured && (!stored || stored.provider === 'mock')) return envProvider;
  return stored?.provider ?? envProvider;
}

/** Environment-derived credentials for one provider (the platform default). */
export function envCredentials(
  name: ProviderName,
  config: AppConfig = getConfig(),
): Record<string, string> {
  switch (name) {
    case 'chapa':
      return {
        ...(config.CHAPA_SECRET_KEY ? { secretKey: config.CHAPA_SECRET_KEY } : {}),
        ...(config.CHAPA_WEBHOOK_SECRET ? { webhookSecret: config.CHAPA_WEBHOOK_SECRET } : {}),
        ...(config.CHAPA_BASE_URL ? { baseUrl: config.CHAPA_BASE_URL } : {}),
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

/**
 * Build an adapter instance for a provider from an explicit credential map.
 *
 * `mode` is meaningful for Chapa: `test` always runs the built-in sandbox
 * simulation (no network, no account needed — what an organization uses before
 * its credentials exist), `live` makes real api.chapa.co calls with the saved
 * secret key. Without an explicit mode the presence of a secret key decides.
 */
export function buildPaymentProvider(
  name: ProviderName,
  credentials: Record<string, string> = {},
  mode?: PaymentGatewayMode,
): PaymentProviderAdapter {
  switch (name) {
    // The mock keeps a single in-process transaction ledger, so the demo checkout
    // (initiate in one request, confirm+complete in later ones) shares state.
    case 'mock':
      return mockPaymentProvider;
    case 'chapa': {
      const chapaMode: ChapaMode = mode ?? (credentials.secretKey ? 'live' : 'test');
      return new ChapaPaymentProvider(
        {
          secretKey: credentials.secretKey,
          webhookSecret: credentials.webhookSecret,
          baseUrl: credentials.baseUrl,
        },
        chapaMode,
      );
    }
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
  name: ProviderName = platformEnvProvider(),
  config: AppConfig = getConfig(),
): PaymentProviderAdapter {
  return buildPaymentProvider(name, envCredentials(name, config));
}

/**
 * Required credential fields an adapter of `name` still lacks.
 *
 * Mode-aware for Chapa: test mode (the built-in sandbox simulation) needs
 * nothing, live mode needs the secret key; the webhook secret is optional
 * because payments still verify on return without it (webhook events are
 * simply rejected as unsigned).
 */
export function missingGatewayCredentials(
  name: ProviderName,
  credentials: Record<string, string>,
  mode?: PaymentGatewayMode,
): string[] {
  if (name === 'chapa') {
    const chapaMode: ChapaMode = mode ?? (credentials.secretKey ? 'live' : 'test');
    return chapaMode === 'live' && !credentials.secretKey ? ['secretKey'] : [];
  }
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
 * The target comes from `resolveGatewayTarget` (see it for the full precedence:
 * payment intent → real platform credentials over an absent-or-demo org row →
 * the org's row → the platform environment), and the credentials come from the
 * layer that decided:
 *
 * - A matching org row runs its own encrypted credentials; incomplete ones
 *   throw `ProviderNotConfiguredError` naming the missing fields.
 * - Anything else (no row, a row the platform outranks, or a `preferred`
 *   completion target) resolves from the platform environment and fails with a
 *   clear "not configured" error when the env lacks the credentials too.
 */
export async function resolveOrgPaymentProvider(
  prisma: PrismaClient,
  organizationId: string,
  preferred?: ProviderName,
): Promise<OrgPaymentProviderResolution> {
  const stored = await readOrgGatewayConfig(prisma, organizationId);
  const target: ProviderName = resolveGatewayTarget(
    stored,
    preferred,
    platformEnvProvider(),
    platformRealProviderActive(),
  );

  if (stored && stored.provider === target) {
    const missing = missingGatewayCredentials(target, stored.credentials, stored.mode);
    if (missing.length > 0) {
      throw new ProviderNotConfiguredError(target, missing.join(', '));
    }
    logger.info(
      {
        organizationId,
        provider: target,
        source: 'organization',
        mode: stored.mode,
        preferred: preferred ?? null,
      },
      'payment provider resolved',
    );
    return {
      adapter: buildPaymentProvider(target, stored.credentials, stored.mode),
      provider: target,
      source: 'organization',
      mode: stored.mode,
    };
  }

  const adapter = getPaymentProvider(target);
  if (!adapter.isConfigured()) {
    throw new ProviderNotConfiguredError(target, missingGatewayCredentials(target, envCredentials(target)).join(', '));
  }
  logger.info(
    {
      organizationId,
      provider: target,
      source: 'platform',
      storedProvider: stored?.provider ?? null,
      preferred: preferred ?? null,
    },
    'payment provider resolved',
  );
  return { adapter, provider: target, source: 'platform', mode: null };
}

export { MockPaymentProvider, mockPaymentProvider };
export * from './types.js';
