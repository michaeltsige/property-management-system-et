/**
 * Reporting.
 *
 * Every figure is computed from the ledger and the portfolio tables — no stored
 * totals, so a report can never drift from the transactions it summarises.
 * Period keys honour the lease's billing calendar (13 months for Ethiopian
 * leases), which is why `periodForDate` is used rather than `getMonth()`.
 */

import { Router } from 'express';
import { z } from 'zod';

import { reportQuerySchema, uuidSchema } from '@pms/shared';
import {
  civilToUtcDate,
  periodEnd,
  periodForDate,
  periodStart,
  utcDateToCivil,
  type BillingPeriod,
  type CalendarKind,
} from '@pms/calendar';

import { getPrisma } from '../lib/prisma.js';
import { str } from '../lib/query.js';
import { organizationIdOf } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';

export const reportsRouter = Router();

/** Arrears buckets, in days past due. */
const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due', from: -Infinity, to: 0 },
  { key: 'days_1_30', label: '1–30 days', from: 1, to: 30 },
  { key: 'days_31_60', label: '31–60 days', from: 31, to: 60 },
  { key: 'days_61_90', label: '61–90 days', from: 61, to: 90 },
  { key: 'days_90_plus', label: 'Over 90 days', from: 91, to: Infinity },
] as const;

async function resolveOrganizationScope(req: Parameters<typeof organizationIdOf>[0]) {
  const organizationId = organizationIdOf(req);
  const prisma = getPrisma();
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return { organizationId, prisma, organization };
}

function periodFromQuery(
  query: { periodKey?: string; calendar?: string },
  fallbackCalendar: CalendarKind,
): BillingPeriod {
  const calendar = (query.calendar as CalendarKind | undefined) ?? fallbackCalendar;
  if (query.periodKey) {
    const [year, month] = query.periodKey.split('-').map(Number);
    return { calendar, year: year!, month: month!, key: query.periodKey };
  }
  return periodForDate(utcDateToCivil(new Date(), calendar));
}

/**
 * Portfolio summary — the numbers on the dashboard.
 *
 * "Expected" is what the leases say should have been charged this period;
 * "collected" is what was actually received in it; "arrears" is everything unpaid
 * up to today, regardless of period.
 */
reportsRouter.get(
  '/reports/summary',
  requirePermission('reports.read'),
  validate({ query: reportQuerySchema.partial() }),
  async (req, res, next) => {
    try {
      const { organizationId, prisma, organization } = await resolveOrganizationScope(req);
      const calendar =
        (str(req.query.calendar) as CalendarKind | undefined) ?? (organization.calendar as CalendarKind);
      const period = periodFromQuery(
        { periodKey: str(req.query.periodKey), calendar: str(req.query.calendar) },
        calendar,
      );

      const periodFrom = civilToUtcDate(periodStart(period));
      const periodTo = civilToUtcDate(periodEnd(period));
      const now = new Date();

      const [
        units,
        occupied,
        properties,
        tenants,
        activeLeases,
        openWorkOrders,
        periodCharges,
        periodPayments,
        arrearsCharges,
      ] = await Promise.all([
        prisma.unit.count({ where: { organizationId, deletedAt: null } }),
        prisma.unit.count({ where: { organizationId, deletedAt: null, status: 'occupied' } }),
        prisma.property.count({ where: { organizationId, deletedAt: null } }),
        prisma.tenant.count({ where: { organizationId, deletedAt: null } }),
        prisma.lease.count({ where: { organizationId, deletedAt: null, status: 'active' } }),
        prisma.workOrder.count({
          where: { organizationId, status: { in: ['open', 'assigned', 'in_progress', 'on_hold'] } },
        }),
        prisma.charge.aggregate({
          where: {
            organizationId,
            periodCalendar: period.calendar,
            periodStart: { gte: periodFrom },
            periodEnd: { lte: periodTo },
            status: { in: ['open', 'partial', 'paid'] },
          },
          _sum: { amountMinor: true },
          _count: true,
        }),
        prisma.payment.aggregate({
          where: { organizationId, status: 'succeeded', paidAt: { gte: periodFrom, lte: periodTo } },
          _sum: { amountMinor: true },
          _count: true,
        }),
        prisma.charge.findMany({
          where: { organizationId, status: { in: ['open', 'partial'] }, dueDate: { lt: now } },
          select: { amountMinor: true, paidMinor: true },
        }),
      ]);

      const arrearsMinor = arrearsCharges.reduce(
        (sum, charge) => sum + (charge.amountMinor - charge.paidMinor),
        0n,
      );
      const expectedMinor = periodCharges._sum.amountMinor ?? 0n;
      const collectedMinor = periodPayments._sum.amountMinor ?? 0n;

      res.json({
        organization: {
          currency: organization.currency,
          calendar: organization.calendar,
          language: organization.language,
        },
        portfolio: {
          properties,
          units,
          occupiedUnits: occupied,
          vacantUnits: units - occupied,
          occupancyRate: units === 0 ? 0 : Number(((occupied / units) * 100).toFixed(2)),
          tenants,
          activeLeases,
          openWorkOrders,
        },
        period: {
          key: period.key,
          calendar: period.calendar,
          from: periodFrom,
          to: periodTo,
        },
        money: {
          currency: organization.currency,
          expectedMinor: expectedMinor.toString(),
          collectedMinor: collectedMinor.toString(),
          collectionRate:
            expectedMinor === 0n
              ? null
              : Number(((Number(collectedMinor) / Number(expectedMinor)) * 100).toFixed(2)),
          arrearsMinor: arrearsMinor.toString(),
          chargesRaised: periodCharges._count,
          paymentsRecorded: periodPayments._count,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Rent roll: one row per active lease with what is due for the period, what has
 * been paid against it and what is outstanding overall.
 */
reportsRouter.get(
  '/reports/rent-roll',
  requirePermission('reports.read'),
  validate({ query: reportQuerySchema.partial().extend({ propertyId: uuidSchema.optional() }) }),
  async (req, res, next) => {
    try {
      const { organizationId, prisma, organization } = await resolveOrganizationScope(req);
      const propertyId = str(req.query.propertyId);
      const calendar =
        (str(req.query.calendar) as CalendarKind | undefined) ?? (organization.calendar as CalendarKind);
      const period = periodFromQuery(
        { periodKey: str(req.query.periodKey), calendar: str(req.query.calendar) },
        calendar,
      );

      const leases = await prisma.lease.findMany({
        where: {
          organizationId,
          deletedAt: null,
          status: 'active',
          ...(propertyId ? { unit: { propertyId } } : {}),
        },
        include: {
          tenant: { select: { id: true, fullName: true, phone: true } },
          unit: {
            select: {
              id: true,
              label: true,
              property: { select: { id: true, name: true, regionCode: true } },
            },
          },
        },
        orderBy: [{ unit: { propertyId: 'asc' } }, { unit: { label: 'asc' } }],
      });

      const leaseIds = leases.map((lease) => lease.id);
      const charges = leaseIds.length
        ? await prisma.charge.findMany({
            where: { organizationId, leaseId: { in: leaseIds } },
            select: {
              leaseId: true,
              periodKey: true,
              periodCalendar: true,
              amountMinor: true,
              paidMinor: true,
              status: true,
              dueDate: true,
            },
          })
        : [];

      const rows = leases.map((lease) => {
        const leaseCharges = charges.filter((charge) => charge.leaseId === lease.id);
        const forPeriod = leaseCharges.filter(
          (charge) => charge.periodKey === period.key && charge.periodCalendar === period.calendar,
        );
        const periodDueMinor = forPeriod.reduce((sum, charge) => sum + charge.amountMinor, 0n);
        const periodPaidMinor = forPeriod.reduce((sum, charge) => sum + charge.paidMinor, 0n);
        const outstandingMinor = leaseCharges
          .filter((charge) => charge.status === 'open' || charge.status === 'partial')
          .reduce((sum, charge) => sum + (charge.amountMinor - charge.paidMinor), 0n);
        const creditMinor = leaseCharges
          .filter((charge) => charge.paidMinor > charge.amountMinor)
          .reduce((sum, charge) => sum + (charge.paidMinor - charge.amountMinor), 0n);

        return {
          leaseId: lease.id,
          property: lease.unit.property,
          unit: { id: lease.unit.id, label: lease.unit.label },
          tenant: lease.tenant,
          billingCalendar: lease.billingCalendar,
          rentAmountMinor: lease.rentAmountMinor.toString(),
          currency: lease.currency,
          dueDayOfMonth: lease.dueDayOfMonth,
          period: { key: period.key, calendar: period.calendar },
          periodDueMinor: periodDueMinor.toString(),
          periodPaidMinor: periodPaidMinor.toString(),
          outstandingMinor: outstandingMinor.toString(),
          creditMinor: creditMinor.toString(),
          periodCharged: forPeriod.length > 0,
        };
      });

      const totals = rows.reduce(
        (accumulator, row) => ({
          dueMinor: accumulator.dueMinor + BigInt(row.periodDueMinor),
          paidMinor: accumulator.paidMinor + BigInt(row.periodPaidMinor),
          outstandingMinor: accumulator.outstandingMinor + BigInt(row.outstandingMinor),
        }),
        { dueMinor: 0n, paidMinor: 0n, outstandingMinor: 0n },
      );

      res.json({
        period: {
          key: period.key,
          calendar: period.calendar,
          from: periodStart(period),
          to: periodEnd(period),
        },
        currency: organization.currency,
        rows: rows.map((row) => ({ ...row, property: row.property })),
        totals: {
          dueMinor: totals.dueMinor.toString(),
          paidMinor: totals.paidMinor.toString(),
          outstandingMinor: totals.outstandingMinor.toString(),
          leaseCount: rows.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Arrears aging: who owes what, bucketed by how late it is. */
reportsRouter.get(
  '/reports/arrears',
  requirePermission('reports.read'),
  validate({ query: reportQuerySchema.partial() }),
  async (req, res, next) => {
    try {
      const { organizationId, prisma, organization } = await resolveOrganizationScope(req);
      const propertyId = str(req.query.propertyId);
      const now = new Date();

      const charges = await prisma.charge.findMany({
        where: {
          organizationId,
          status: { in: ['open', 'partial'] },
          // `Charge` has no unit relation, so a property filter goes through the lease.
          ...(propertyId ? { lease: { is: { unit: { is: { propertyId } } } } } : {}),
        },
        include: {
          lease: { select: { id: true, billingCalendar: true, unitId: true } },
          tenant: { select: { id: true, fullName: true, phone: true } },
        },
      });

      // Units are looked up in one extra query rather than N per charge.
      const unitIds = [
        ...new Set(charges.map((charge) => charge.lease?.unitId).filter((id): id is string => Boolean(id))),
      ];
      const units = unitIds.length
        ? await prisma.unit.findMany({
            where: { organizationId, id: { in: unitIds } },
            select: { id: true, label: true, property: { select: { id: true, name: true } } },
          })
        : [];
      const unitById = new Map(units.map((unit) => [unit.id, unit]));

      const buckets: Record<string, bigint> = Object.fromEntries(
        AGING_BUCKETS.map((bucket) => [bucket.key, 0n]),
      );
      const byTenant = new Map<
        string,
        {
          tenant: { id: string; fullName: string; phone: string | null } | null;
          unit: { id: string; label: string } | null;
          property: { id: string; name: string } | null;
          leaseId: string;
          buckets: Record<string, bigint>;
          totalMinor: bigint;
          oldestDueDate: Date | null;
        }
      >();

      for (const charge of charges) {
        const outstanding = charge.amountMinor - charge.paidMinor;
        if (outstanding <= 0n) continue;

        const daysLate = Math.floor((now.getTime() - charge.dueDate.getTime()) / (24 * 60 * 60 * 1000));
        const bucket = AGING_BUCKETS.find(
          (candidate) => daysLate >= candidate.from && daysLate <= candidate.to,
        );
        if (!bucket) continue;

        buckets[bucket.key] = (buckets[bucket.key] ?? 0n) + outstanding;

        // Aging is reported per lease; a charge without a lease (only possible for
        // manually created ledger rows) has no tenancy to age against.
        if (!charge.leaseId) continue;
        const key = charge.leaseId;
        const unit = charge.lease?.unitId ? unitById.get(charge.lease.unitId) : undefined;
        const entry = byTenant.get(key) ?? {
          tenant: charge.tenant
            ? { id: charge.tenant.id, fullName: charge.tenant.fullName, phone: charge.tenant.phone }
            : null,
          unit: unit ? { id: unit.id, label: unit.label } : null,
          property: unit?.property ?? null,
          leaseId: charge.leaseId,
          buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0n])),
          totalMinor: 0n,
          oldestDueDate: null,
        };
        entry.buckets[bucket.key] = (entry.buckets[bucket.key] ?? 0n) + outstanding;
        entry.totalMinor += outstanding;
        if (!entry.oldestDueDate || charge.dueDate < entry.oldestDueDate)
          entry.oldestDueDate = charge.dueDate;
        byTenant.set(key, entry);
      }

      const rows = [...byTenant.values()]
        .sort((a, b) => (b.totalMinor > a.totalMinor ? 1 : b.totalMinor < a.totalMinor ? -1 : 0))
        .map((entry) => ({
          ...entry,
          buckets: Object.fromEntries(
            Object.entries(entry.buckets).map(([key, value]) => [key, value.toString()]),
          ),
          totalMinor: entry.totalMinor.toString(),
        }));

      res.json({
        asOf: now,
        currency: organization.currency,
        buckets: AGING_BUCKETS.map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          totalMinor: (buckets[bucket.key] ?? 0n).toString(),
        })),
        rows,
        totalMinor: rows.reduce((sum, row) => sum + BigInt(row.totalMinor), 0n).toString(),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Occupancy by property. */
reportsRouter.get('/reports/occupancy', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const { organizationId, prisma } = await resolveOrganizationScope(req);

    const properties = await prisma.property.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        units: { where: { deletedAt: null }, select: { id: true, status: true } },
      },
      orderBy: { name: 'asc' },
    });

    const rows = properties.map((property) => {
      const total = property.units.length;
      const byStatus: Record<string, number> = {};
      for (const unit of property.units) byStatus[unit.status] = (byStatus[unit.status] ?? 0) + 1;
      const occupied = (byStatus.occupied ?? 0) + (byStatus.notice ?? 0);
      return {
        propertyId: property.id,
        name: property.name,
        regionCode: property.regionCode,
        totalUnits: total,
        occupiedUnits: occupied,
        vacantUnits: byStatus.vacant ?? 0,
        occupancyRate: total === 0 ? 0 : Number(((occupied / total) * 100).toFixed(2)),
        byStatus,
      };
    });

    const totalUnits = rows.reduce((sum, row) => sum + row.totalUnits, 0);
    const occupiedUnits = rows.reduce((sum, row) => sum + row.occupiedUnits, 0);

    res.json({
      rows,
      totals: {
        totalUnits,
        occupiedUnits,
        vacantUnits: totalUnits - occupiedUnits,
        occupancyRate: totalUnits === 0 ? 0 : Number(((occupiedUnits / totalUnits) * 100).toFixed(2)),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Collections by month, in the calendar the caller asks for.
 *
 * The Ethiopian year has 13 months, so the series length differs between the two
 * calendars; the client renders whichever it receives.
 */
reportsRouter.get(
  '/reports/collections',
  requirePermission('reports.read'),
  validate({
    query: z.object({
      calendar: z.enum(['ethiopian', 'gregorian']).optional(),
      months: z.coerce.number().int().min(1).max(36).default(13),
      propertyId: uuidSchema.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { organizationId, prisma, organization } = await resolveOrganizationScope(req);
      const calendar =
        (str(req.query.calendar) as CalendarKind | undefined) ?? (organization.calendar as CalendarKind);
      const months = Number(req.query.months ?? 13);
      const propertyId = str(req.query.propertyId);

      const payments = await prisma.payment.findMany({
        where: {
          organizationId,
          status: 'succeeded',
          ...(propertyId ? { lease: { is: { unit: { is: { propertyId } } } } } : {}),
        },
        select: { paidAt: true, amountMinor: true, method: true },
      });

      const series = new Map<
        string,
        { period: BillingPeriod; totalMinor: bigint; count: number; byMethod: Record<string, bigint> }
      >();
      const current = periodForDate(utcDateToCivil(new Date(), calendar));

      // Seed the range so months with no payments still appear as zero. The
      // Ethiopian year has 13 months, so the arithmetic must not assume 12.
      const monthsPerYear = calendar === 'ethiopian' ? 13 : 12;
      for (let index = months - 1; index >= 0; index -= 1) {
        const monthIndex = current.month - 1 - index;
        const year = current.year + Math.floor(monthIndex / monthsPerYear);
        const month = (((monthIndex % monthsPerYear) + monthsPerYear) % monthsPerYear) + 1;
        const period: BillingPeriod = {
          calendar,
          year,
          month,
          key: `${year}-${String(month).padStart(2, '0')}`,
        };
        series.set(period.key, { period, totalMinor: 0n, count: 0, byMethod: {} });
      }

      for (const payment of payments) {
        const period = periodForDate(utcDateToCivil(payment.paidAt, calendar));
        const entry = series.get(period.key);
        if (!entry) continue;
        entry.totalMinor += payment.amountMinor;
        entry.count += 1;
        entry.byMethod[payment.method] = (entry.byMethod[payment.method] ?? 0n) + payment.amountMinor;
      }

      res.json({
        calendar,
        currency: organization.currency,
        rows: [...series.values()].map((entry) => ({
          periodKey: entry.period.key,
          year: entry.period.year,
          month: entry.period.month,
          from: periodStart(entry.period),
          to: periodEnd(entry.period),
          totalMinor: entry.totalMinor.toString(),
          paymentCount: entry.count,
          byMethod: Object.fromEntries(
            Object.entries(entry.byMethod).map(([method, total]) => [method, total.toString()]),
          ),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
