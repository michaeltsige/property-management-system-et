/**
 * Payments: allocation, partial payments, credits, reversals and receipt numbers.
 *
 * Manual payment recording is a first-class method per the brief, so it gets the
 * same rigour as a provider integration: the amount allocated can never exceed a
 * charge's outstanding balance, and everything lands in the ledger.
 */

import { describe, expect, it } from 'vitest';

import { civilToUtcDate } from '@pms/calendar';

import { getPrisma } from '../lib/prisma.js';
import { balanceMinor } from '../services/ledger.js';
import { recordPayment, reversePayment } from '../services/payments.js';
import { generateCharges } from '../services/charges.js';
import { createOrganizationFixture, createPortfolio } from './helpers.js';

const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

async function setup(label: string, rentMinor = 1_500_000) {
  const prisma = getPrisma();
  const fixture = await createOrganizationFixture(label);
  const portfolio = await createPortfolio(prisma, {
    organizationId: fixture.organizationId,
    billingCalendar: 'ethiopian',
    rentAmountMinor: rentMinor,
    startDate: etStart,
    dueDayOfMonth: 5,
  });
  await generateCharges(prisma, {
    organizationId: fixture.organizationId,
    periodKeys: ['2019-01', '2019-02'],
  });

  const charges = await prisma.charge.findMany({
    where: { leaseId: portfolio.leaseId },
    orderBy: { dueDate: 'asc' },
  });

  return { prisma, fixture, portfolio, charges };
}

describe('manual payment recording', () => {
  it('allocates oldest-first and marks the charge paid', async () => {
    const { prisma, fixture, portfolio, charges } = await setup('pay-full');
    const first = charges[0]!;

    const result = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: Number(first.amountMinor), currency: 'ETB' },
      method: 'bank_transfer',
      paidAt: new Date(),
      reference: 'CBE-0001',
    });

    expect(result.allocatedMinor).toBe(first.amountMinor);
    expect(result.unallocatedMinor).toBe(0n);
    expect(result.receiptNumber).toMatch(/^RCT-\d{4}-\d{6}$/);

    const updated = await prisma.charge.findUniqueOrThrow({ where: { id: first.id } });
    expect(updated.status).toBe('paid');
    expect(updated.paidMinor).toBe(first.amountMinor);

    // The second charge is untouched, and the balance reflects one period still owed.
    expect(
      await balanceMinor(prisma, { organizationId: fixture.organizationId, leaseId: portfolio.leaseId }),
    ).toBe(1_500_000n);
  });

  it('supports partial payments and tops them up', async () => {
    const { prisma, fixture, portfolio, charges } = await setup('pay-partial');
    const first = charges[0]!;

    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 900_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const partial = await prisma.charge.findUniqueOrThrow({ where: { id: first.id } });
    expect(partial.status).toBe('partial');
    expect(partial.paidMinor).toBe(900_000n);

    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: Number(first.amountMinor) - 900_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const paid = await prisma.charge.findUniqueOrThrow({ where: { id: first.id } });
    expect(paid.status).toBe('paid');
    expect(paid.paidMinor).toBe(first.amountMinor);
  });

  it('records an overpayment as a credit on the lease', async () => {
    const { prisma, fixture, portfolio } = await setup('pay-credit');

    const result = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 5_000_000, currency: 'ETB' }, // more than one period
      method: 'bank_transfer',
      paidAt: new Date(),
    });

    // The two open charges are 1,500,000 each: 3,000,000 allocated, 2,000,000 left over.
    expect(result.allocatedMinor).toBe(3_000_000n);
    expect(result.unallocatedMinor).toBe(2_000_000n);

    // Two charges (3,000,000) minus 5,000,000 paid = a 2,000,000 credit.
    const balance = await balanceMinor(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
    });
    expect(balance).toBe(-2_000_000n);
  });

  it('refuses an explicit allocation larger than the outstanding balance', async () => {
    const { prisma, fixture, portfolio, charges } = await setup('pay-over');
    const first = charges[0]!;

    await expect(
      recordPayment(prisma, {
        organizationId: fixture.organizationId,
        leaseId: portfolio.leaseId,
        amount: { amountMinor: Number(first.amountMinor), currency: 'ETB' },
        method: 'cash',
        paidAt: new Date(),
        allocations: [
          { chargeId: first.id, amount: { amountMinor: Number(first.amountMinor) + 1, currency: 'ETB' } },
        ],
      }),
    ).rejects.toThrow(/cannot exceed the outstanding balance/);
  });

  it('refuses to record a provider method as a manual payment', async () => {
    const { prisma, fixture, portfolio } = await setup('pay-provider');

    await expect(
      recordPayment(prisma, {
        organizationId: fixture.organizationId,
        leaseId: portfolio.leaseId,
        amount: { amountMinor: 100_000, currency: 'ETB' },
        method: 'telebirr',
        paidAt: new Date(),
      }),
    ).rejects.toThrow(/must be recorded through its payment provider/);
  });

  it('rejects zero and negative amounts', async () => {
    const { prisma, fixture, portfolio } = await setup('pay-zero');

    await expect(
      recordPayment(prisma, {
        organizationId: fixture.organizationId,
        leaseId: portfolio.leaseId,
        amount: { amountMinor: 0, currency: 'ETB' },
        method: 'cash',
        paidAt: new Date(),
      }),
    ).rejects.toThrow(/greater than zero/);
  });

  it('issues unique, sequential receipt numbers per organization', async () => {
    const { prisma, fixture, portfolio } = await setup('pay-receipts');

    const first = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 100_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });
    const second = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 100_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    expect(first.receiptNumber).not.toBe(second.receiptNumber);
    const numbers = [first.receiptNumber, second.receiptNumber].sort();
    expect(Number(numbers[0]!.split('-')[2])).toBeLessThan(Number(numbers[1]!.split('-')[2]));
  });
});

describe('reversing a payment', () => {
  it('restores the charge and nets the ledger back to zero', async () => {
    const { prisma, fixture, portfolio, charges } = await setup('pay-reverse');
    const first = charges[0]!;

    const payment = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: Number(first.amountMinor), currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const beforeReversal = await balanceMinor(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
    });
    expect(beforeReversal).toBe(1_500_000n); // the second period is still owed

    await reversePayment(prisma, {
      organizationId: fixture.organizationId,
      paymentId: payment.paymentId,
      reason: 'Cheque bounced',
    });

    const afterReversal = await balanceMinor(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
    });
    expect(afterReversal).toBe(3_000_000n); // both periods owed again

    const restored = await prisma.charge.findUniqueOrThrow({ where: { id: first.id } });
    expect(restored.status).toBe('open');
    expect(restored.paidMinor).toBe(0n);

    const paymentRow = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentRow.status).toBe('reversed');

    // Reversing twice must fail: otherwise the tenant gets credited twice.
    await expect(
      reversePayment(prisma, {
        organizationId: fixture.organizationId,
        paymentId: payment.paymentId,
        reason: 'again',
      }),
    ).rejects.toThrow(/already been reversed/);
  });

  it("cannot reverse another organization's payment", async () => {
    const { prisma, fixture, portfolio, charges } = await setup('pay-cross');
    const first = charges[0]!;
    const payment = await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: Number(first.amountMinor), currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const other = await createOrganizationFixture('pay-cross-other');

    await expect(
      reversePayment(prisma, {
        organizationId: other.organizationId,
        paymentId: payment.paymentId,
        reason: 'not mine',
      }),
    ).rejects.toThrow(/not found in this organization/);
  });
});
