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
  periodEnd,
  periodForDate,
  periodInOtherCalendar,
  periodStart,
  shiftPeriod,
  utcDateToCivil,
  type BillingPeriod,
  type CalendarKind,
  type CivilDate,
} from '@pms/calendar';
import { money, prorateMoney, type BillingFrequency } from '@pms/shared';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import { postLedgerEntry } from './ledger.js';
import { applyLeaseCreditInTx } from './payments.js';
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
  gracePeriodDays: number;
  lateFeePercent: number | null;
  lateFeeFixedMinor: bigint | null;
  escalationPercent: number | null;
  escalationEveryMonths: number | null;
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
 * Rent for a period after the lease's agreed escalations.
 *
 * The escalation fields (`escalationPercent`, `escalationEveryMonths`) existed on
 * the lease but were never applied — rent stayed flat forever. Escalation steps
 * are counted in the lease's own billing calendar from the start date and the
 * increase compounds once per step, rounded per step so minor units never drift.
 */
export function escalatedRent(
  lease: Pick<
    LeaseForCharging,
    'billingCalendar' | 'startDate' | 'rentAmountMinor' | 'escalationPercent' | 'escalationEveryMonths'
  >,
  period: BillingPeriod,
): bigint {
  const percent = lease.escalationPercent ?? null;
  const every = lease.escalationEveryMonths ?? null;
  if (!percent || percent <= 0 || !every || every <= 0) return lease.rentAmountMinor;

  const calendar = calendarOf(lease as LeaseForCharging);
  const startPeriod = periodForDate(utcDateToCivil(lease.startDate, calendar));
  const monthsIn = monthsBetweenPeriods(startPeriod, period);
  const steps = Math.floor(monthsIn / every);
  if (monthsIn <= 0 || steps <= 0) return lease.rentAmountMinor;

  const factorBps = BigInt(Math.round((1 + percent / 100) * 10_000));
  let rent = lease.rentAmountMinor;
  for (let step = 0; step < steps; step += 1) {
    rent = (rent * factorBps) / 10_000n;
  }
  return rent;
}

/**
 * Amount to charge for a period.
 *
 * A lease that starts part-way through a period — or ends part-way through one —
 * is charged pro-rata for the days it actually covers; whole months covered end
 * to end are charged in full. Rounded once with `half-up`.
 */
export function amountForPeriod(
  lease: Pick<
    LeaseForCharging,
    | 'billingCalendar'
    | 'billingFrequency'
    | 'rentAmountMinor'
    | 'currency'
    | 'startDate'
    | 'endDate'
    | 'escalationPercent'
    | 'escalationEveryMonths'
  >,
  period: BillingPeriod,
): bigint {
  const calendar = calendarOf(lease as LeaseForCharging);
  const months =
    lease.billingFrequency === 'custom'
      ? 1
      : (MONTHS_PER_CHARGE[lease.billingFrequency as Exclude<BillingFrequency, 'custom'>] ?? 1);
  const full = escalatedRent(lease, period) * BigInt(months);

  const dayMs = 86_400_000;
  const periodFirst: CivilDate = periodStart(period);
  // A quarterly/annual charge spans several months; prorate against the whole
  // span, not just the first month of it.
  const periodLast: CivilDate = periodEnd(shiftPeriod(period, months - 1));
  const totalDays =
    Math.round((civilToUtcDate(periodLast).getTime() - civilToUtcDate(periodFirst).getTime()) / dayMs) + 1;

  // The billable window is the part of the period inside [startDate, endDate].
  const startCivil = utcDateToCivil(lease.startDate, calendar);
  const fromCivil = compareCivil(startCivil, periodFirst) > 0 ? startCivil : periodFirst;
  let toCivil = periodLast;
  if (lease.endDate) {
    const endCivil = utcDateToCivil(lease.endDate, calendar);
    if (compareCivil(endCivil, toCivil) < 0) toCivil = endCivil;
  }
  if (compareCivil(fromCivil, toCivil) > 0) return 0n; // lease does not cover this period
  if (compareCivil(fromCivil, periodFirst) <= 0 && compareCivil(toCivil, periodLast) >= 0) return full;

  const coveredDays =
    Math.round((civilToUtcDate(toCivil).getTime() - civilToUtcDate(fromCivil).getTime()) / dayMs) + 1;
  const prorated = prorateMoney(money(Number(full), lease.currency), coveredDays / totalDays);
  return BigInt(prorated.amountMinor);
}

function toUtcDate(civil: CivilDate): Date {
  return civilToUtcDate(civil);
}

export interface GenerateChargeOptions {
  organizationId: string;
  periodKeys: string[];
  /** The calendar the period keys are expressed in. When given and different
   *  from a lease's billing calendar, each key is translated into that lease's
   *  calendar so the same wall-clock month is billed for every lease. */
  sourceCalendar?: CalendarKind;
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
      let period: BillingPeriod = { calendar, ...parsePeriodKeyFor(periodKey, calendar) };
      if (options.sourceCalendar && options.sourceCalendar !== calendar) {
        // The caller looks at the month in another calendar (the display one);
        // aim for the lease calendar period covering the same wall-clock days.
        const requested: BillingPeriod = {
          calendar: options.sourceCalendar,
          ...parsePeriodKeyFor(periodKey, options.sourceCalendar),
        };
        period = periodInOtherCalendar(requested);
      }

      const months =
        lease.billingFrequency === 'custom'
          ? 1
          : (MONTHS_PER_CHARGE[lease.billingFrequency as Exclude<BillingFrequency, 'custom'>] ?? 1);
      const periodFirst = periodStart(period);
      const periodLast = periodEnd(shiftPeriod(period, months - 1));

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

          // Keep the escalation tracker current: the next date rent is due to
          // rise, in the lease's own calendar. Read by dashboards via the
          // (organizationId, billingCalendar, nextEscalationDate) index.
          if ((lease.escalationPercent ?? 0) > 0 && (lease.escalationEveryMonths ?? 0) > 0) {
            const startPeriod = periodForDate(utcDateToCivil(lease.startDate, calendar));
            const monthsIn = monthsBetweenPeriods(startPeriod, period);
            const every = lease.escalationEveryMonths ?? 0;
            if (monthsIn >= 0 && every > 0) {
              const nextStep = (Math.floor(monthsIn / every) + 1) * every;
              const nextPeriodStart = periodStart(shiftPeriod(startPeriod, nextStep));
              await tx.lease.update({
                where: { id: lease.id },
                data: { nextEscalationDate: toUtcDate(nextPeriodStart) },
              });
            }
          }

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

  // New charges are settled immediately from stranded credit: a tenant with an
  // overpayment must not sit in arrears on rent their credit already covers.
  const touchedLeases = [...new Set(result.charges.map((charge) => charge.leaseId))];
  for (const leaseId of touchedLeases) {
    try {
      await prisma.$transaction(async (tx) => {
        await applyLeaseCreditInTx(tx, {
          organizationId: options.organizationId,
          leaseId,
          actorUserId: options.actorUserId ?? null,
          now: options.now ?? new Date(),
        });
      });
    } catch {
      // Credit application is best-effort here; the next payment or a retry
      // applies it. Never fail charge generation because of it.
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
export interface DepositChargeParams {
  organizationId: string;
  leaseId: string;
  amountMinor: bigint;
  currency: string;
  actorUserId?: string | null;
  dueDate: Date;
}

/**
 * Deposit charge creation inside a caller-owned transaction. Refuses to create a
 * second live deposit charge for the same lease, so lease activation and the
 * manual endpoint share one idempotent path.
 */
export async function createDepositChargeInTx(tx: PrismaLike, params: DepositChargeParams) {
  const lease = await tx.lease.findFirst({
    where: { id: params.leaseId, organizationId: params.organizationId, deletedAt: null },
  });
  // A lease from another organization must look like a missing lease (404),
  // never a 403 — see the note in `lib/errors.ts`.
  if (!lease) throw notFound('Lease not found in this organization');

  const existing = await tx.charge.findFirst({
    where: {
      leaseId: lease.id,
      type: 'deposit',
      status: { in: ['open', 'partial', 'paid'] },
    },
    select: { id: true },
  });
  if (existing) throw conflict('This lease already has a deposit charge');

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
}

export async function createDepositCharge(prisma: PrismaClient, params: DepositChargeParams) {
  if (params.amountMinor <= 0n) throw businessRule('Deposit amount must be greater than zero');
  return prisma.$transaction((tx) => createDepositChargeInTx(tx, params));
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
        // The remainder is forgiven either way; keeping a partially paid charge
        // as 'partial' would leave it collectible and it would keep appearing in
        // overdue reminders, payment allocation and arrears reports.
        status: 'waived',
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

export interface LateFeeSettings {
  lateFeeEnabled: boolean;
  lateFeeType: 'percent' | 'fixed';
  lateFeePercent: number;
  lateFeeFixedMinor: number | bigint;
  gracePeriodDays: number;
}

/**
 * Apply configured late fees, exactly once per overdue rent charge.
 *
 * A charge becomes eligible once its due date plus the lease's grace period (or
 * the organization default) is in the past. The fee is billed as its own
 * `late_fee` charge so it shows up in the ledger, can be paid like rent, and can
 * be waived on its own. `lateFeeAppliedAt` on the rent charge is the applied-once
 * marker; the (leaseId, periodKey, type) unique index is the second safety net.
 */
export async function applyLateFees(
  prisma: PrismaClient,
  organizationId: string,
  settings: LateFeeSettings,
  now: Date = new Date(),
): Promise<{ applied: number }> {
  if (!settings.lateFeeEnabled) return { applied: 0 };
  const dayMs = 86_400_000;

  const overdue = await prisma.charge.findMany({
    where: {
      organizationId,
      type: 'rent',
      status: { in: ['open', 'partial'] },
      lateFeeAppliedAt: null,
      dueDate: { lt: now },
    },
    include: { lease: true },
    take: 500,
  });

  let applied = 0;
  for (const charge of overdue) {
    const graceDays = charge.lease?.gracePeriodDays ?? settings.gracePeriodDays ?? 0;
    if (now.getTime() < charge.dueDate.getTime() + graceDays * dayMs) continue;

    const outstanding = charge.amountMinor - charge.paidMinor;
    if (outstanding <= 0n) {
      await prisma.charge.update({ where: { id: charge.id }, data: { lateFeeAppliedAt: now } });
      continue;
    }

    // Lease-level rule wins; organization defaults are the fallback.
    const percent = charge.lease?.lateFeePercent ?? null;
    const fixed = charge.lease?.lateFeeFixedMinor ?? null;
    let feeMinor = 0n;
    if (percent !== null && percent > 0) {
      feeMinor = (outstanding * BigInt(Math.round(percent * 100))) / 10_000n;
    } else if (fixed !== null && fixed > 0n) {
      feeMinor = fixed;
    } else if (settings.lateFeeType === 'fixed' && BigInt(settings.lateFeeFixedMinor) > 0n) {
      feeMinor = BigInt(settings.lateFeeFixedMinor);
    } else if (settings.lateFeePercent > 0) {
      feeMinor = (outstanding * BigInt(Math.round(settings.lateFeePercent * 100))) / 10_000n;
    }
    if (feeMinor <= 0n) {
      await prisma.charge.update({ where: { id: charge.id }, data: { lateFeeAppliedAt: now } });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const fee = await tx.charge.create({
          data: {
            organizationId,
            leaseId: charge.leaseId,
            tenantId: charge.tenantId,
            unitId: charge.unitId,
            type: 'late_fee',
            description: `Late fee for ${charge.description ?? charge.periodKey ?? 'rent'}`,
            periodKey: charge.periodKey,
            periodCalendar: charge.periodCalendar,
            periodStart: charge.periodStart,
            periodEnd: charge.periodEnd,
            dueDate: now,
            amountMinor: feeMinor,
            currency: charge.currency,
            status: 'open',
          },
        });
        await postLedgerEntry(tx, {
          organizationId,
          leaseId: charge.leaseId,
          chargeId: fee.id,
          kind: 'charge',
          amountMinor: feeMinor,
          currency: charge.currency,
          occurredAt: now,
          memo: `Late fee for period ${charge.periodKey ?? 'n/a'}`,
        });
        await tx.charge.update({ where: { id: charge.id }, data: { lateFeeAppliedAt: now } });
        await recordAudit(tx, {
          organizationId,
          actorUserId: null,
          action: 'update',
          entityType: 'Charge',
          entityId: charge.id,
          after: { lateFeeMinor: feeMinor.toString(), lateFeeChargeId: fee.id },
        });
      });
      applied += 1;
    } catch (error) {
      // The unique index says this period already carries a late fee for the
      // lease; keep the marker so we do not retry forever.
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        await prisma.charge.update({ where: { id: charge.id }, data: { lateFeeAppliedAt: now } });
        continue;
      }
      throw error;
    }
  }

  return { applied };
}

/** Ethiopian month label for a period, e.g. `Pagume 2015 E.C.`. */
export function periodDisplay(period: BillingPeriod): string {
  const era = period.calendar === 'ethiopian' ? 'E.C.' : 'G.C.';
  return `${period.key} (${era})`;
}
