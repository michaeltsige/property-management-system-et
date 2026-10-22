/**
 * Charge generation: idempotency, calendar correctness and proration.
 *
 * The brief calls out two hard requirements — idempotent monthly generation and
 * correct handling of the Ethiopian calendar (12 × 30 days + Pagume). Both are
 * tested here against the real database, because the guarantee comes from a unique
 * constraint, not from application logic alone.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { civilToUtcDate, ethiopianToGregorian } from '@pms/calendar';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { balanceMinor } from '../services/ledger.js';
import { amountForCycle, cycleWindowFor, generateCharges, isChargingPeriod } from '../services/charges.js';
import { authHeader, createOrganizationFixture, createPortfolio, utcDate } from './helpers.js';

const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

describe('idempotent monthly generation', () => {
  it('creates each period exactly once, however often it runs', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('charges');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      rentAmountMinor: 1_500_000,
      startDate: etStart,
    });

    const first = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01', '2019-02'],
    });
    expect(first.created).toBe(2);

    const second = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01', '2019-02'],
    });
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(2);

    // A third run via a different path (single lease, one period) changes nothing.
    const third = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01'],
      leaseIds: [portfolio.leaseId],
    });
    expect(third.created).toBe(0);

    const charges = await prisma.charge.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(charges).toHaveLength(2);

    // …and the ledger has exactly one entry per charge: no double-counting.
    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(entries).toHaveLength(2);
    expect(
      await balanceMinor(prisma, { organizationId: fixture.organizationId, leaseId: portfolio.leaseId }),
    ).toBe(3_000_000n);
  });

  it('survives concurrent generation attempts without duplicating', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('concurrent');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      startDate: etStart,
    });

    const results = await Promise.allSettled([
      generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-01'] }),
      generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-01'] }),
    ]);

    const charges = await prisma.charge.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(charges).toHaveLength(1);

    // Exactly one of the two racers created it; the other saw the unique constraint.
    const createdCount = results
      .filter((result) => result.status === 'fulfilled')
      .reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value.created : 0), 0);
    expect(createdCount).toBe(1);
  });
});

describe('Pagume is never billed', () => {
  it('generates nothing for month 13, and its days ride free on the Nehasse cycle', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('pagume');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      rentAmountMinor: 1_500_000,
      startDate: etStart,
    });

    // Month 13 hosts no cycle start and must never produce a charge: nobody
    // pays a full month's rent for Pagume's 5–6 days.
    const pagume = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-13'],
    });
    expect(pagume.created).toBe(0);
    expect(await prisma.charge.count({ where: { leaseId: portfolio.leaseId } })).toBe(0);

    // The Nehasse cycle spans Nehasse 1 → Pagume 6 (2019 E.C. is a leap year)
    // and still costs exactly one month's rent: Pagume is free.
    const nehasse = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-12'],
    });
    expect(nehasse.created).toBe(1);

    const charge = await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } });
    expect(charge.periodKey).toBe('2019-12');
    expect(charge.periodCalendar).toBe('ethiopian');
    expect(charge.amountMinor).toBe(1_500_000n);
    expect(charge.periodStart.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 12, day: 1, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
    // Sanity check against the real Gregorian dates: Pagume 6, 2019 E.C. = 2027-09-11.
    const gregorian = ethiopianToGregorian(2019, 13, 6);
    expect(gregorian).toEqual({ year: 2027, month: 9, day: 11 });
    expect(charge.periodEnd.toISOString().slice(0, 10)).toBe('2027-09-11');
    // The due date is the cycle start itself (the tenant's own due date).
    expect(charge.dueDate.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 12, day: 1, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
  });

  it('keeps charging after the lease start month without billing before it', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('future');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      startDate: civilToUtcDate({ year: 2020, month: 1, day: 1, calendar: 'ethiopian' }),
    });

    const result = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-12'],
    });
    expect(result.created).toBe(0);
    expect(result.skippedOutOfRange).toBe(1);
    expect(await prisma.charge.count({ where: { leaseId: portfolio.leaseId } })).toBe(0);
  });

  it('stops charging after the lease end date', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('ended');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      startDate: etStart,
      endDate: civilToUtcDate({ year: 2019, month: 1, day: 30, calendar: 'ethiopian' }),
    });

    const result = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-02'],
    });
    expect(result.created).toBe(0);
    expect(await prisma.charge.count({ where: { leaseId: portfolio.leaseId } })).toBe(0);
  });
});

describe('cross-calendar charging (display calendar vs billing calendar)', () => {
  it('generates the equivalent billing period when the caller speaks another calendar', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('crosscal');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      startDate: etStart,
    });

    // The screen shows "October 2026" (Gregorian); the lease bills Ethiopian.
    const result = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2026-10'],
      sourceCalendar: 'gregorian',
    });
    expect(result.created).toBe(1);

    const charge = await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } });
    expect(charge.periodCalendar).toBe('ethiopian');
    // Gregorian October 2026 straddles Ethiopian 2019-02 (Oct 11 – Nov 9).
    expect(charge.periodKey).toBe('2019-02');
  });

  it('finds a charge billed in one calendar through the other calendar window', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('crossfilter');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      startDate: etStart,
    });
    await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-02'],
    });

    const app = createApp();
    // Viewing the wall-clock month in Gregorian still shows the Ethiopian-billed charge.
    const found = await request(app)
      .get('/api/v1/charges?periodKey=2026-10&calendar=gregorian')
      .set(authHeader(fixture))
      .expect(200);
    expect(found.body.items.map((row: { id: string }) => row.id)).toContain(
      (await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } })).id,
    );

    // Without the calendar hint the key matches literally, as before.
    const exact = await request(app)
      .get('/api/v1/charges?periodKey=2026-10')
      .set(authHeader(fixture))
      .expect(200);
    expect(exact.body.items).toHaveLength(0);
  });
});

describe('billing frequency and anniversary cycles', () => {
  it('bills quarterly leases three months at a time, only in the right months', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('quarterly');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      billingFrequency: 'quarterly',
      rentAmountMinor: 1_000_000,
      // Billing starts with the period itself, so 2019-01 is month 0 of the cycle.
      startDate: civilToUtcDate({ year: 2019, month: 1, day: 1, calendar: 'ethiopian' }),
    });

    const first = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01', '2019-02', '2019-04'],
    });

    // Only 2019-01 and 2019-04 are charging periods (offsets 0 and 3 in the cycle).
    // 2019-02 is skipped: a quarterly lease is not billed every month.
    expect(first.created).toBe(2);
    const charge = await prisma.charge.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, periodKey: '2019-01' },
    });
    expect(charge.amountMinor).toBe(3_000_000n); // three months of rent
  });

  it('bills whole cycles from the start date — no entry proration, due date is the start day', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('anniversary');
    // Starting mid-month used to prorate; now the first cycle is a whole month
    // running from the start date to the day before next month's start day.
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      rentAmountMinor: 1_500_000,
      startDate: civilToUtcDate({ year: 2019, month: 1, day: 16, calendar: 'ethiopian' }),
    });

    const result = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01'],
    });
    expect(result.created).toBe(1);

    const charge = await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } });
    expect(charge.amountMinor).toBe(1_500_000n); // full rent, not 750k
    expect(charge.dueDate.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 1, day: 16, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
    expect(charge.periodStart.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 1, day: 16, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
    expect(charge.periodEnd.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 2, day: 15, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );

    // The next cycle starts on the same day of the following month, in full.
    await generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-02'] });
    const second = await prisma.charge.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, periodKey: '2019-02' },
    });
    expect(second.amountMinor).toBe(1_500_000n);
    expect(second.dueDate.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 2, day: 16, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
    void portfolio;
  });

  it('keeps the anchor day across Gregorian months, clamping only inside short months', () => {
    const lease = {
      billingCalendar: 'gregorian',
      billingFrequency: 'monthly',
      rentAmountMinor: 1_000_000n,
      currency: 'ETB',
      startDate: utcDate(2026, 1, 31),
      endDate: null,
      escalationPercent: null,
      escalationEveryMonths: null,
    };
    const january = cycleWindowFor(lease, 0);
    expect(january.start).toEqual({ calendar: 'gregorian', year: 2026, month: 1, day: 31 });
    expect(january.end).toEqual({ calendar: 'gregorian', year: 2026, month: 2, day: 27 });
    // February has no 31st: the cycle starts on the 28th, the anchor survives.
    const february = cycleWindowFor(lease, 1);
    expect(february.start).toEqual({ calendar: 'gregorian', year: 2026, month: 2, day: 28 });
    expect(february.end).toEqual({ calendar: 'gregorian', year: 2026, month: 3, day: 30 });
    const march = cycleWindowFor(lease, 2);
    expect(march.start).toEqual({ calendar: 'gregorian', year: 2026, month: 3, day: 31 });
    expect(amountForCycle(lease, 1)).toBe(1_000_000n);
  });

  it('computes frequency and amounts as pure functions (no database needed)', () => {
    const lease = {
      billingCalendar: 'ethiopian',
      billingFrequency: 'monthly',
      rentAmountMinor: 1_500_000n,
      currency: 'ETB',
      startDate: civilToUtcDate({ year: 2019, month: 1, day: 1, calendar: 'ethiopian' }),
      endDate: null,
      escalationPercent: null,
      escalationEveryMonths: null,
    };
    expect(isChargingPeriod(lease, { calendar: 'ethiopian', year: 2019, month: 5, key: '2019-05' })).toBe(
      true,
    );
    expect(isChargingPeriod(lease, { calendar: 'ethiopian', year: 2019, month: 13, key: '2019-13' })).toBe(
      false,
    );
    // Cycle 4 starts Tikimt 1, 2019 E.C. and covers a whole 30-day month.
    expect(amountForCycle(lease, 4)).toBe(1_500_000n);
  });
});
