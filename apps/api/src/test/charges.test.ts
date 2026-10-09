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
import { amountForPeriod, generateCharges, isChargingPeriod } from '../services/charges.js';
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

describe('Ethiopian calendar awareness', () => {
  it('charges the 13th month (Pagume) and clamps a due day that cannot exist', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('pagume');
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      billingCalendar: 'ethiopian',
      rentAmountMinor: 1_500_000,
      // A due day of 30 is common practice; Pagume has only 5 or 6 days.
      dueDayOfMonth: 30,
      startDate: etStart,
    });

    // 2019 E.C. is a leap year (2019 % 4 === 3), so Pagume has 6 days.
    const leap = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-13'],
    });
    expect(leap.created).toBe(1);

    const leapCharge = await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } });
    expect(leapCharge.periodKey).toBe('2019-13');
    expect(leapCharge.periodCalendar).toBe('ethiopian');
    expect(leapCharge.dueDate.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2019, month: 13, day: 6, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
    // Sanity check against the real Gregorian dates: Pagume 6, 2019 E.C. = 2027-09-11.
    const gregorian = ethiopianToGregorian(2019, 13, 6);
    expect(gregorian).toEqual({ year: 2027, month: 9, day: 11 });
    expect(leapCharge.periodStart.toISOString().slice(0, 10)).toBe('2027-09-06');
    expect(leapCharge.periodEnd.toISOString().slice(0, 10)).toBe('2027-09-11');

    // 2020 E.C. is a common year: Pagume has 5 days, so a due day of 30 clamps to 5.
    const common = await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2020-13'],
    });
    expect(common.created).toBe(1);
    const commonCharge = await prisma.charge.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, periodKey: '2020-13' },
    });
    expect(commonCharge.dueDate.toISOString().slice(0, 10)).toBe(
      civilToUtcDate({ year: 2020, month: 13, day: 5, calendar: 'ethiopian' }).toISOString().slice(0, 10),
    );
  });

  it('does not charge an Ethiopian lease before it starts', async () => {
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

describe('billing frequency and proration', () => {
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

  it('pro-rates the first period when a lease starts mid-month', async () => {
    const prisma = getPrisma();
    const fixture = await createOrganizationFixture('proration');
    // Meskerem has 30 days; starting on day 16 leaves 15 covered days.
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
    expect(charge.amountMinor).toBe(750_000n); // exactly half of 1,500,000

    // The next period is charged in full.
    await generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-02'] });
    const second = await prisma.charge.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, periodKey: '2019-02' },
    });
    expect(second.amountMinor).toBe(1_500_000n);
    void portfolio;
  });

  it('computes frequency and amounts as pure functions (no database needed)', () => {
    const lease = {
      billingCalendar: 'ethiopian',
      billingFrequency: 'monthly',
      rentAmountMinor: 1_500_000n,
      currency: 'ETB',
      startDate: utcDate(2019, 1, 1),
    };
    expect(isChargingPeriod(lease, { calendar: 'ethiopian', year: 2019, month: 5, key: '2019-05' })).toBe(
      true,
    );
    expect(amountForPeriod(lease, { calendar: 'ethiopian', year: 2019, month: 5, key: '2019-05' })).toBe(
      1_500_000n,
    );
  });
});
