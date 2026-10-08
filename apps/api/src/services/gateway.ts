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
  type PaymentGatewayProvider,
  type PaymentGatewayStatus,
} from '@pms/shared';

import { getConfig } from '../config.js';
import { decryptField, encryptField } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { recordAudit } from './audit.js';
import { missingGatewayCredentials } from '../providers/payments/index.js';
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

function platformDefaultProvider(): PaymentGatewayProvider {
  return getConfig().PAYMENT_PROVIDER as PaymentGatewayProvider;
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

/** The status payload for the Organization screen — no credential values, ever. */
export async function getGatewayStatus(
  prisma: PrismaClient,
  organizationId: string,
): Promise<PaymentGatewayStatus> {
  const stored = await readStored(prisma, organizationId);
  const provider: PaymentGatewayProvider = stored?.provider ?? platformDefaultProvider();
  const fields = PAYMENT_GATEWAY_CREDENTIAL_FIELDS[provider];

  const credentials: PaymentGatewayStatus['credentials'] = {};
  const plaintext: Record<string, string> = {};
  for (const field of fields) {
    const encrypted = stored?.credentials[field.key];
    if (!encrypted) {
      credentials[field.key] = { configured: false, hint: null };
      continue;
    }
    try {
      const value = decryptField(encrypted);
      plaintext[field.key] = value;
      credentials[field.key] = { configured: true, hint: credentialHint(value) };
    } catch {
      // Undecryptable (key rotation): report it as unset so the org re-saves.
      credentials[field.key] = { configured: false, hint: null };
    }
  }

  const missing = missingGatewayCredentials(provider, plaintext);

  return {
    provider,
    source: stored ? 'organization' : 'platform',
    mode: stored?.mode ?? null,
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
