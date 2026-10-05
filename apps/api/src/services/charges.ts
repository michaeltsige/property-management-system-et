/**
 * Charge generation — the piece that must never double-charge a tenant.
 *
 * Idempotency
 * -----------
 * `Charge` has `@@unique([leaseId, periodKey, type])`. Generation inserts and
 * catches the unique violation, so running the job twice (or a manager pressing
 * the button twice, or two workers racing) creates exactly one charge per lease,
 * period and charge type. Tests assert this by running generation twice.
 *
 * Calendar
 * --------
 * Periods and due dates are computed in the **lease's** `billingCalendar` via
 * `@pms/calendar`. For Ethiopian leases this means 12 months of 30 days plus
 * Pagume (5 or 6 days); a due day of 30 in Pagume becomes Pagume 5 or 6 rather
 * than an impossible date.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import {
  civilToUtcDate,
  clampDayOfMonth,
  compareCivil,
  daysInMonth,
  periodForDate,
  periodStart,
  utcDateToCivil,
  type BillingPeriod,
  type CalendarKind,
  type CivilDate,
} from '@pms/calendar';
import { money, prorateMoney, type BillingFrequency } from '@pms/shared';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import { postLedgerEntry } from './ledger.js';
import { recordAudit } from './audit.js';

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

const MONTHS_PER_CHARGE: Record<Exclude<BillingFrequency, 'custom'>, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

export interface LeaseForCharging {
  id: string;
  organizationId: string;
  billingCalendar: string;
  billingFrequency: string;
  rentAmountMinor: bigint;
  currency: string;
  dueDayOfMonth: number;
  startDate: Date;
  endDate: Date | null;
  status: string;
}

export interface ChargeGenerationResult {
  created: number;
  skippedExisting: number;
  skippedOutOfRange: number;
  charges: { leaseId: string; periodKey: string; amountMinor: bigint; dueDate: Date }[];
}

function calendarOf(lease: LeaseForCharging): CalendarKind {
  return lease.billingCalendar === 'gregorian' ? 'gregorian' : 'ethiopian';
}

/** Months between two periods, in the lease's calendar (13-month years for Ethiopian). */
function monthsBetweenPeriods(from: BillingPeriod, to: BillingPeriod): number {
  const monthsPerYear = from.calendar === 'ethiopian' ? 13 : 12;
  return (to.year - from.year) * monthsPerYear + (to.month - from.month);
}

/** True when the lease's billing frequency charges for this period. */
export function isChargingPeriod(
  lease: Pick<LeaseForCharging, 'billingCalendar' | 'billingFrequency' | 'startDate'>,
  period: BillingPeriod,
): boolean {
  if (lease.billingFrequency === 'custom') return true;
  const interval =
    MONTHS_PER_CHARGE[(lease.billingFrequency as Exclude<BillingFrequency, 'custom'>) ?? 'monthly'] ?? 1;
  if (interval === 1) return true;
  const calendar = calendarOf(lease as LeaseForCharging);
  const startPeriod = periodForDate(utcDateToCivil(lease.startDate, calendar));
  const offset = monthsBetweenPeriods(startPeriod, period);
  return offset >= 0 && offset % interval === 0;
}

/**
 * Amount to charge for a period.
 *
 * A lease that starts part-way through a period is charged pro-rata for its first
 * period (whole months are charged in full), rounded once with `half-up`.
 */
export function amountForPeriod(
  lease: Pick<
    LeaseForCharging,
    'billingCalendar' | 'billingFrequency' | 'rentAmountMinor' | 'currency' | 'startDate'
  >,
  period: BillingPeriod,
): bigint {
  const calendar = calendarOf(lease as LeaseForCharging);
  const months =
    lease.billingFrequency === 'custom'
      ? 1
      : (MONTHS_PER_CHARGE[lease.billingFrequency as Exclude<BillingFrequency, 'custom'>] ?? 1);
  const full = lease.rentAmountMinor * BigInt(months);

  const startCivil = utcDateToCivil(lease.startDate, calendar);
  const periodFirst: CivilDate = periodStart(period);
  if (compareCivil(startCivil, periodFirst) <= 0) return full;

  // First (partial) period: charge for the days actually covered.
  const totalDays = daysInMonth(periodFirst);
  const lastDay: CivilDate = { ...periodFirst, day: totalDays };
  if (compareCivil(startCivil, lastDay) > 0) return 0n; // starts after this period ends
  const coveredDays = totalDays - startCivil.day + 1;
  const fraction = coveredDays / totalDays;
  const prorated = prorateMoney(money(Number(full), lease.currency), fraction);
  return BigInt(prorated.amountMinor);
}

function toUtcDate(civil: CivilDate): Date {
  return civilToUtcDate(civil);
}

export interface GenerateChargeOptions {
  organizationId: string;
  periodKeys: string[];
  leaseIds?: string[];
  skipNotYetStarted?: boolean;
  actorUserId?: string | null;
  /** Injectable clock so tests can pin "now" for audit rows. */
  now?: Date;
}

export async function generateCharges(
  prisma: PrismaClient,
  options: GenerateChargeOptions,
): Promise<ChargeGenerationResult> {
  const leases = await prisma.lease.findMany({
    where: {
      organizationId: options.organizationId,
      deletedAt: null,
      ...(options.leaseIds ? { id: { in: options.leaseIds } } : { status: 'active' }),
    },
  });

  const result: ChargeGenerationResult = {
    created: 0,
    skippedExisting: 0,
    skippedOutOfRange: 0,
    charges: [],
  };

  for (const lease of leases) {
    const calendar = calendarOf(lease as LeaseForCharging);
    const leaseStart = utcDateToCivil(lease.startDate, calendar);
    const leaseEnd = lease.endDate ? utcDateToCivil(lease.endDate, calendar) : null;

    for (const periodKey of options.periodKeys) {
      const period: BillingPeriod = { calendar, ...parsePeriodKeyFor(periodKey, calendar) };

      const periodFirst = periodStart(period);
      const periodLast: CivilDate = { ...periodFirst, day: daysInMonth(periodFirst) };

      // Out of the lease's term?
      if (leaseEnd && compareCivil(periodFirst, leaseEnd) > 0) {
        result.skippedOutOfRange += 1;
        continue;
      }
      if (options.skipNotYetStarted !== false && compareCivil(leaseStart, periodLast) > 0) {
        result.skippedOutOfRange += 1;
        continue;
      }

      if (!isChargingPeriod(lease as LeaseForCharging, period)) continue;

      const amountMinor = amountForPeriod(lease as LeaseForCharging, period);
      if (amountMinor === 0n) continue;

      const dueCivil = clampDayOfMonth(period, lease.dueDayOfMonth);

      try {
        await prisma.$transaction(async (tx) => {
          const charge = await tx.charge.create({
            data: {
              organizationId: lease.organizationId,
              leaseId: lease.id,
              tenantId: lease.tenantId,
              unitId: lease.unitId,
              type: 'rent',
              description: `Rent for ${periodLabelFor(period)}`,
              periodKey: period.key,
              periodCalendar: period.calendar,
              periodStart: toUtcDate(periodFirst),
              periodEnd: toUtcDate(periodLast),
              dueDate: toUtcDate(dueCivil),
              amountMinor,
              currency: lease.currency,
              status: 'open',
              createdById: options.actorUserId ?? null,
            },
          });

          await postLedgerEntry(tx, {
            organizationId: lease.organizationId,
            leaseId: lease.id,
            chargeId: charge.id,
            kind: 'charge',
            amountMinor,
            currency: lease.currency,
            occurredAt: toUtcDate(periodFirst),
            memo: `Rent ${period.key} (${period.calendar})`,
            createdById: options.actorUserId ?? null,
          });

          await recordAudit(tx, {
            organizationId: lease.organizationId,
            actorUserId: options.actorUserId ?? null,
            action: 'generate',
            entityType: 'Charge',
            entityId: charge.id,
            after: {
              leaseId: lease.id,
              periodKey: period.key,
              amountMinor: amountMinor.toString(),
              dueDate: dueCivil,
            },
          });
        });

        result.created += 1;
        result.charges.push({
          leaseId: lease.id,
          periodKey: period.key,
          amountMinor,
          dueDate: toUtcDate(dueCivil),
        });
      } catch (error) {
        // Unique constraint on (leaseId, periodKey, type): the charge already exists.
        if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
          result.skippedExisting += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return result;
}

function parsePeriodKeyFor(
  periodKey: string,
  calendar: CalendarKind,
): { year: number; month: number; key: string } {
  const match = /^(\d{4,6})-(\d{2})$/.exec(periodKey.trim());
  if (!match) throw businessRule(`Invalid period key: "${periodKey}" (expected e.g. "2019-01")`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const maxMonth = calendar === 'ethiopian' ? 13 : 12;
  if (month < 1 || month > maxMonth) {
    throw businessRule(`Month ${month} is out of range for the ${calendar} calendar (1-${maxMonth})`);
  }
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function periodLabelFor(period: BillingPeriod): string {
  return `${period.key} (${period.calendar === 'ethiopian' ? 'E.C.' : 'G.C.'})`;
}

/**
 * Deposit charge, created once when a lease becomes active.
 *
 * The deposit is tracked as a charge so that it shows up in the ledger and can be
 * refunded through a reversing entry, instead of living outside the books.
 */
export async function createDepositCharge(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    leaseId: string;
    amountMinor: bigint;
    currency: string;
    actorUserId?: string | null;
    dueDate: Date;
  },
) {
  if (params.amountMinor <= 0n) throw businessRule('Deposit amount must be greater than zero');

  return prisma.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: params.leaseId, organizationId: params.organizationId, deletedAt: null },
    });
    // A lease from another organization must look like a missing lease (404),
    // never a 403 — see the note in `lib/errors.ts`.
    if (!lease) throw notFound('Lease not found in this organization');

    const calendar: CalendarKind = lease.billingCalendar === 'gregorian' ? 'gregorian' : 'ethiopian';
    const startCivil = utcDateToCivil(lease.startDate, calendar);

    const charge = await tx.charge.create({
      data: {
        organizationId: params.organizationId,
        leaseId: lease.id,
        tenantId: lease.tenantId,
        unitId: lease.unitId,
        type: 'deposit',
        description: 'Security deposit',
        periodKey: `${startCivil.year}-${String(startCivil.month).padStart(2, '0')}`,
        periodCalendar: calendar,
        periodStart: params.dueDate,
        periodEnd: params.dueDate,
        dueDate: params.dueDate,
        amountMinor: params.amountMinor,
        currency: params.currency,
        status: 'open',
        createdById: params.actorUserId ?? null,
      },
    });

    await postLedgerEntry(tx, {
      organizationId: params.organizationId,
      leaseId: lease.id,
      chargeId: charge.id,
      kind: 'charge',
      amountMinor: params.amountMinor,
      currency: params.currency,
      occurredAt: params.dueDate,
      memo: 'Security deposit',
      createdById: params.actorUserId ?? null,
    });

    await recordAudit(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'create',
      entityType: 'Charge',
      entityId: charge.id,
      after: { type: 'deposit', amountMinor: params.amountMinor.toString() },
    });

    return charge;
  });
}

/**
 * Waive a charge: the money is no longer owed, and the ledger says so.
 *
 * Implemented as a negative `waiver` entry rather than by editing the charge, so
 * the original charge remains visible in the history.
 */
export async function waiveCharge(
  prisma: PrismaClient,
  params: { organizationId: string; chargeId: string; reason: string; actorUserId?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const charge = await tx.charge.findFirst({
      where: { id: params.chargeId, organizationId: params.organizationId },
    });
    if (!charge) throw notFound('Charge not found in this organization');
    if (charge.status === 'paid')
      throw conflict('A paid charge cannot be waived; reverse the payment instead');

    const outstanding = charge.amountMinor - charge.paidMinor;
    if (outstanding <= 0n) throw conflict('Nothing left to waive on this charge');

    const entry = await postLedgerEntry(tx, {
      organizationId: params.organizationId,
      leaseId: charge.leaseId,
      chargeId: charge.id,
      kind: 'waiver',
      amountMinor: -outstanding,
      currency: charge.currency,
      occurredAt: new Date(),
      memo: `Waiver: ${params.reason}`,
      createdById: params.actorUserId ?? null,
    });

    const updated = await tx.charge.update({
      where: { id: charge.id },
      data: {
        status: outstanding === charge.amountMinor ? 'waived' : 'partial',
        waiverReason: params.reason,
      },
    });

    await recordAudit(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'update',
      entityType: 'Charge',
      entityId: charge.id,
      before: { status: charge.status, paidMinor: charge.paidMinor.toString() },
      after: { status: updated.status, waiverReason: params.reason, ledgerEntryId: entry.id },
    });

    return updated;
  });
}

/** Ethiopian month label for a period, e.g. `Pagume 2015 E.C.`. */
export function periodDisplay(period: BillingPeriod): string {
  const era = period.calendar === 'ethiopian' ? 'E.C.' : 'G.C.';
  return `${period.key} (${era})`;
}
