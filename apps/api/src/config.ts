/**
 * Environment configuration.
 *
 * Rules: secrets only come from the environment, every required variable is
 * validated at startup (fail fast, never "undefined at runtime three hours
 * later"), and nothing here is ever logged. `.env` is git-ignored; `.env.example`
 * documents every variable.
 */

import { existsSync } from 'node:fs';

import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * `.env` supplies local development values; real environments set the variables
 * themselves. dotenv never overrides a value that is already present, so this is
 * safe everywhere, and CI/production never depend on a file existing.
 *
 * Two locations are supported: `apps/api/.env` (when working inside the app) and
 * the repository root `.env` (what `docs/LOCAL_DEV.md` tells developers to create).
 * The app-level file is read first, so it can override a shared root value.
 */
for (const candidate of ['../.env', '../../../.env']) {
  const path = new URL(candidate, import.meta.url).pathname;
  if (existsSync(path)) loadEnv({ path });
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  // Explicit origin providers send the payer back to after a portal checkout.
  // Defaults to CORS_ORIGINS[0]; set it when the public URL differs from the
  // first CORS entry (proxies, custom domains, separate portal host).
  PORTAL_RETURN_ORIGIN: z.string().url().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).default(2592000),
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),

  /** AES-256-GCM key for fields that must be encrypted at rest (tenant ID numbers). */
  FIELD_ENCRYPTION_KEY: z.string().min(32, 'FIELD_ENCRYPTION_KEY must be at least 32 characters'),

  JOBS_ENABLED: booleanish.default(true),
  WORKER_CRON_CHARGE_GENERATION: z.string().default('0 2 * * *'),
  WORKER_CRON_OVERDUE_SWEEP: z.string().default('30 2 * * *'),

  PAYMENT_PROVIDER: z.enum(['mock', 'telebirr', 'chapa']).default('mock'),
  SMS_PROVIDER: z.enum(['mock', 'ethio-telecom-sms']).default('mock'),
  CHAPA_SECRET_KEY: z.string().optional(),
  CHAPA_WEBHOOK_SECRET: z.string().optional(),
  TELEBIRR_APP_ID: z.string().optional(),
  TELEBIRR_APP_KEY: z.string().optional(),
  TELEBIRR_PUBLIC_KEY: z.string().optional(),
  TELEBIRR_PRIVATE_KEY: z.string().optional(),
  TELEBIRR_SHORT_CODE: z.string().optional(),
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_NAME: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(10 * 1024 * 1024),

  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(20),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\n\nSee .env.example for the full list.`);
  }
  const config: AppConfig = {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    isDevelopment: parsed.data.NODE_ENV === 'development',
  };
  cached = config;
  return config;
}

export function getConfig(): AppConfig {
  if (!cached) return loadConfig();
  return cached;
}

/** The database URL to use, honouring the test database during tests. */
export function databaseUrl(config: AppConfig = getConfig()): string {
  if (config.isTest) {
    if (!config.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must be set when NODE_ENV=test (never point tests at the dev database)',
      );
    }
    return config.TEST_DATABASE_URL;
  }
  return config.DATABASE_URL;
}

/** Warn loudly in production when optional integrations are left on their mock. */
export function configWarnings(config: AppConfig = getConfig()): string[] {
  const warnings: string[] = [];
  if (config.isProduction) {
    if (config.PAYMENT_PROVIDER === 'mock')
      warnings.push('PAYMENT_PROVIDER=mock in production: no real payments can be taken.');
    if (config.SMS_PROVIDER === 'mock')
      warnings.push('SMS_PROVIDER=mock in production: no SMS will actually be sent.');
    if (config.STORAGE_DRIVER === 'local')
      warnings.push('STORAGE_DRIVER=local in production: uploads are not durable or shared.');
  }
  return warnings;
}
