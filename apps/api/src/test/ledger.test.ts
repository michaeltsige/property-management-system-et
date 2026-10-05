/**
 * The append-only ledger.
 *
 * Corrections are reversals, never edits. These tests prove that the sum of
 * ledger entries always equals the outstanding balance, that a reversal nets to
 * zero without deleting history, and that a second reversal is refused.
 */

import { describe, expect, it } from 'vitest';

import { civilToUtcDate } from '@pms/calendar';

import { getPrisma } from '../lib/prisma.js';
import { balanceMinor, leaseStatement, reverseEntry } from '../services/ledger.js';
import { generateCharges, waiveCharge } from '../services/charges.js';
import { recordPayment } from '../services/payments.js';
import { createOrganizationFixture, createPortfolio } from './helpers.js';

const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

async function setup(label: string) {
  const prisma = getPrisma();
  const fixture = await createOrganizationFixture(label);
  const portfolio = await createPortfolio(prisma, {
    organizationId: fixture.organizationId,
    rentAmountMinor: 1_500_000,
    startDate: etStart,
  });
  await generateCharges(prisma, {
    organizationId: fixture.organizationId,
    periodKeys: ['2019-01', '2019-02'],
  });

  const entries = await prisma.ledgerEntry.findMany({
    where: { leaseId: portfolio.leaseId },
    orderBy: { occurredAt: 'asc' },
  });

  return { prisma, fixture, portfolio, chargesEntries: entries };
}

describe('ledger invariants', () => {
  it('keeps charges positive and payments negative, with the sum as the balance', async () => {
    const { prisma, fixture, portfolio } = await setup('ledger-signs');

    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(entries.every((entry) => entry.kind === 'charge')).toBe(true);
    expect(entries.every((entry) => entry.amountMinor > 0n)).toBe(true);

    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 500_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const afterPayment = await prisma.ledgerEntry.findMany({ where: { leaseId: portfolio.leaseId } });
    const payment = afterPayment.find((entry) => entry.kind === 'payment');
    expect(payment?.amountMinor).toBe(-500_000n);

    const sum = afterPayment.reduce((total, entry) => total + entry.amountMinor, 0n);
    const balance = await balanceMinor(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
    });
    expect(balance).toBe(sum);
    expect(balance).toBe(2_500_000n);
  });

  it('reverses an entry by adding a mirror entry, never by deleting', async () => {
    const { prisma, fixture, portfolio, chargesEntries } = await setup('ledger-reverse');
    const chargeEntry = chargesEntries[0]!;

    const reversal = await reverseEntry(prisma, {
      organizationId: fixture.organizationId,
      entryId: chargeEntry.id,
      reason: 'Charge raised in error',
      actorUserId: fixture.userId,
    });

    expect(reversal.kind).toBe('reversal');
    expect(reversal.amountMinor).toBe(-chargeEntry.amountMinor);
    expect(reversal.reversesEntryId).toBe(chargeEntry.id);

    // Both rows still exist: history is intact.
    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(entries).toHaveLength(3);

    expect(
      await balanceMinor(prisma, { organizationId: fixture.organizationId, leaseId: portfolio.leaseId }),
    ).toBe(1_500_000n);

    // Reversing twice is refused.
    await expect(
      reverseEntry(prisma, {
        organizationId: fixture.organizationId,
        entryId: chargeEntry.id,
        reason: 'again',
      }),
    ).rejects.toThrow(/already been reversed/);
  });

  it('builds a statement with a running balance, oldest first', async () => {
    const { prisma, fixture, portfolio } = await setup('ledger-statement');

    // Paid after both period starts, so the statement is deterministically ordered.
    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 1_000_000, currency: 'ETB' },
      method: 'bank_transfer',
      paidAt: civilToUtcDate({ year: 2026, month: 12, day: 1, calendar: 'gregorian' }),
    });

    const statement = await leaseStatement(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
    });

    expect(statement.lines).toHaveLength(3);
    expect(statement.lines[0]?.runningBalanceMinor).toBe(1_500_000n);
    expect(statement.lines[1]?.runningBalanceMinor).toBe(3_000_000n);
    expect(statement.lines[2]?.runningBalanceMinor).toBe(2_000_000n);
    expect(statement.closingBalanceMinor).toBe(2_000_000n);
    expect(statement.currency).toBe('ETB');

    // Chronological ordering.
    const times = statement.lines.map((line) => line.occurredAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('records a waiver as a negative entry and leaves the charge visible', async () => {
    const { prisma, fixture, portfolio } = await setup('ledger-waiver');
    const charge = await prisma.charge.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, periodKey: '2019-01' },
    });

    const waived = await waiveCharge(prisma, {
      organizationId: fixture.organizationId,
      chargeId: charge.id,
      reason: 'Water damage: goodwill gesture',
      actorUserId: fixture.userId,
    });
    expect(waived.status).toBe('waived');
    // The original charge row is untouched: waiving does not edit the amount.
    expect(waived.amountMinor).toBe(charge.amountMinor);

    const waiver = await prisma.ledgerEntry.findFirstOrThrow({
      where: { chargeId: charge.id, kind: 'waiver' },
    });
    expect(waiver.amountMinor).toBe(-charge.amountMinor);

    expect(
      await balanceMinor(prisma, { organizationId: fixture.organizationId, leaseId: portfolio.leaseId }),
    ).toBe(1_500_000n);
  });

  it('writes an audit row for every financial change', async () => {
    const { prisma, fixture, portfolio } = await setup('ledger-audit');
    const charge = await prisma.charge.findFirstOrThrow({ where: { leaseId: portfolio.leaseId } });

    await waiveCharge(prisma, {
      organizationId: fixture.organizationId,
      chargeId: charge.id,
      reason: 'Test waiver',
      actorUserId: fixture.userId,
    });

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: fixture.organizationId, entityType: 'Charge' },
      orderBy: { createdAt: 'asc' },
    });

    const kinds = audits.map((entry) => entry.action);
    expect(kinds).toContain('generate');
    expect(kinds).toContain('update');
    const waiverAudit = audits.at(-1);
    expect(waiverAudit?.before).toBeTruthy();
    expect(waiverAudit?.after).toBeTruthy();
  });
});
