import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { z } from 'zod';
import {
  CSV_HEADERS,
  csvTenantSchema,
  csvUnitSchema,
  importRequestSchema,
  parsePortfolioCsv,
  type ImportError,
} from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { checkBuilding } from '../services/hierarchy.js';
import { recordAudit } from '../services/audit.js';

export const importsRouter = Router();
for (const kind of ['units', 'tenants'] as const) {
  importsRouter.post(
    `/imports/${kind}`,
    requireAuth,
    requirePermission(kind === 'units' ? 'units.write' : 'tenants.write'),
    validate({ body: importRequestSchema }),
    async (req, res, next) => {
      try {
        const organizationId = organizationIdOf(req);
        const input = importRequestSchema.parse(req.body);
        if (Buffer.byteLength(input.csv, 'utf8') > 262144) throw badRequest('CSV exceeds 256 KiB');
        if (kind === 'units' && !input.propertyId)
          throw badRequest('propertyId is required for unit imports');
        if (kind === 'tenants' && (input.propertyId || input.buildingId))
          throw badRequest('Tenant import does not assign units or leases');
        const result = await getPrisma().$transaction(
          async (tx) => {
            // Serialize import replay/duplicate checks per org; unique labels still cover non-import writers.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
            const property =
              kind === 'units'
                ? await tx.property.findFirst({
                    where: { id: input.propertyId, organizationId, deletedAt: null },
                    include: { organization: true },
                  })
                : null;
            if (kind === 'units') {
              if (!property) throw notFound('Property not found in this organization');
              await checkBuilding(tx, organizationId, property.id, input.buildingId);
            }
            const fingerprint = createHash('sha256')
              .update(JSON.stringify([kind, input.propertyId ?? '', input.buildingId ?? '', input.csv]))
              .digest('hex');
            const previous = await tx.importBatch.findUnique({
              where: { organizationId_fingerprint: { organizationId, fingerprint } },
            });
            if (previous)
              return { valid: true, count: previous.count, imported: 0, replayed: true, errors: [] };
            let records: string[][];
            try {
              records = parsePortfolioCsv(input.csv);
            } catch (error) {
              return {
                valid: false,
                count: 0,
                imported: 0,
                errors: [{ row: 0, field: 'csv', message: (error as Error).message }],
              };
            }
            // Units files may come in two shapes: the current template (id first)
            // or the legacy create-only one. The active column list decides how
            // each row maps to fields.
            const headerCsv = records[0]?.join(',') ?? '';
            let columns: readonly string[] = CSV_HEADERS[kind];
            if (kind === 'units' && headerCsv === CSV_HEADERS.units.slice(1).join(',')) {
              columns = CSV_HEADERS.units.slice(1);
            } else if (headerCsv !== columns.join(',')) {
              return {
                valid: false,
                count: 0,
                imported: 0,
                errors: [{ row: 1, field: 'header', message: `Expected: ${columns.join(',')}` }],
              };
            }
            const errors: ImportError[] = [];
            if (records.length < 2)
              errors.push({ row: 0, field: 'csv', message: 'At least one data row is required' });
            const seen = new Set<string>();
            const units: { row: number; data: z.infer<typeof csvUnitSchema> }[] = [];
            const tenants: { row: number; data: z.infer<typeof csvTenantSchema> }[] = [];
            for (const [i, cells] of records.slice(1).entries()) {
              const row = i + 2;
              if (cells.length !== columns.length) {
                errors.push({ row, field: 'csv', message: 'Wrong column count' });
                continue;
              }
              const raw = Object.fromEntries(
                columns.map((key, j) => [key, cells[j]?.trim() || undefined]),
              );
              const parsed = (kind === 'units' ? csvUnitSchema : csvTenantSchema).safeParse(raw);
              if (!parsed.success) {
                for (const issue of parsed.error.issues)
                  errors.push({ row, field: issue.path.join('.'), message: 'Invalid or missing value' });
                continue;
              }
              if (kind === 'units') {
                const data = csvUnitSchema.parse(raw);
                if (data.id) {
                  // Update path: the row targets an existing unit. It must exist
                  // in this organization, and its new label must stay unique
                  // within that unit's own property (the unique index is
                  // property-wide, including soft-deleted rows).
                  const target = await tx.unit.findFirst({
                    where: { id: data.id, organizationId, deletedAt: null },
                    select: { id: true, propertyId: true, label: true },
                  });
                  if (!target) {
                    errors.push({ row, field: 'id', message: 'Unit not found in this organization' });
                    continue;
                  }
                  if (seen.has(`label:${data.label}`)) {
                    errors.push({ row, field: 'label', message: 'Duplicate unit label' });
                    continue;
                  }
                  const clash = await tx.unit.findFirst({
                    where: {
                      organizationId,
                      propertyId: target.propertyId,
                      label: data.label,
                      id: { not: data.id },
                    },
                    select: { id: true },
                  });
                  if (clash) {
                    errors.push({ row, field: 'label', message: 'Duplicate unit label' });
                    continue;
                  }
                  seen.add(`label:${data.label}`);
                  units.push({ row, data });
                } else {
                  if (
                    seen.has(`label:${data.label}`) ||
                    (await tx.unit.findFirst({
                      where: { organizationId, propertyId: property!.id, label: data.label },
                      select: { id: true },
                    }))
                  )
                    errors.push({ row, field: 'label', message: 'Duplicate unit label' });
                  seen.add(`label:${data.label}`);
                  units.push({ row, data });
                }
              } else {
                const data = csvTenantSchema.parse(raw);
                const key = JSON.stringify([data.fullName.toLowerCase(), data.phone ?? '', data.email ?? '']);
                if (
                  seen.has(key) ||
                  (await tx.tenant.findFirst({
                    where: {
                      organizationId,
                      fullName: { equals: data.fullName, mode: 'insensitive' },
                      phone: data.phone ?? null,
                      email: data.email ?? null,
                    },
                    select: { id: true },
                  }))
                )
                  errors.push({
                    row,
                    field: 'fullName',
                    message: 'Duplicate name/contact combination; review existing tenant',
                  });
                seen.add(key);
                tenants.push({ row, data });
              }
            }
            const count = records.length - 1;
            if (errors.length || input.dryRun) return { valid: !errors.length, count, imported: 0, errors };
            for (const { data } of units) {
              const { marketRentMinor, id, ...rest } = data;
              if (id) {
                // Update: only the fields present in the file change; a blank
                // cell keeps the unit's current value.
                const unit = await tx.unit.update({
                  where: { id },
                  data: {
                    ...rest,
                    ...(marketRentMinor === undefined
                      ? {}
                      : { marketRentMinor: BigInt(marketRentMinor) }),
                  },
                });
                await recordAudit(tx, {
                  organizationId,
                  actorUserId: req.auth?.userId,
                  action: 'update',
                  entityType: 'Unit',
                  entityId: unit.id,
                  before: { label: unit.label },
                  after: { label: rest.label, source: 'csv' },
                  requestId: req.requestId,
                });
                continue;
              }
              const unit = await tx.unit.create({
                data: {
                  ...rest,
                  organizationId,
                  propertyId: property!.id,
                  buildingId: input.buildingId ?? null,
                  marketRentMinor: marketRentMinor === undefined ? null : BigInt(marketRentMinor),
                  currency: property!.organization.currency,
                  status: 'vacant',
                },
              });
              await recordAudit(tx, {
                organizationId,
                actorUserId: req.auth?.userId,
                action: 'create',
                entityType: 'Unit',
                entityId: unit.id,
                after: { source: 'csv' },
                requestId: req.requestId,
              });
            }
            for (const { data } of tenants) {
              const tenant = await tx.tenant.create({ data: { ...data, organizationId } });
              await recordAudit(tx, {
                organizationId,
                actorUserId: req.auth?.userId,
                action: 'create',
                entityType: 'Tenant',
                entityId: tenant.id,
                after: { source: 'csv' },
                requestId: req.requestId,
              });
            }
            await tx.importBatch.create({ data: { organizationId, fingerprint, kind, count } });
            return { valid: true, count, imported: count, errors: [] };
          },
          { timeout: 20000 },
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
}
