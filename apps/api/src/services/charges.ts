/**
 * Charge generation — the piece that must never double-charge a tenant.
 *
 * Billing model: anniversary cycles on the lease's own due date
 * -----------------------------------------------------------
 * Rent is billed in whole-month cycles that start on the lease's start date and
 * repeat on that same day-of-month — the tenant's **due date** — not on calendar
 * months. A lease starting October 22 is billed Oct 22 → Nov 21, then
 * Nov 22 → Dec 21, each for one full month's rent. There is no entry proration:
 * a months-of-rent deposit therefore covers exactly that many cycles and ends at
 * a zero balance, instead of stranding leftover credit on the lease. Only the
 * final cycle of a lease (truncated by `endDate`) is prorated.
 *
 * Pagume is never billed
 * ----------------------
 * Ethiopian-calendar leases bill 12 cycles per year; Pagume (the 13th month,
 * 5–6 days) never hosts a cycle start and never generates a charge. Collecting a
 * full month's rent for 5–6 days is not a thing landlords do here, so those days
 * ride free at the tail of the Nehasse cycle (which spans Nehasse 1 → Pagume 5/6
 * for one month's rent). No charge row is ever stored with a Pagume period key.
 *
 * Idempotency
 * -----------
 * `Charge` has `@@unique([leaseId, periodKey, type])`. A cycle's periodKey is the
 * calendar month its start falls in; cycle starts are strictly increasing
 * calendar months, so the key is unique per cycle. Generation inserts and catches
 * the unique violation, so running the job twice (or a manager pressing the
 * button twice, or two workers racing) creates exactly one charge per lease and
 * cycle. Tests assert this by running generation twice.
 *
 * Calendar
 * --------
 * Cycle boundaries and due dates are computed in the **lease's** `billingCalendar`
 * via `@pms/calendar`. Gregorian anchors on day 29–31 clamp to the short month's
 * real length (Jan 31 → Feb 28 → Mar 31) without losing the anchor day.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import {
  addDays,
  civilToUtcDate,
  compareCivil,
  daysInMonth,
  differenceInDays,
  periodInOtherCalendar,
  utcDateToCivil,
  type BillingPeriod,
  type CalendarKind,
  type CivilDate,
} from '@pms/calendar';
import { money, prorateMoney, type BillingFrequency } from '@pms/shared';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import { postLedgerEntry } from './ledger.js';
import { applyLeaseCreditInTx, recordPaymentInTx } from './payments.js';
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

// ---------------------------------------------------------------------------
// Anniversary cycles — the billing engine
// ---------------------------------------------------------------------------

/** Both calendars bill 12 cycles per year; Pagume (ET month 13) is never billed. */
const BILLING_MONTHS_PER_YEAR = 12;

function monthsPerChargeOf(lease: Pick<LeaseForCharging, 'billingFrequency'>): number {
  return lease.billingFrequency === 'custom'
    ? 1
    : (MONTHS_PER_CHARGE[lease.billingFrequency as Exclude<BillingFrequency, 'custom'>] ?? 1);
}

/**
 * The anchor every billing cycle repeats on: the lease's start date, except that
 * a start inside Pagume (ET month 13) anchors on the same day of the following
 * Meskerem — the Pagume days the tenant already occupies ride free rather than
 * forming a short first cycle that would cost a full month's rent.
 */
function billingAnchor(lease: Pick<LeaseForCharging, 'billingCalendar' | 'startDate'>): CivilDate {
  const calendar = calendarOf(lease as LeaseForCharging);
  const start = utcDateToCivil(lease.startDate, calendar);
  if (calendar === 'ethiopian' && start.month === 13) {
    return { calendar, year: start.year + 1, month: 1, day: Math.min(start.day, 30) };
  }
  return start;
}

/**
 * Start date of billing cycle `cycleIndex` (0-based) in the lease's calendar.
 * The cycle repeats on the anchor's day-of-month every `monthsPerCharge` months;
 * Gregorian anchors on days 29–31 clamp to each short month's real length while
 * keeping the anchor (Jan 31 → Feb 28 → Mar 31). Ethiopian months 1–12 all have
 * 30 days and Pagume is skipped, so the anchor day always exists there.
 */
export function cycleStartFor(
  lease: Pick<LeaseForCharging, 'billingCalendar' | 'billingFrequency' | 'startDate'>,
  cycleIndex: number,
): CivilDate {
  const calendar = calendarOf(lease as LeaseForCharging);
  const anchor = billingAnchor(lease as LeaseForCharging);
  const monthIndex = (anchor.month - 1) + cycleIndex * monthsPerChargeOf(lease as LeaseForCharging);
  const year = anchor.year + Math.floor(monthIndex / BILLING_MONTHS_PER_YEAR);
  const month = (monthIndex % BILLING_MONTHS_PER_YEAR) + 1;
  const day =
    calendar === 'ethiopian'
      ? anchor.day
      : Math.min(anchor.day, daysInMonth({ calendar: 'gregorian', year, month }));
  return { calendar, year, month, day };
}

/** [start, end] of billing cycle `cycleIndex`: ends the day before the next cycle starts. */
export function cycleWindowFor(
  lease: Pick<LeaseForCharging, 'billingCalendar' | 'billingFrequency' | 'startDate'>,
  cycleIndex: number,
): { start: CivilDate; end: CivilDate } {
  const start = cycleStartFor(lease, cycleIndex);
  return { start, end: addDays(cycleStartFor(lease, cycleIndex + 1), -1) };
}

/** Month offset from the billing anchor to a period; null for Pagume (never billed). */
function billingMonthOffset(
  lease: Pick<LeaseForCharging, 'billingCalendar' | 'startDate'>,
  period: Pick<BillingPeriod, 'year' | 'month'>,
): number | null {
  const anchor = billingAnchor(lease as LeaseForCharging);
  if (calendarOf(lease as LeaseForCharging) === 'ethiopian' && period.month === 13) return null;
  return (period.year - anchor.year) * BILLING_MONTHS_PER_YEAR + (period.month - anchor.month);
}

/** True when the lease's billing frequency charges for this period. */
export function isChargingPeriod(
  lease: Pick<LeaseForCharging, 'billingCalendar' | 'billingFrequency' | 'startDate'>,
  period: BillingPeriod,
): boolean {
  const offset = billingMonthOffset(lease as LeaseForCharging, period);
  if (offset === null || offset < 0) return false;
  if (lease.billingFrequency === 'custom') return true;
  return offset % monthsPerChargeOf(lease as LeaseForCharging) === 0;
}

/**
 * Rent after the lease's agreed escalations, `monthsIn` billing months after the
 * anchor. Steps compound once per `escalationEveryMonths`, rounded per step so
 * minor units never drift. (Escalation counts billing months, not calendar
 * months — Pagume never advances the counter.)
 */
export function escalatedRent(
  lease: Pick<
    LeaseForCharging,
    'rentAmountMinor' | 'escalationPercent' | 'escalationEveryMonths'
  >,
  monthsIn: number,
): bigint {
  const percent = lease.escalationPercent ?? null;
  const every = lease.escalationEveryMonths ?? null;
  if (!percent || percent <= 0 || !every || every <= 0) return lease.rentAmountMinor;
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
 * Amount to charge for billing cycle `cycleIndex`.
 *
 * Cycles are whole months counted from the lease's start date, so there is no
 * entry proration: cycle 0 starts on the anchor (the start date itself) and
 * charges full rent. Only a cycle truncated by the lease's `endDate` — the last
 * one — is charged pro-rata for the days it actually covers. Rounded once with
 * `half-up`.
 */
export function amountForCycle(
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
  cycleIndex: number,
): bigint {
  const calendar = calendarOf(lease as LeaseForCharging);
  const months = monthsPerChargeOf(lease as LeaseForCharging);
  const full = escalatedRent(lease, cycleIndex * months) * BigInt(months);

  const { start, end } = cycleWindowFor(lease as LeaseForCharging, cycleIndex);
  let toCivil = end;
  if (lease.endDate) {
    const endCivil = utcDateToCivil(lease.endDate, calendar);
    if (compareCivil(endCivil, toCivil) < 0) toCivil = endCivil;
  }
  if (compareCivil(start, toCivil) > 0) return 0n; // lease does not cover this cycle
  if (compareCivil(toCivil, end) >= 0) return full;

  const coveredDays = differenceInDays(start, toCivil) + 1;
  const totalDays = differenceInDays(start, end) + 1;
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

  // Snapshot stranded credit BEFORE any new charge posts: once a charge lands,
  // the ledger sum may flip positive and the credit becomes invisible to
  // creditByCurrency — the new charge would then sit open while the ledger
  // says the tenant owes far less (charge/ledger desync).
  const creditBeforeByLease = new Map<string, bigint>();
  const creditCurrencyByLease = new Map<string, string>();
  if (leases.length) {
    const sums = await prisma.ledgerEntry.groupBy({
      by: ['leaseId', 'currency'],
      where: { organizationId: options.organizationId, leaseId: { in: leases.map((l) => l.id) } },
      _sum: { amountMinor: true },
    });
    for (const row of sums) {
      const balance = row._sum.amountMinor ?? 0n;
      if (balance < 0n && row.leaseId && row.currency && !creditBeforeByLease.has(row.leaseId)) {
        creditBeforeByLease.set(row.leaseId, -balance);
        creditCurrencyByLease.set(row.leaseId, row.currency);
      }
    }
  }

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

      // Which billing cycle (0-based) starts in this period? Pagume hosts none:
      // its 5–6 days ride free at the tail of the Nehasse cycle.
      const offset = billingMonthOffset(lease as LeaseForCharging, period);
      if (offset === null) continue;
      if (offset < 0) {
        result.skippedOutOfRange += 1;
        continue;
      }
      const months = monthsPerChargeOf(lease as LeaseForCharging);
      if (lease.billingFrequency !== 'custom' && offset % months !== 0) continue;
      const cycleIndex = lease.billingFrequency === 'custom' ? offset : offset / months;

      const cycle = cycleWindowFor(lease as LeaseForCharging, cycleIndex);

      // Out of the lease's term?
      if (leaseEnd && compareCivil(cycle.start, leaseEnd) > 0) {
        result.skippedOutOfRange += 1;
        continue;
      }
      if (options.skipNotYetStarted !== false && compareCivil(leaseStart, cycle.end) > 0) {
        result.skippedOutOfRange += 1;
        continue;
      }

      const amountMinor = amountForCycle(lease as LeaseForCharging, cycleIndex);
      if (amountMinor === 0n) continue;

      // The due date is the cycle start itself — the tenant's own due date, the
      // same day every cycle, not a separate configured day of the calendar month.
      const dueCivil = cycle.start;

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
              periodStart: toUtcDate(cycle.start),
              periodEnd: toUtcDate(cycle.end),
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
            occurredAt: toUtcDate(cycle.start),
            memo: `Rent ${period.key} (${period.calendar})`,
            createdById: options.actorUserId ?? null,
          });

          // Keep the escalation tracker current: the next date rent is due to
          // rise, in the lease's own calendar. Read by dashboards via the
          // (organizationId, billingCalendar, nextEscalationDate) index.
          if ((lease.escalationPercent ?? 0) > 0 && (lease.escalationEveryMonths ?? 0) > 0) {
            const monthsIn = cycleIndex * months;
            const every = lease.escalationEveryMonths ?? 0;
            if (monthsIn >= 0 && every > 0) {
              const nextStep = (Math.floor(monthsIn / every) + 1) * every;
              // First cycle whose months-in reaches the step boundary.
              const nextCycleIndex = Math.ceil(nextStep / months);
              await tx.lease.update({
                where: { id: lease.id },
                data: {
                  nextEscalationDate: toUtcDate(cycleStartFor(lease as LeaseForCharging, nextCycleIndex)),
                },
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
  // The credit snapshotted before the charges is passed explicitly — see the
  // comment at creditBeforeByLease.
  const touchedLeases = [...new Set(result.charges.map((charge) => charge.leaseId))];
  for (const leaseId of touchedLeases) {
    const lease = leases.find((candidate) => candidate.id === leaseId);
    const creditBefore = creditBeforeByLease.get(leaseId) ?? 0n;
    try {
      await prisma.$transaction(async (tx) => {
        await applyLeaseCreditInTx(tx, {
          organizationId: options.organizationId,
          leaseId,
          actorUserId: options.actorUserId ?? null,
          now: options.now ?? new Date(),
          creditMinor: creditBefore > 0n ? creditBefore : undefined,
          currency: creditCurrencyByLease.get(leaseId) ?? lease?.currency,
        });
      });
    } catch {
      // Credit application is best-effort here; the next payment or a retry
      // applies it. Never fail charge generation because of it.
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prepaid advance — a payment beyond all open charges registers future cycles
// ---------------------------------------------------------------------------

export interface AdvancePrepaidRentParams {
  organizationId: string;
  /** The full LeaseForCharging-shaped lease (status 'active', currency matching). */
  lease: LeaseForCharging & { tenantId: string | null; unitId: string | null };
  /** Money to place on future cycles (minor units), in the lease's currency. */
  availableMinor: bigint;
  actorUserId?: string | null;
  /** Safety cap on how many future cycles one payment may register. */
  maxCycles?: number;
}

export interface AdvancedCycle {
  chargeId: string;
  periodKey: string;
  amountMinor: bigint;
  allocatedMinor: bigint;
  status: 'open' | 'partial' | 'paid';
}

/**
 * "Register this money for the next unpaid month."
 *
 * When a tenant pays ahead of what is billed (the landlord collected month 4
 * while only cycles 1–3 exist), the surplus becomes *future rent charges* on
 * the lease's own anniversary cycle instead of a stranded credit balance. Each
 * created cycle is exactly what `generateCharges` would create later for that
 * period — same period key, same idempotency — so the nightly job simply skips
 * it (unique constraint), the prepayment shows up in rent-roll/summary for the
 * future month, and no negative "credit" line ever forms.
 *
 * The money available must already have settled every open charge; the caller
 * (recordPaymentInTx) guarantees that. A cycle whose rent exceeds the remaining
 * money is still created and left `partial` — the books show where the money
 * went, and the next payment tops it up.
 */
export async function advancePrepaidRentInTx(
  tx: PrismaLike,
  params: AdvancePrepaidRentParams,
): Promise<AdvancedCycle[]> {
  const { lease } = params;
  if (params.availableMinor <= 0n) return [];

  const calendar = calendarOf(lease);
  const months = monthsPerChargeOf(lease);

  // Where does billing stand? The latest cycle that already has a rent charge.
  const existing = await tx.charge.findMany({
    where: { organizationId: lease.organizationId, leaseId: lease.id, type: 'rent' },
    select: { periodStart: true, periodKey: true },
  });
  let nextCycleIndex = 0;
  for (const charge of existing) {
    const start = utcDateToCivil(charge.periodStart, calendar);
    const offset = billingMonthOffset(lease, { year: start.year, month: start.month });
    if (offset === null || offset < 0) continue;
    if (months > 1 && offset % months !== 0) continue;
    const cycleIndex = lease.billingFrequency === 'custom' ? offset : Math.floor(offset / months);
    nextCycleIndex = Math.max(nextCycleIndex, cycleIndex + 1);
  }

  const maxCycles = params.maxCycles ?? 36;
  const created: AdvancedCycle[] = [];
  let remaining = params.availableMinor;

  for (let n = 0; n < maxCycles && remaining > 0n; n += 1, nextCycleIndex += 1) {
    const amountMinor = amountForCycle(lease, nextCycleIndex);
    if (amountMinor <= 0n) break; // past the lease's term

    const cycle = cycleWindowFor(lease, nextCycleIndex);
    const period: BillingPeriod = {
      calendar,
      year: cycle.start.year,
      month: cycle.start.month,
      key: `${cycle.start.year}-${String(cycle.start.month).padStart(2, '0')}`,
    };
    const allocated = remaining < amountMinor ? remaining : amountMinor;
    const status = allocated >= amountMinor ? 'paid' : 'partial';

    const charge = await tx.charge.create({
      data: {
        organizationId: lease.organizationId,
        leaseId: lease.id,
        tenantId: lease.tenantId,
        unitId: lease.unitId,
        type: 'rent',
        description: `Rent for ${periodLabelFor(period)} — prepaid`,
        periodKey: period.key,
        periodCalendar: period.calendar,
        periodStart: toUtcDate(cycle.start),
        periodEnd: toUtcDate(cycle.end),
        dueDate: toUtcDate(cycle.start),
        amountMinor,
        currency: lease.currency,
        status: 'open',
        createdById: params.actorUserId ?? null,
      },
    });

    await postLedgerEntry(tx, {
      organizationId: lease.organizationId,
      leaseId: lease.id,
      chargeId: charge.id,
      kind: 'charge',
      amountMinor,
      currency: lease.currency,
      occurredAt: toUtcDate(cycle.start),
      memo: `Rent ${period.key} (${period.calendar}) — prepaid in advance`,
      createdById: params.actorUserId ?? null,
    });

    // Keep the escalation tracker current, exactly like generateCharges does.
    if ((lease.escalationPercent ?? 0) > 0 && (lease.escalationEveryMonths ?? 0) > 0) {
      const monthsIn = nextCycleIndex * months;
      const every = lease.escalationEveryMonths ?? 0;
      if (monthsIn >= 0 && every > 0) {
        const nextStep = (Math.floor(monthsIn / every) + 1) * every;
        const nextCycleIndexForStep = Math.ceil(nextStep / months);
        await tx.lease.update({
          where: { id: lease.id },
          data: { nextEscalationDate: toUtcDate(cycleStartFor(lease, nextCycleIndexForStep)) },
        });
      }
    }

    await recordAudit(tx, {
      organizationId: lease.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'generate',
      entityType: 'Charge',
      entityId: charge.id,
      after: {
        leaseId: lease.id,
        periodKey: period.key,
        amountMinor: amountMinor.toString(),
        prepaid: true,
      },
    });

    created.push({ chargeId: charge.id, periodKey: period.key, amountMinor, allocatedMinor: allocated, status });
    remaining -= allocated;
  }

  return created;
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

// ---------------------------------------------------------------------------
// Deposit as advance rent
// ---------------------------------------------------------------------------

export interface DepositAdvanceParams {
  organizationId: string;
  leaseId: string;
  depositAmountMinor: bigint;
  depositMonths: number;
  currency: string;
  actorUserId?: string | null;
}

/**
 * Deposit counts as advance rent: the money a tenant hands over as deposit
 * (1-2 months of rent, the Ethiopian norm) is exactly the rent for their first
 * 1-2 months, so those months are charged **and immediately settled** here.
 *
 * Mechanics, inside the caller's transaction:
 * - the first `depositMonths` billing cycles generate their rent charges
 *   (same shape the monthly job produces — whole cycles on the lease's own
 *   due date, no proration),
 * - one payment referenced `deposit-advance` records the deposit money and is
 *   allocated oldest-first; a full deposit settles every cycle exactly and ends
 *   at a zero balance,
 * - no `deposit` charge is posted: nothing is held for later in this mode.
 *
 * Idempotent on the `deposit-advance` payment, so lease activation can be
 * retried safely.
 */
export async function applyDepositAsAdvanceRentInTx(tx: PrismaLike, params: DepositAdvanceParams) {
  const existing = await tx.payment.findFirst({
    where: { leaseId: params.leaseId, reference: 'deposit-advance' },
    select: { id: true },
  });
  if (existing) return null;

  const lease = await tx.lease.findFirst({
    where: { id: params.leaseId, organizationId: params.organizationId, deletedAt: null },
  });
  if (!lease) throw notFound('Lease not found in this organization');

  const calendar: CalendarKind = lease.billingCalendar === 'gregorian' ? 'gregorian' : 'ethiopian';

  let created = 0;
  for (let step = 0; step < params.depositMonths; step += 1) {
    // Anniversary cycles: the deposit covers exactly this many whole cycles from
    // the start date, so a full deposit ends at a zero balance — no prorated
    // stub month, no stranded credit.
    const cycle = cycleWindowFor(lease, step);
    const amountMinor = amountForCycle(lease, step);
    if (amountMinor === 0n) continue;

    const period: BillingPeriod = {
      calendar,
      year: cycle.start.year,
      month: cycle.start.month,
      key: `${cycle.start.year}-${String(cycle.start.month).padStart(2, '0')}`,
    };

    try {
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
          periodStart: civilToUtcDate(cycle.start),
          periodEnd: civilToUtcDate(cycle.end),
          dueDate: civilToUtcDate(cycle.start),
          amountMinor,
          currency: lease.currency,
          status: 'open',
          createdById: params.actorUserId ?? null,
        },
      });

      await postLedgerEntry(tx, {
        organizationId: lease.organizationId,
        leaseId: lease.id,
        chargeId: charge.id,
        kind: 'charge',
        amountMinor,
        currency: lease.currency,
        occurredAt: civilToUtcDate(cycle.start),
        memo: `Rent ${period.key} (${period.calendar})`,
        createdById: params.actorUserId ?? null,
      });
      created += 1;
    } catch (error) {
      // (leaseId, periodKey, type) already billed — the job raced us. Fine.
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue;
      }
      throw error;
    }
  }

  if (created === 0) return null;

  // The deposit money itself: one payment, allocated oldest-first. With whole
  // cycles the deposit covers its months exactly; only a deposit sized below
  // the months of rent leaves a partial charge, exactly like a real payment.
  await recordPaymentInTx({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? null,
    leaseId: params.leaseId,
    tenantId: lease.tenantId,
    amount: { amountMinor: Number(params.depositAmountMinor), currency: params.currency },
    method: 'other',
    paidAt: lease.startDate,
    reference: 'deposit-advance',
    notes: 'Deposit received as advance rent',
  })(tx);

  return { chargesCreated: created };
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
