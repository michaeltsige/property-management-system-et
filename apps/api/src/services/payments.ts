/**
 * Payment recording and allocation.
 *
 * Manual payments (cash, bank transfer, cheque) are a first-class method, exactly
 * as the brief requires. Online payments go through a provider adapter and land in
 * the same code path once confirmed, so there is only one way money enters the
 * books: a `Payment` row, its `PaymentAllocation` rows, and a negative
 * `LedgerEntry` — all in a single transaction.
 *
 * Concurrency: allocation runs at `Serializable` isolation and retries on a
 * serialization failure, so two cashiers accepting the same rent simultaneously
 * cannot over-allocate a charge.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import { MANUAL_PAYMENT_METHODS, type Money, type PaymentMethod } from '@pms/shared';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import { postLedgerEntry } from './ledger.js';
import { recordAudit } from './audit.js';

const MAX_SERIALIZATION_RETRIES = 3;

export interface AllocationInput {
  chargeId: string;
  amount: Money;
}

export interface RecordPaymentInput {
  organizationId: string;
  actorUserId?: string | null;
  leaseId?: string | null;
  tenantId?: string | null;
  amount: Money;
  method: PaymentMethod;
  paidAt: Date;
  reference?: string | null;
  notes?: string | null;
  /** Explicit allocation; when omitted, open charges are paid oldest-first. */
  allocations?: AllocationInput[];
  /** Set for payments confirmed by a provider adapter. */
  provider?: string | null;
  providerRef?: string | null;
  providerPayload?: Record<string, unknown> | null;
}

export interface RecordedPayment {
  paymentId: string;
  receiptNumber: string;
  amountMinor: bigint;
  currency: string;
  allocatedMinor: bigint;
  /** Amount received beyond the open charges; sits as a credit on the lease. */
  unallocatedMinor: bigint;
  allocations: { chargeId: string; amountMinor: bigint }[];
}

export async function recordPayment(
  prisma: PrismaClient,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  if (input.amount.amountMinor <= 0) throw businessRule('Payment amount must be greater than zero');

  if (!input.provider && !MANUAL_PAYMENT_METHODS.includes(input.method) && input.method !== 'other') {
    throw businessRule(
      `Method "${input.method}" must be recorded through its payment provider, not as a manual entry`,
    );
  }

  for (let attempt = 0; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(runRecording(input), { isolationLevel: 'Serializable' });
    } catch (error) {
      const isSerializationFailure =
        error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2034';
      if (isSerializationFailure && attempt < MAX_SERIALIZATION_RETRIES) continue;
      throw error;
    }
  }
  throw conflict('Could not record the payment after several attempts; please retry');
}

function runRecording(input: RecordPaymentInput) {
  return async (tx: Prisma.TransactionClient): Promise<RecordedPayment> => {
    const lease = input.leaseId
      ? await tx.lease.findFirst({
          where: { id: input.leaseId, organizationId: input.organizationId, deletedAt: null },
        })
      : await tx.lease.findFirst({
          where: {
            organizationId: input.organizationId,
            tenantId: input.tenantId ?? undefined,
            status: 'active',
          },
          orderBy: { startDate: 'desc' },
        });

    if (input.leaseId && !lease) throw notFound('Lease not found in this organization');

    const target = input.allocations?.length
      ? await loadChargesByIds(
          tx,
          input.organizationId,
          input.allocations.map((a) => a.chargeId),
        )
      : lease
        ? await tx.charge.findMany({
            where: {
              organizationId: input.organizationId,
              leaseId: lease.id,
              status: { in: ['open', 'partial'] },
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          })
        : [];

    const planned: { chargeId: string; amountMinor: bigint }[] = [];
    let remaining = BigInt(input.amount.amountMinor);

    if (input.allocations?.length) {
      for (const requested of input.allocations) {
        if (requested.amount.currency !== input.amount.currency) {
          throw businessRule('Allocation currency must match the payment currency');
        }
        const charge = target.find((c) => c.id === requested.chargeId);
        if (!charge) throw notFound('Charge not found in this organization');
        const outstanding = charge.amountMinor - charge.paidMinor;
        if (outstanding <= 0n) throw conflict('That charge is already fully paid');
        const amount = BigInt(requested.amount.amountMinor);
        if (amount > outstanding) {
          throw businessRule('An allocation cannot exceed the outstanding balance of the charge');
        }
        if (amount > remaining) throw businessRule('Allocations exceed the payment amount');
        planned.push({ chargeId: charge.id, amountMinor: amount });
        remaining -= amount;
      }
    } else {
      for (const charge of target) {
        if (remaining <= 0n) break;
        if (charge.currency !== input.amount.currency) continue;
        const outstanding = charge.amountMinor - charge.paidMinor;
        if (outstanding <= 0n) continue;
        const amount = outstanding < remaining ? outstanding : remaining;
        planned.push({ chargeId: charge.id, amountMinor: amount });
        remaining -= amount;
      }
    }

    const allocated = planned.reduce((sum, item) => sum + item.amountMinor, 0n);
    const receiptNumber = await nextReceiptNumber(tx, input.organizationId, input.paidAt);

    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        leaseId: lease?.id ?? null,
        tenantId: input.tenantId ?? lease?.tenantId ?? null,
        amountMinor: BigInt(input.amount.amountMinor),
        currency: input.amount.currency,
        method: input.method,
        status: 'succeeded',
        paidAt: input.paidAt,
        reference: input.reference ?? null,
        receiptNumber,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        providerPayload: (input.providerPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        notes: input.notes ?? null,
        recordedById: input.actorUserId ?? null,
      },
    });

    for (const item of planned) {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, chargeId: item.chargeId, amountMinor: item.amountMinor },
      });

      const charge = target.find((c) => c.id === item.chargeId);
      if (!charge) continue;
      const newPaid = charge.paidMinor + item.amountMinor;
      await tx.charge.update({
        where: { id: charge.id },
        data: {
          paidMinor: newPaid,
          status: newPaid >= charge.amountMinor ? 'paid' : 'partial',
        },
      });
    }

    await postLedgerEntry(tx, {
      organizationId: input.organizationId,
      leaseId: payment.leaseId,
      paymentId: payment.id,
      kind: 'payment',
      // Payments reduce what is owed, hence negative.
      amountMinor: -BigInt(input.amount.amountMinor),
      currency: input.amount.currency,
      occurredAt: input.paidAt,
      memo: input.reference
        ? `Payment (${input.method}) ref ${input.reference}`
        : `Payment (${input.method})`,
      createdById: input.actorUserId ?? null,
    });

    await recordAudit(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: 'create',
      entityType: 'Payment',
      entityId: payment.id,
      after: {
        amountMinor: payment.amountMinor.toString(),
        method: payment.method,
        receiptNumber,
        leaseId: payment.leaseId,
        allocations: planned.map((p) => ({ chargeId: p.chargeId, amountMinor: p.amountMinor.toString() })),
      },
    });

    return {
      paymentId: payment.id,
      receiptNumber,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      allocatedMinor: allocated,
      unallocatedMinor: BigInt(input.amount.amountMinor) - allocated,
      allocations: planned,
    };
  };
}

async function loadChargesByIds(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  const charges = await tx.charge.findMany({ where: { organizationId, id: { in: ids } } });
  if (charges.length !== new Set(ids).size)
    throw notFound('One or more charges were not found in this organization');
  return charges;
}

/**
 * Sequential receipt numbers per organization and year: `RCT-2019-000123`.
 * The unique constraint on `(organizationId, receiptNumber)` makes a collision a
 * retryable conflict rather than a silently duplicated receipt.
 */
async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  when: Date,
): Promise<string> {
  const year = when.getUTCFullYear();
  const count = await tx.payment.count({
    where: {
      organizationId,
      receiptNumber: { not: null },
      createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
  });
  let attempt = count + 1;
  for (let tries = 0; tries < 25; tries += 1) {
    const candidate = `RCT-${year}-${String(attempt).padStart(6, '0')}`;
    const existing = await tx.payment.findFirst({ where: { organizationId, receiptNumber: candidate } });
    if (!existing) return candidate;
    attempt += 1;
  }
  throw conflict('Could not allocate a unique receipt number');
}

/**
 * Reverse a payment: the money is returned, the ledger gets the mirror-image
 * entry, and the charges it paid become outstanding again.
 */
export async function reversePayment(
  prisma: PrismaClient,
  params: { organizationId: string; paymentId: string; reason: string; actorUserId?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: params.paymentId, organizationId: params.organizationId },
      include: { allocations: true },
    });
    if (!payment) throw notFound('Payment not found in this organization');
    if (payment.status === 'reversed') throw conflict('This payment has already been reversed');

    const reversal = await postLedgerEntry(tx, {
      organizationId: payment.organizationId,
      leaseId: payment.leaseId,
      paymentId: payment.id,
      kind: 'reversal',
      amountMinor: payment.amountMinor, // cancels the negative payment entry
      currency: payment.currency,
      occurredAt: new Date(),
      memo: `Reversal of payment ${payment.receiptNumber ?? payment.id}: ${params.reason}`,
      createdById: params.actorUserId ?? null,
    });

    for (const allocation of payment.allocations) {
      const charge = await tx.charge.findUnique({ where: { id: allocation.chargeId } });
      if (!charge) continue;
      const newPaid = charge.paidMinor - allocation.amountMinor;
      await tx.charge.update({
        where: { id: charge.id },
        data: {
          paidMinor: newPaid < 0n ? 0n : newPaid,
          status: newPaid <= 0n ? 'open' : newPaid >= charge.amountMinor ? 'paid' : 'partial',
        },
      });
    }

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'reversed',
        notes: [payment.notes, `Reversed: ${params.reason}`].filter(Boolean).join('\n'),
      },
    });

    await recordAudit(tx, {
      organizationId: payment.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'reversal',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: 'reversed', reason: params.reason, ledgerEntryId: reversal.id },
    });

    return updated;
  });
}
