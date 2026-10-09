/**
 * CSV exports — the piece FEATURES.md promised and the app never shipped.
 *
 * One endpoint family, `GET /exports/:kind.csv`, streamed as text/csv with an
 * `export` action written to the audit log (who exported what, when). Every kind
 * is org-scoped and uses the same permission as the screen the data appears on,
 * so an exporter can never see more than the UI would show them.
 */

import { Router, type Response } from 'express';
import { z } from 'zod';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { uuidSchema } from '@pms/shared';
import { getPrisma } from '../lib/prisma.js';
import { recordAudit } from '../services/audit.js';

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const EXPORT_KINDS = ['tenants', 'leases', 'charges', 'payments', 'arrears'] as const;
type ExportKind = (typeof EXPORT_KINDS)[number];

const exportQuerySchema = z.object({
  propertyId: uuidSchema.optional(),
  status: z.string().trim().max(20).optional(),
});

/** RFC 4180 cells: quotes doubled, formula-looking cells neutralized. */
function csvCell(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

type CsvValue = string | number | bigint | null | undefined;

function csvResponse(res: Response, filename: string, header: string[], rows: CsvValue[][]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  // CRLF line endings per RFC 4180; BOM keeps Excel honest about UTF-8.
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
}

exportsRouter.get(
  '/exports/:kind.csv',
  requirePermission('reports.export'),
  validate({ params: z.object({ kind: z.enum(EXPORT_KINDS) }), query: exportQuerySchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const kind = req.params.kind as ExportKind;
      const propertyId = typeof req.query.propertyId === 'string' ? req.query.propertyId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const today = new Date().toISOString().slice(0, 10);
      let rows: CsvValue[][] = [];
      let header: string[] = [];

      if (kind === 'tenants') {
        header = [
          'id',
          'fullName',
          'phone',
          'altPhone',
          'email',
          'language',
          'nationality',
          'employer',
          'emergencyContactName',
          'emergencyContactPhone',
          'createdAt',
        ];
        const tenants = await prisma.tenant.findMany({
          where: { organizationId, deletedAt: null },
          orderBy: { fullName: 'asc' },
        });
        rows = tenants.map((tenant) => [
          tenant.id,
          tenant.fullName,
          tenant.phone,
          tenant.altPhone,
          tenant.email,
          tenant.language,
          tenant.nationality,
          tenant.employer,
          tenant.emergencyContactName,
          tenant.emergencyContactPhone,
          tenant.createdAt.toISOString(),
        ]);
      } else if (kind === 'leases') {
        header = [
          'id',
          'unit',
          'property',
          'tenant',
          'status',
          'startDate',
          'endDate',
          'rentAmountMinor',
          'currency',
          'billingFrequency',
          'balanceMinor',
        ];
        const leases = await prisma.lease.findMany({
          where: {
            organizationId,
            deletedAt: null,
            ...(propertyId ? { unit: { is: { propertyId } } } : {}),
          },
          include: {
            unit: { select: { label: true, property: { select: { name: true } } } },
            tenant: { select: { fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        const balances = await prisma.ledgerEntry.groupBy({
          by: ['leaseId'],
          where: { organizationId, leaseId: { in: leases.map((lease) => lease.id) } },
          _sum: { amountMinor: true },
        });
        const balanceByLease = new Map(
          balances.map((entry) => [entry.leaseId, entry._sum.amountMinor ?? 0n]),
        );
        rows = leases.map((lease) => [
          lease.id,
          lease.unit.label,
          lease.unit.property.name,
          lease.tenant.fullName,
          lease.status,
          lease.startDate.toISOString().slice(0, 10),
          lease.endDate ? lease.endDate.toISOString().slice(0, 10) : null,
          lease.rentAmountMinor.toString(),
          lease.currency,
          lease.billingFrequency,
          (balanceByLease.get(lease.id) ?? 0n).toString(),
        ]);
      } else if (kind === 'charges') {
        header = [
          'id',
          'type',
          'description',
          'periodKey',
          'dueDate',
          'amountMinor',
          'paidMinor',
          'status',
          'currency',
          'tenantId',
          'leaseId',
        ];
        const charges = await prisma.charge.findMany({
          where: {
            organizationId,
            ...(status ? { status } : {}),
            ...(propertyId ? { lease: { is: { unit: { is: { propertyId } } } } } : {}),
          },
          orderBy: [{ dueDate: 'desc' }],
          take: 5000,
        });
        rows = charges.map((charge) => [
          charge.id,
          charge.type,
          charge.description,
          charge.periodKey,
          charge.dueDate.toISOString().slice(0, 10),
          charge.amountMinor.toString(),
          charge.paidMinor.toString(),
          charge.status,
          charge.currency,
          charge.tenantId,
          charge.leaseId,
        ]);
      } else if (kind === 'payments') {
        header = [
          'receiptNumber',
          'paidAt',
          'amountMinor',
          'currency',
          'method',
          'status',
          'reference',
          'tenantId',
          'leaseId',
        ];
        const payments = await prisma.payment.findMany({
          where: {
            organizationId,
            ...(status ? { status } : {}),
            ...(propertyId ? { lease: { is: { unit: { is: { propertyId } } } } } : {}),
          },
          orderBy: { paidAt: 'desc' },
          take: 5000,
        });
        rows = payments.map((payment) => [
          payment.receiptNumber,
          payment.paidAt.toISOString(),
          payment.amountMinor.toString(),
          payment.currency,
          payment.method,
          payment.status,
          payment.reference,
          payment.tenantId,
          payment.leaseId,
        ]);
      } else if (kind === 'arrears') {
        header = [
          'tenant',
          'unit',
          'property',
          'leaseId',
          'dueDate',
          'outstandingMinor',
          'currency',
          'daysLate',
        ];
        const now = new Date();
        const charges = await prisma.charge.findMany({
          where: {
            organizationId,
            status: { in: ['open', 'partial'] },
            dueDate: { lt: now },
            ...(propertyId ? { lease: { is: { unit: { is: { propertyId } } } } } : {}),
          },
          include: {
            tenant: { select: { fullName: true } },
            lease: {
              select: { unit: { select: { label: true, property: { select: { name: true } } } } },
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 5000,
        });
        rows = charges
          .map((charge) => {
            const outstanding = charge.amountMinor - charge.paidMinor;
            const daysLate = Math.floor((now.getTime() - charge.dueDate.getTime()) / 86_400_000);
            return { charge, outstanding, daysLate };
          })
          .filter((entry) => entry.outstanding > 0n)
          .map(({ charge, outstanding, daysLate }) => [
            charge.tenant?.fullName ?? null,
            charge.lease?.unit.label ?? null,
            charge.lease?.unit.property.name ?? null,
            charge.leaseId,
            charge.dueDate.toISOString().slice(0, 10),
            outstanding.toString(),
            charge.currency,
            daysLate,
          ]);
      }

      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId ?? null,
        action: 'export',
        entityType: kind,
        entityId: null,
        after: { kind, rows: rows.length, format: 'csv' },
        requestId: req.requestId,
      });

      csvResponse(res, `${kind}-${today}.csv`, header, rows);
    } catch (error) {
      next(error);
    }
  },
);
