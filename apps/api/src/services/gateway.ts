/**
 * Per-organization payment gateway configuration.
 *
 * The organization's provider choice and its merchant credentials live in one
 * `OrganizationSetting` row (key `payment_gateway`) so that switching gateway is
 * a data edit — exactly the property the owner asked for: the structure exists
 * today, the mock provider runs the demo, and when the business license unlocks
 * real Telebirr/Chapa credentials they are saved into the same shape.
 *
 * Secret handling (mirrors the tenant-ID rules, ADR-0016/0038):
 * - Credential values arrive over TLS, are AES-256-GCM encrypted (`encryptField`)
 *   before they touch the database, and are decrypted only in memory to build
 *   the adapter.
 * - Every API response shows only whether a field is set plus a `••••last4` hint.
 * - Audit rows record which fields changed and their hints — never a value,
 *   plain or encrypted.
 */

import type { PrismaClient } from '@prisma/client';

import {
  PAYMENT_GATEWAY_CREDENTIAL_FIELDS,
  PAYMENT_GATEWAY_SETTING_KEY,
  type PaymentGatewayConfigInput,
  type PaymentGatewayMode,
  type PaymentGatewayStatus,
} from '@pms/shared';

import { getConfig } from '../config.js';
import { decryptField, encryptField } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { recordAudit } from './audit.js';
import { missingGatewayCredentials, envCredentials, platformEnvProvider, platformRealProviderActive, resolveGatewayTarget } from '../providers/payments/index.js';
import type { ProviderName } from '../providers/payments/index.js';

/** Stored row shape (credential values are `v1:iv:tag:ct` ciphertext). */
interface StoredGatewayConfig {
  provider: ProviderName;
  mode: 'test' | 'live';
  credentials: Record<string, string>;
}

/** `••••` plus the last four characters — same masking rule as tenant ID numbers. */
function credentialHint(value: string): string {
  const clean = value.trim();
  return `••••${clean.slice(-4)}`;
}

async function readStored(prisma: PrismaClient, organizationId: string): Promise<StoredGatewayConfig | null> {
  const row = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: PAYMENT_GATEWAY_SETTING_KEY } },
  });
  if (!row) return null;
  const value = row.value as Partial<StoredGatewayConfig> | null;
  if (!value?.provider) return null;
  return {
    provider: value.provider as ProviderName,
    mode: value.mode === 'live' ? 'live' : 'test',
    credentials: value.credentials ?? {},
  };
}

/**
 * The status payload for the Organization screen — no credential values, ever.
 *
 * It reports the **effective** gateway — the same decision payments go through
 * (`resolveGatewayTarget`), so the screen never lies about what a tenant
 * checkout will do:
 *
 * - The source is `platform` whenever the environment decides (no org row, or a
 *   stored demo row that real platform credentials outrank).
 * - `mode` is always concrete for Chapa: an environment-sourced Chapa is live
 *   when the environment carries a secret key, otherwise it is the built-in
 *   sandbox simulation.
 * - `missing`/`configured` account for the environment's own credentials when
 *   the source is `platform` — previously a platform Chapa with an env key
 *   wrongly reported `missing: ['secretKey']`. The masked per-field hints still
 *   come from the organization's own saved values only, so a platform key's
 *   `••••last4` never crosses an organization boundary.
 */
export async function getGatewayStatus(
  prisma: PrismaClient,
  organizationId: string,
): Promise<PaymentGatewayStatus> {
  const stored = await readStored(prisma, organizationId);
  const provider = resolveGatewayTarget(
    stored ?? null,
    undefined,
    platformEnvProvider(),
    platformRealProviderActive(),
  );
  const source: 'organization' | 'platform' =
    stored && stored.provider === provider ? 'organization' : 'platform';
  const fields = PAYMENT_GATEWAY_CREDENTIAL_FIELDS[provider];

  // Plaintext lives only in this function, and only to compute the missing
  // fields. Only the org's own saved values are decrypted; the platform's env
  // credentials join solely when the environment is the effective source.
  const plaintext: Record<string, string> = {};
  if (stored && stored.provider === provider) {
    for (const field of fields) {
      const encrypted = stored.credentials[field.key];
      if (!encrypted) continue;
      try {
        plaintext[field.key] = decryptField(encrypted);
      } catch {
        // Undecryptable (key rotation): report it as unset so the org re-saves.
      }
    }
  }
  if (source === 'platform') {
    for (const [key, value] of Object.entries(envCredentials(provider))) {
      if (fields.some((field) => field.key === key) && value) plaintext[key] = value;
    }
  }

  const platformChapaMode: PaymentGatewayMode | null =
    provider === 'chapa' ? (getConfig().CHAPA_SECRET_KEY ? 'live' : 'test') : null;
  const mode: PaymentGatewayMode | null =
    stored && stored.provider === provider ? stored.mode : platformChapaMode;

  const missing = missingGatewayCredentials(provider, plaintext, mode ?? undefined);

  // Masked hints describe the org's own saved credentials only — never the
  // platform's environment values.
  const credentials: PaymentGatewayStatus['credentials'] = {};
  for (const field of fields) {
    const encrypted = stored && stored.provider === provider ? stored.credentials[field.key] : undefined;
    if (!encrypted) {
      credentials[field.key] = { configured: false, hint: null };
      continue;
    }
    try {
      credentials[field.key] = { configured: true, hint: credentialHint(decryptField(encrypted)) };
    } catch {
      credentials[field.key] = { configured: false, hint: null };
    }
  }

  return {
    provider,
    source,
    mode,
    configured: missing.length === 0,
    missing,
    credentials,
  };
}

/**
 * Save (or replace) the organization's gateway configuration.
 * Omitted credential fields keep their saved value when the provider is
 * unchanged; switching provider starts with a fresh credential set, because
 * old fields are meaningless for the new gateway.
 */
export async function saveGatewayConfig(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; input: PaymentGatewayConfigInput },
): Promise<PaymentGatewayStatus> {
  const { organizationId, actorUserId, input } = params;
  const fields = PAYMENT_GATEWAY_CREDENTIAL_FIELDS[input.provider];
  const allowed = new Set(fields.map((field) => field.key));

  for (const key of Object.keys(input.credentials)) {
    if (!allowed.has(key)) {
      throw badRequest(`Unknown credential field "${key}" for provider "${input.provider}"`, {
        fields: [{ path: `credentials.${key}`, message: 'Unknown credential field' }],
      });
    }
  }

  const previous = await readStored(prisma, organizationId);
  const carried =
    previous && previous.provider === input.provider ? previous.credentials : {};

  const credentials: Record<string, string> = { ...carried };
  for (const [key, value] of Object.entries(input.credentials)) {
    credentials[key] = encryptField(value.trim());
  }

  const beforeAudit = previous && {
    provider: previous.provider,
    mode: previous.mode,
    credentialFields: Object.keys(previous.credentials).sort(),
  };

  await prisma.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key: PAYMENT_GATEWAY_SETTING_KEY } },
    create: {
      organizationId,
      key: PAYMENT_GATEWAY_SETTING_KEY,
      value: { provider: input.provider, mode: input.mode, credentials } as never,
      updatedById: actorUserId,
    },
    update: {
      value: { provider: input.provider, mode: input.mode, credentials } as never,
      updatedById: actorUserId,
    },
  });

  await recordAudit(prisma, {
    organizationId,
    actorUserId,
    action: previous ? 'update' : 'create',
    entityType: 'PaymentGateway',
    entityId: organizationId,
    before: (beforeAudit ?? undefined) as Record<string, unknown> | undefined,
    after: {
      provider: input.provider,
      mode: input.mode,
      credentialFields: Object.keys(credentials).sort(),
    },
  });

  return getGatewayStatus(prisma, organizationId);
}

/** Remove the organization's configuration: the platform default applies again. */
export async function resetGatewayConfig(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string },
): Promise<PaymentGatewayStatus> {
  const { organizationId, actorUserId } = params;

  const existing = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: PAYMENT_GATEWAY_SETTING_KEY } },
  });
  if (existing) {
    await prisma.organizationSetting.delete({
      where: { organizationId_key: { organizationId, key: PAYMENT_GATEWAY_SETTING_KEY } },
    });
    await recordAudit(prisma, {
      organizationId,
      actorUserId,
      action: 'delete',
      entityType: 'PaymentGateway',
      entityId: organizationId,
      before: {
        provider: (existing.value as { provider?: string }).provider ?? null,
        mode: (existing.value as { mode?: string }).mode ?? null,
        credentialFields: Object.keys(((existing.value as { credentials?: Record<string, string> }).credentials) ?? {}).sort(),
      },
    });
  }

  return getGatewayStatus(prisma, organizationId);
}
