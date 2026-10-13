/**
 * Deposit-as-advance-rent semantics.
 *
 * A months-of-rent deposit is not held money — it IS the rent for the first
 * months of the lease. Creating (or activating) such a lease must charge and
 * settle those months, leave no deposit charge behind, and end at a zero
 * balance. Fixed deposits keep the classic held-charge behaviour.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture, createPortfolio, utcDate } from './helpers.js';

const app = createApp();

describe('deposit as advance rent', () => {
  let fixture: Awaited<ReturnType<typeof createOrganizationFixture>>;

  beforeEach(async () => {
    fixture = await createOrganizationFixture('deposit-advance');
  });

  /**
   * A lease whose start is exactly Meskerem 1 (the Ethiopian period boundary),
   * so "2 months of rent" is exactly 2 × rent with no proration noise. The
   * fixture creates it in the given status; the test then PATCHes it.
   */
  async function createLease(leaseStatus: string, body: Record<string, unknown>) {
    const prisma = getPrisma();
    const portfolio = await createPortfolio(prisma, {
      organizationId: fixture.organizationId,
      rentAmountMinor: 1_500_000,
      startDate: utcDate(2025, 9, 11), // Meskerem 1, 2018 E.C.
      dueDayOfMonth: 5,
      leaseStatus,
    });
    const response = await request(app)
      .patch(`/api/v1/leases/${portfolio.leaseId}`)
      .set(authHeader(fixture))
      .send(body);
    return { response, portfolio };
  }

  it('marks the first months paid from a months-of-rent deposit, with no held charge', async () => {
    const { response, portfolio } = await createLease('draft', {
      depositType: 'months_of_rent',
      depositMonths: 2,
      depositAmount: { amountMinor: 3_000_000, currency: 'ETB' },
      status: 'active',
    });
    expect(response.status).toBe(200);

    const prisma = getPrisma();
    const charges = await prisma.charge.findMany({
      where: { leaseId: portfolio.leaseId },
      orderBy: { dueDate: 'asc' },
    });
    // Two months of rent charged, both settled by the deposit.
    expect(charges).toHaveLength(2);
    expect(charges.every((charge) => charge.type === 'rent')).toBe(true);
    expect(charges.every((charge) => charge.status === 'paid')).toBe(true);

    // No deposit charge exists: nothing is held for later.
    expect(charges.some((charge) => charge.type === 'deposit')).toBe(false);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { leaseId: portfolio.leaseId, reference: 'deposit-advance' },
    });
    expect(payment.amountMinor).toBe(3_000_000n);

    // Charges + payment cancel out exactly.
    const balance = await prisma.ledgerEntry.aggregate({
      where: { leaseId: portfolio.leaseId },
      _sum: { amountMinor: true },
    });
    expect(balance._sum.amountMinor).toBe(0n);

    // The advance payment is idempotent: re-activating must not double-pay.
    const again = await request(app)
      .patch(`/api/v1/leases/${portfolio.leaseId}`)
      .set(authHeader(fixture))
      .send({ status: 'active' });
    expect([200, 409]).toContain(again.status);
    const payments = await prisma.payment.count({
      where: { leaseId: portfolio.leaseId, reference: 'deposit-advance' },
    });
    expect(payments).toBe(1);
  });

  it('keeps a fixed deposit as a held, refundable charge', async () => {
    const { response, portfolio } = await createLease('draft', {
      depositType: 'fixed',
      depositAmount: { amountMinor: 3_000_000, currency: 'ETB' },
      status: 'active',
    });
    expect(response.status).toBe(200);

    const prisma = getPrisma();
    const depositCharge = await prisma.charge.findFirst({
      where: { leaseId: portfolio.leaseId, type: 'deposit' },
    });
    expect(depositCharge).not.toBeNull();
    expect(depositCharge!.status).toBe('open');

    // No advance payment was recorded.
    const advance = await prisma.payment.findFirst({
      where: { leaseId: portfolio.leaseId, reference: 'deposit-advance' },
    });
    expect(advance).toBeNull();

    // No rent charges were generated at creation.
    const rentCharges = await prisma.charge.count({
      where: { leaseId: portfolio.leaseId, type: 'rent' },
    });
    expect(rentCharges).toBe(0);
  });

  it('applies on activation, not while the lease is still pending', async () => {
    const { response, portfolio } = await createLease('pending', {
      depositType: 'months_of_rent',
      depositMonths: 1,
    });
    expect(response.status).toBe(200);

    const prisma = getPrisma();
    expect(await prisma.charge.count({ where: { leaseId: portfolio.leaseId } })).toBe(0);
    expect(
      await prisma.payment.count({ where: { leaseId: portfolio.leaseId, reference: 'deposit-advance' } }),
    ).toBe(0);

    const activated = await request(app)
      .patch(`/api/v1/leases/${portfolio.leaseId}`)
      .set(authHeader(fixture))
      .send({ status: 'active' })
      .expect(200);
    expect(activated.body.lease.status).toBe('active');

    const charges = await prisma.charge.findMany({ where: { leaseId: portfolio.leaseId } });
    expect(charges).toHaveLength(1);
    expect(charges[0]!.status).toBe('paid');
  });
});
