/**
 * Rendered notification templates.
 *
 * A notification body is always produced from an i18n key, never from a string
 * built in code, so admins can override the wording per organization in the
 * Translation Manager and tenants receive it in their own language. The lookup
 * order is the same as everywhere else: organization override → global override →
 * shipped catalog → English → the raw key.
 */

import type { PrismaClient } from '@prisma/client';
import {
  createTranslator,
  resolveMessage,
  type TranslationOverride,
  type TranslationStatus,
} from '@pms/i18n';
import type { LanguageCode } from '@pms/calendar';

export interface RenderTemplateInput {
  organizationId: string;
  templateKey: string;
  language: LanguageCode;
  values: Record<string, string | number>;
}

export interface RenderedTemplate {
  body: string;
  /** How the text was found, so the UI can flag an unreviewed machine draft. */
  status: TranslationStatus;
  source: string;
}

export async function loadOverrides(
  prisma: PrismaClient,
  organizationId: string,
): Promise<TranslationOverride[]> {
  const rows = await prisma.translationOverride.findMany({
    where: { OR: [{ organizationId }, { organizationId: null }] },
  });
  return rows.map((row) => ({
    key: row.key,
    language: row.language as LanguageCode,
    text: row.text,
    organizationId: row.organizationId,
    status: row.status as TranslationStatus,
  }));
}

export async function renderTemplate(
  prisma: PrismaClient,
  input: RenderTemplateInput,
): Promise<RenderedTemplate> {
  const overrides = await loadOverrides(prisma, input.organizationId);
  const resolved = resolveMessage(input.templateKey as never, {
    language: input.language,
    organizationId: input.organizationId,
    overrides,
  });

  // `createTranslator` handles ICU arguments (plurals, numbers) and falls back to
  // the raw text rather than throwing when an argument is missing.
  const translate = createTranslator({
    language: input.language,
    overrides,
    organizationId: input.organizationId,
  });
  // `t` already degrades to the resolved text when ICU formatting fails, so an
  // admin who mistypes a placeholder does not block the message.
  const body = translate.t(input.templateKey as never, input.values);

  return { body, status: resolved.status, source: resolved.source };
}
