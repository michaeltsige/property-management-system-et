/**
 * Translation Manager API.
 *
 * The admin UI lists every key with its English source, the text users currently
 * see and its review status; overrides are stored per organization (or globally
 * for platform admins), and every change writes a revision so edits have history.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  exportSourceTemplate,
  lintCatalogs,
  parseCsv,
  toCsv,
  translationManagerRows,
  TRANSLATION_CSV_HEADER,
  type TranslationOverride,
  type TranslationStatus,
} from '@pms/i18n';
import type { LanguageCode } from '@pms/calendar';
import { translationOverrideSchema } from '@pms/shared';

import { badRequest, notFound } from '../lib/errors.js';
import { pstr, str } from '../lib/query.js';
import { getPrisma } from '../lib/prisma.js';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../services/audit.js';

export const translationsRouter = Router();
translationsRouter.use(requireAuth);

const languageQuery = z.object({ language: z.enum(['en', 'am', 'om', 'ti']).default('en') });

async function loadOverrides(organizationId: string): Promise<TranslationOverride[]> {
  const rows = await getPrisma().translationOverride.findMany({
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

/** Every key with English, current text, source and status. */
translationsRouter.get(
  '/',
  requirePermission('translations.read'),
  validate({ query: languageQuery }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const overrides = await loadOverrides(organizationId);
      const language = (str(req.query.language) ?? 'en') as LanguageCode;
      const rows = translationManagerRows(language, { organizationId, overrides });
      res.json({ rows, coverage: lintCatalogs().coverage });
    } catch (error) {
      next(error);
    }
  },
);

/** Catalog health, used by the admin screen and by CI. */
translationsRouter.get('/lint', requirePermission('translations.read'), (_req, res) => {
  res.json(lintCatalogs());
});

translationsRouter.get(
  '/export',
  requirePermission('translations.read'),
  validate({ query: languageQuery.extend({ template: z.coerce.boolean().default(false) }) }),
  async (req, res, next) => {
    try {
      const language = (str(req.query.language) ?? 'en') as LanguageCode;
      if (str(req.query.template) === 'true') {
        res.type('text/csv').send(exportSourceTemplate());
        return;
      }
      const organizationId = organizationIdOf(req);
      const overrides = await loadOverrides(organizationId);
      const rows = translationManagerRows(language, { organizationId, overrides }).map((row) => ({
        key: row.key,
        language: row.language,
        status: row.status,
        text: row.current,
        organizationId: row.source === 'organization_override' ? organizationId : null,
      }));
      res.type('text/csv').send(toCsv(rows));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Import a CSV produced by `/export` (the browser reads the file and posts its
 * text, so no multipart parser is needed). Rows become overrides with history.
 */
translationsRouter.post(
  '/import',
  requirePermission('translations.manage'),
  validate({
    body: z.object({
      csv: z.string().min(1),
      /** Mark imported rows as reviewed (only after a human checked them). */
      status: z.enum(['machine_draft', 'unreviewed', 'reviewed']).default('unreviewed'),
      dryRun: z.boolean().default(true),
    }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const parsed = parseCsv(req.body.csv);
      const header = (parsed[0] ?? []).map((value) => value.trim().toLowerCase());
      if (header.join(',') !== TRANSLATION_CSV_HEADER.join(',')) {
        throw badRequest(`Unexpected CSV header. Expected: ${TRANSLATION_CSV_HEADER.join(',')}`);
      }

      const rows = parsed.slice(1).filter((values) => values.length >= 4 && values[0] && values[3]);
      if (req.body.dryRun) {
        res.json({ dryRun: true, wouldImport: rows.length });
        return;
      }

      const result = await getPrisma().$transaction(async (tx) => {
        let imported = 0;
        for (const values of rows) {
          const [key, language, , text] = values as [string, string, string, string];
          if (!['am', 'om', 'ti'].includes(language)) continue;

          const existing = await tx.translationOverride.findFirst({
            where: { organizationId, key, language },
          });

          const override = await tx.translationOverride.upsert({
            where: { organizationId_key_language: { organizationId, key, language } },
            create: { organizationId, key, language, text, status: req.body.status },
            update: { text, status: req.body.status },
          });

          await tx.translationRevision.create({
            data: {
              overrideId: override.id,
              previousText: existing?.text ?? null,
              newText: text,
              changeType: existing ? 'import' : 'create',
              changedById: req.auth?.userId ?? null,
            },
          });
          imported += 1;
        }

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'TranslationOverride',
          entityId: null,
          after: { imported, status: req.body.status },
          requestId: req.requestId,
        });

        return { imported };
      });

      res.json({ dryRun: false, ...result });
    } catch (error) {
      next(error);
    }
  },
);

/** Create or update an override for one key. */
translationsRouter.put(
  '/:key',
  requirePermission('translations.manage'),
  validate({
    params: z.object({ key: z.string().min(3) }),
    body: translationOverrideSchema
      .omit({ key: true })
      .extend({ organizationId: z.string().uuid().optional() }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = req.body.organizationId ?? organizationIdOf(req);

      if (req.body.organizationId && !req.auth?.isPlatformAdmin) {
        throw badRequest('Only platform administrators may create global translation overrides');
      }

      const prisma = getPrisma();
      const key = pstr(req, 'key');
      const language = req.body.language;

      const override = await prisma.$transaction(async (tx) => {
        const existing = await tx.translationOverride.findFirst({ where: { organizationId, key, language } });

        const saved = await tx.translationOverride.upsert({
          where: { organizationId_key_language: { organizationId, key, language } },
          create: {
            organizationId,
            key,
            language,
            text: req.body.text,
            status: req.body.status,
            reviewedById: req.body.status === 'reviewed' ? (req.auth?.userId ?? null) : null,
            reviewedAt: req.body.status === 'reviewed' ? new Date() : null,
          },
          update: {
            text: req.body.text,
            status: req.body.status,
            reviewedById: req.body.status === 'reviewed' ? (req.auth?.userId ?? null) : null,
            reviewedAt: req.body.status === 'reviewed' ? new Date() : null,
          },
        });

        await tx.translationRevision.create({
          data: {
            overrideId: saved.id,
            previousText: existing?.text ?? null,
            newText: req.body.text,
            changeType: existing ? 'update' : 'create',
            changedById: req.auth?.userId ?? null,
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: existing ? 'update' : 'create',
          entityType: 'TranslationOverride',
          entityId: saved.id,
          before: existing ? { text: existing.text, status: existing.status } : null,
          after: { key, language, status: saved.status },
          requestId: req.requestId,
        });

        return saved;
      });

      res.json({ override });
    } catch (error) {
      next(error);
    }
  },
);

/** Remove an override so the shipped catalog is used again (history is kept). */
translationsRouter.delete(
  '/:key',
  requirePermission('translations.manage'),
  validate({
    params: z.object({ key: z.string().min(3) }),
    query: z.object({ language: z.enum(['en', 'am', 'om', 'ti']) }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const prisma = getPrisma();
      const existing = await prisma.translationOverride.findFirst({
        where: { organizationId, key: pstr(req, 'key'), language: str(req.query.language) ?? 'en' },
      });
      if (!existing) throw notFound('No override exists for this key');

      await prisma.$transaction(async (tx) => {
        await tx.translationRevision.create({
          data: {
            overrideId: existing.id,
            previousText: existing.text,
            newText: '',
            changeType: 'revert',
            changedById: req.auth?.userId ?? null,
          },
        });
        await tx.translationOverride.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'delete',
          entityType: 'TranslationOverride',
          entityId: existing.id,
          before: { key: existing.key, language: existing.language, text: existing.text },
        });
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/** Edit history for a key: who changed what, and when. */
translationsRouter.get(
  '/:key/history',
  requirePermission('translations.read'),
  validate({
    params: z.object({ key: z.string().min(3) }),
    query: z.object({ language: z.string().min(2).max(2) }),
  }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const override = await getPrisma().translationOverride.findFirst({
        where: { organizationId, key: pstr(req, 'key'), language: str(req.query.language) ?? 'en' },
      });
      if (!override) {
        res.json({ revisions: [] });
        return;
      }
      const revisions = await getPrisma().translationRevision.findMany({
        where: { overrideId: override.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({ revisions });
    } catch (error) {
      next(error);
    }
  },
);
