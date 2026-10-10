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

import { businessRule, conflict, notFound, providerError } from '../lib/errors.js';
import { resolveOrgPaymentProvider } from '../providers/payments/index.js';
import { ProviderNotConfiguredError, type ProviderName } from '../providers/payments/types.js';
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

/** Credit available per currency: the negative part of the ledger balance. */
async function creditByCurrency(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leaseIds: string[],
): Promise<Map<string, bigint>> {
  if (leaseIds.length === 0) return new Map();
  const grouped = await tx.ledgerEntry.groupBy({
    by: ['currency'],
    where: { organizationId, leaseId: { in: leaseIds } },
    _sum: { amountMinor: true },
  });
  const credits = new Map<string, bigint>();
  for (const row of grouped) {
    const balance = row._sum.amountMinor ?? 0n;
    if (balance < 0n) credits.set(row.currency, -balance);
  }
  return credits;
}

/**
 * Apply stranded lease credit to open charges, oldest first, per currency.
 *
 * An overpayment leaves the ledger negative — that IS the credit, but nothing
 * ever spent it: charges stayed open, arrears reports counted them, and the
 * tenant was chased for money they had effectively already given.
 *
 * Mechanics (append-only ledger stays truthful):
 * - the charges' `paidMinor` rises by the applied amount (they are settled),
 * - a `Payment` row with `reference = 'credit-application'` documents it,
 * - one positive `adjustment` ledger entry cancels the negative balance, so
 *   `sum(amountMinor)` still equals the outstanding balance afterwards.
 *
 * Returns the total applied across currencies.
 */
export async function applyLeaseCreditInTx(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; leaseId: string; actorUserId?: string | null; now?: Date },
): Promise<bigint> {
  const now = params.now ?? new Date();
  const credits = await creditByCurrency(tx, params.organizationId, [params.leaseId]);
  let totalApplied = 0n;

  for (const [currency, credit] of credits) {
    if (credit <= 0n) continue;
    const openCharges = await tx.charge.findMany({
      where: {
        organizationId: params.organizationId,
        leaseId: params.leaseId,
        currency,
        status: { in: ['open', 'partial'] },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    let remaining = credit;
    const planned: { chargeId: string; amountMinor: bigint }[] = [];
    for (const charge of openCharges) {
      if (remaining <= 0n) break;
      const outstanding = charge.amountMinor - charge.paidMinor;
      if (outstanding <= 0n) continue;
      const amount = outstanding < remaining ? outstanding : remaining;
      planned.push({ chargeId: charge.id, amountMinor: amount });
      remaining -= amount;
    }
    const applied = planned.reduce((sum, item) => sum + item.amountMinor, 0n);
    if (applied <= 0n) continue;

    const payment = await tx.payment.create({
      data: {
        organizationId: params.organizationId,
        leaseId: params.leaseId,
        amountMinor: applied,
        currency,
        method: 'other',
        status: 'succeeded',
        paidAt: now,
        reference: 'credit-application',
        notes: 'Overpayment credit applied to outstanding charges',
        recordedById: params.actorUserId ?? null,
      },
    });

    for (const item of planned) {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, chargeId: item.chargeId, amountMinor: item.amountMinor },
      });
      const charge = openCharges.find((c) => c.id === item.chargeId);
      if (!charge) continue;
      const newPaid = charge.paidMinor + item.amountMinor;
      await tx.charge.update({
        where: { id: charge.id },
        data: { paidMinor: newPaid, status: newPaid >= charge.amountMinor ? 'paid' : 'partial' },
      });
    }

    // Positive entry: cancels the stranded credit instead of adding a new one.
    await postLedgerEntry(tx, {
      organizationId: params.organizationId,
      leaseId: params.leaseId,
      paymentId: payment.id,
      kind: 'adjustment',
      amountMinor: applied,
      currency,
      occurredAt: now,
      memo: 'Credit from overpayment applied to outstanding charges',
      createdById: params.actorUserId ?? null,
    });

    await recordAudit(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'create',
      entityType: 'Payment',
      entityId: payment.id,
      after: {
        kind: 'credit_application',
        appliedMinor: applied.toString(),
        currency,
        allocations: planned.map((p) => ({ chargeId: p.chargeId, amountMinor: p.amountMinor.toString() })),
      },
    });

    totalApplied += applied;
  }

  return totalApplied;
}

/** Apply credit across every lease of a tenant (portal payment entry point). */
async function applyTenantCreditInTx(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; tenantId: string; actorUserId?: string | null; now?: Date },
): Promise<void> {
  const leases = await tx.lease.findMany({
    where: { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null },
    select: { id: true },
  });
  for (const lease of leases) {
    await applyLeaseCreditInTx(tx, {
      organizationId: params.organizationId,
      leaseId: lease.id,
      actorUserId: params.actorUserId,
      now: params.now,
    });
  }
}

export async function recordPayment(
  prisma: PrismaClient,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  if (input.amount.amountMinor <= 0) throw businessRule('Payment amount must be greater than zero');
  // Without a lease, a tenant, or explicit allocations there is no way to know
  // whose debt this settles — silently picking "the newest active lease" would
  // credit the wrong tenant.
  if (!input.leaseId && !input.tenantId && !input.allocations?.length) {
    throw businessRule('A payment needs a lease, a tenant, or an explicit allocation');
  }

  if (!input.provider && !MANUAL_PAYMENT_METHODS.includes(input.method) && input.method !== 'other') {
    throw businessRule(
      `Method "${input.method}" must be recorded through its payment provider, not as a manual entry`,
    );
  }

  for (let attempt = 0; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(recordPaymentInTx(input), { isolationLevel: 'Serializable' });
    } catch (error) {
      const isSerializationFailure =
        error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2034';
      if (isSerializationFailure && attempt < MAX_SERIALIZATION_RETRIES) continue;
      throw error;
    }
  }
  throw conflict('Could not record the payment after several attempts; please retry');
}

/**
 * The transactional core of recording a payment. Exposed so other flows that
 * must record a payment **inside their own transaction** (approving a proof of
 * payment) share exactly one implementation — two code paths that create
 * payments is how the books drift.
 */
export function recordPaymentInTx(input: RecordPaymentInput) {
  return async (tx: Prisma.TransactionClient): Promise<RecordedPayment> => {
    let lease = input.leaseId
      ? await tx.lease.findFirst({
          where: { id: input.leaseId, organizationId: input.organizationId, deletedAt: null },
        })
      : input.tenantId
        ? await tx.lease.findFirst({
            where: {
              organizationId: input.organizationId,
              tenantId: input.tenantId,
              status: 'active',
            },
            orderBy: { startDate: 'desc' },
          })
        : null;

    if (input.leaseId && !lease) throw notFound('Lease not found in this organization');

    // Allocations identify their own lease when no lease/tenant was stated.
    if (!lease && input.allocations?.length) {
      const firstAllocation = input.allocations[0];
      if (!firstAllocation) throw notFound('Charge not found in this organization');
      const anchor = await tx.charge.findFirst({
        where: { id: firstAllocation.chargeId, organizationId: input.organizationId },
        select: { leaseId: true },
      });
      if (anchor?.leaseId) {
        lease = await tx.lease.findFirst({
          where: { id: anchor.leaseId, organizationId: input.organizationId, deletedAt: null },
        });
      }
    }

    // Spend stranded credit BEFORE the fresh money: an earlier overpayment must
    // clear the oldest charges rather than sit idle while a new payment pays them.
    if (lease) {
      await applyLeaseCreditInTx(tx, {
        organizationId: input.organizationId,
        leaseId: lease.id,
        actorUserId: input.actorUserId,
      });
    } else if (input.tenantId) {
      await applyTenantCreditInTx(tx, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
      });
    }

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
        if (charge.status === 'waived' || charge.status === 'written_off') {
          throw conflict('A waived or written-off charge cannot be paid');
        }
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
      // Count within the SAME clock the receipt year comes from (`paidAt`, not
      // `createdAt`): a backfilled payment is dated in its paid year, and the
      // sequence must continue that year's series, not "now"'s.
      paidAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
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

// ---------------------------------------------------------------------------
// Tenant portal payments
// ---------------------------------------------------------------------------

/**
 * The tenant-facing flow: initiate a provider payment for outstanding charges,
 * then complete it once the provider confirms. Money only enters the books at
 * completion, after the provider has verified the payment — an abandoned or
 * failed attempt leaves nothing but a `pending` row that never touched a charge.
 */
export interface PortalPaymentIntent {
  paymentId: string;
  provider: string;
  providerRef: string;
  redirectUrl?: string;
  amountMinor: string;
  currency: string;
  status: string;
}

/** Outstanding balance for a tenant in the given currency, in minor units. */
export async function tenantDueMinor(
  prisma: PrismaClient,
  params: { organizationId: string; tenantId: string; currency: string },
): Promise<bigint> {
  const open = await prisma.charge.findMany({
    where: {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      currency: params.currency,
      status: { in: ['open', 'partial'] },
    },
    select: { amountMinor: true, paidMinor: true },
  });
  const owed = open.reduce((sum, charge) => sum + (charge.amountMinor - charge.paidMinor), BigInt(0));

  // Credit on the tenant's leases reduces what they can/should pay now.
  const leases = await prisma.lease.findMany({
    where: { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null },
    select: { id: true },
  });
  let credit = 0n;
  if (leases.length > 0) {
    const grouped = await prisma.ledgerEntry.groupBy({
      by: ['currency'],
      where: {
        organizationId: params.organizationId,
        leaseId: { in: leases.map((lease) => lease.id) },
      },
      _sum: { amountMinor: true },
    });
    for (const row of grouped) {
      if (row.currency === params.currency && (row._sum.amountMinor ?? 0n) < 0n) {
        credit = -(row._sum.amountMinor ?? 0n);
      }
    }
  }

  const net = owed - credit;
  return net > 0n ? net : 0n;
}

export async function initiatePortalPayment(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    tenantId: string;
    actorUserId?: string | null;
    /** Requested amount in minor units; omit to pay the full outstanding balance. */
    amountMinor?: bigint;
    /** Web-side return URL the provider sends the payer back to. */
    returnUrl?: string;
  },
): Promise<PortalPaymentIntent> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, organizationId: input.organizationId, deletedAt: null },
    include: { organization: { select: { currency: true } } },
  });
  if (!tenant) throw notFound('Tenant not found in this organization');
  const currency = tenant.organization.currency;

  const due = await tenantDueMinor(prisma, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    currency,
  });
  if (due <= 0n) throw businessRule('Nothing is due on this account right now');

  const amountMinor = input.amountMinor ?? due;
  if (amountMinor <= 0n) throw businessRule('Payment amount must be greater than zero');
  if (amountMinor > due) {
    throw businessRule('The payment cannot exceed the outstanding balance');
  }

  // Double-tap protection that keeps real payments reachable: an identical
  // pending attempt is returned as-is instead of being force-failed. Force-
  // failing it used to strand money the provider had already taken — the old
  // reference could still verify as paid but was no longer completable.
  const existingPending = await prisma.payment.findFirst({
    where: {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      status: 'pending',
      currency,
      amountMinor,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existingPending?.providerRef) {
    const providerCheck = await resolveOrgPaymentProvider(
      prisma,
      input.organizationId,
      existingPending.provider as ProviderName,
    )
      .then((resolved) => resolved.adapter)
      .catch(() => null);
    const stillLive = providerCheck
      ? await providerCheck
          .verify(existingPending.providerRef)
          .then((verification) => verification.status !== 'failed')
          .catch(() => false)
      : false;
    if (stillLive) {
      return {
        paymentId: existingPending.id,
        provider: existingPending.provider ?? '',
        providerRef: existingPending.providerRef,
        redirectUrl: (existingPending.providerPayload as { redirectUrl?: string } | null)?.redirectUrl,
        amountMinor: existingPending.amountMinor.toString(),
        currency: existingPending.currency,
        status: existingPending.status,
      };
    }
    // Dead attempt (expired/failed at the provider): clear it before starting over.
    await prisma.payment.update({
      where: { id: existingPending.id },
      data: { status: 'failed', notes: 'Superseded by a newer payment attempt' },
    });
  }

  // Different amount: the previous attempt no longer matches what the tenant
  // wants to pay, so it is explicitly superseded.
  await prisma.payment.updateMany({
    where: {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      status: 'pending',
    },
    data: { status: 'failed', notes: 'Superseded by a newer payment attempt' },
  });

  // The org's configured gateway decides who runs this payment — the mock demo
  // until real credentials exist, the licensed provider afterwards.
  const { adapter: provider } = await resolveOrgPaymentProvider(prisma, input.organizationId);
  const reference = `portal-${input.tenantId.slice(0, 8)}`;

  let initiation;
  try {
    initiation = await provider.initiate({
      organizationId: input.organizationId,
      reference,
      amount: { amountMinor: Number(amountMinor), currency },
      description: `Rent payment for ${tenant.fullName}`,
      returnUrl: input.returnUrl,
      customer: { fullName: tenant.fullName, phone: tenant.phone ?? undefined },
    });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      throw providerError(error.message, { provider: provider.name });
    }
    throw error;
  }

  const activeLease = await prisma.lease.findFirst({
    where: { tenantId: input.tenantId, organizationId: input.organizationId, status: 'active' },
    select: { id: true },
    orderBy: { startDate: 'desc' },
  });

  const payment = await prisma.payment.create({
    data: {
      organizationId: input.organizationId,
      leaseId: activeLease?.id ?? null,
      tenantId: input.tenantId,
      amountMinor,
      currency,
      // The method mirrors how the money arrived; for the demo adapter that is
      // the mock method, which the payments list labels clearly.
      method: provider.name as PaymentMethod,
      status: 'pending',
      paidAt: new Date(),
      reference,
      provider: provider.name,
      providerRef: initiation.providerRef,
      // redirectUrl is kept so an idempotent re-initiate can send the payer back
      // to the same checkout instead of losing the session.
      providerPayload: {
        redirectUrl: initiation.redirectUrl,
        initiate: initiation.raw,
      } as Prisma.InputJsonValue,
      recordedById: input.actorUserId ?? null,
    },
  });

  await recordAudit(prisma, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: 'initiate',
    entityType: 'Payment',
    entityId: payment.id,
    after: {
      amountMinor: amountMinor.toString(),
      currency,
      provider: provider.name,
      providerRef: initiation.providerRef,
    },
  });

  return {
    paymentId: payment.id,
    provider: provider.name,
    providerRef: initiation.providerRef,
    redirectUrl: initiation.redirectUrl,
    amountMinor: amountMinor.toString(),
    currency,
    status: payment.status,
  };
}

export async function getPortalPaymentIntent(
  prisma: PrismaClient,
  params: { organizationId: string; tenantId: string; providerRef: string },
): Promise<PortalPaymentIntent> {
  const payment = await prisma.payment.findFirst({
    where: {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      providerRef: params.providerRef,
    },
  });
  // Another tenant's reference must look exactly like one that does not exist.
  if (!payment || !payment.providerRef) throw notFound('Payment not found');
  return {
    paymentId: payment.id,
    provider: payment.provider ?? '',
    providerRef: payment.providerRef,
    amountMinor: payment.amountMinor.toString(),
    currency: payment.currency,
    status: payment.status,
  };
}

/**
 * Complete a portal payment: re-verify with the provider, then record the money
 * (allocations oldest-first, ledger entry, receipt number) in one transaction.
 * Safe to retry — a second completion is rejected as a conflict.
 */
export async function completePortalPayment(
  prisma: PrismaClient,
  params: { organizationId: string; tenantId: string; providerRef: string; actorUserId?: string | null },
): Promise<RecordedPayment & { status: string }> {
  const intent = await getPortalPaymentIntent(prisma, params);
  if (intent.status === 'succeeded') throw conflict('This payment has already been completed');
  if (intent.status !== 'pending') {
    throw businessRule('This payment attempt is no longer pending; start a new payment');
  }

  // The intent remembers which provider started it; the adapter resolves with
  // that provider's credentials so a gateway switch can't mix credential sets.
  const { adapter: provider } = await resolveOrgPaymentProvider(
    prisma,
    params.organizationId,
    intent.provider as ProviderName,
  ).catch((error: unknown) => {
    if (error instanceof ProviderNotConfiguredError) {
      throw providerError(error.message, { provider: intent.provider });
    }
    throw error;
  });
  const verification = await provider.verify(intent.providerRef).catch((error: unknown) => {
    throw providerError('Could not verify the payment with the provider', { provider: provider.name }, error);
  });
  if (verification.status !== 'succeeded') {
    throw businessRule('The provider has not confirmed this payment yet');
  }
  const verifiedMinor = verification.amountMinor ? BigInt(verification.amountMinor) : BigInt(intent.amountMinor);
  if (verifiedMinor !== BigInt(intent.amountMinor) || (verification.currency && verification.currency !== intent.currency)) {
    throw businessRule('The verified amount does not match the payment attempt');
  }

  for (let attempt = 0; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(runCompletion(params, verification), {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      const isSerializationFailure =
        error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2034';
      if (isSerializationFailure && attempt < MAX_SERIALIZATION_RETRIES) continue;
      throw error;
    }
  }
  throw conflict('Could not complete the payment after several attempts; please retry');
}

function runCompletion(
  params: { organizationId: string; tenantId: string; providerRef: string; actorUserId?: string | null },
  verification: { paidAt?: Date; raw?: unknown },
) {
  return async (tx: Prisma.TransactionClient): Promise<RecordedPayment & { status: string }> => {
    const payment = await tx.payment.findFirst({
      where: {
        organizationId: params.organizationId,
        tenantId: params.tenantId,
        providerRef: params.providerRef,
      },
    });
    if (!payment) throw notFound('Payment not found');
    if (payment.status === 'succeeded') throw conflict('This payment has already been completed');
    if (payment.status !== 'pending') {
      throw businessRule('This payment attempt is no longer pending; start a new payment');
    }

    // Stranded credit is spent before the provider money, same rule as the
    // manual path — the tenant should not pay for charges their credit covers.
    if (payment.tenantId) {
      await applyTenantCreditInTx(tx, {
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
        actorUserId: params.actorUserId,
      });
    } else if (payment.leaseId) {
      await applyLeaseCreditInTx(tx, {
        organizationId: payment.organizationId,
        leaseId: payment.leaseId,
        actorUserId: params.actorUserId,
      });
    }

    // Oldest open charges first, same rule a cashier's unallocated payment follows.
    const openCharges = await tx.charge.findMany({
      where: {
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
        currency: payment.currency,
        status: { in: ['open', 'partial'] },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    let remaining = payment.amountMinor;
    const planned: { chargeId: string; amountMinor: bigint }[] = [];
    for (const charge of openCharges) {
      if (remaining <= 0n) break;
      const outstanding = charge.amountMinor - charge.paidMinor;
      if (outstanding <= 0n) continue;
      const amount = outstanding < remaining ? outstanding : remaining;
      planned.push({ chargeId: charge.id, amountMinor: amount });
      remaining -= amount;
    }
    const allocated = planned.reduce((sum, item) => sum + item.amountMinor, 0n);

    const paidAt = verification.paidAt ?? new Date();
    const receiptNumber = await nextReceiptNumber(tx, payment.organizationId, paidAt);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'succeeded',
        paidAt,
        receiptNumber,
        providerPayload: {
          initiate: (payment.providerPayload ?? undefined) as Prisma.InputJsonValue | undefined,
          verification: (verification.raw ?? undefined) as Prisma.InputJsonValue | undefined,
        } as Prisma.InputJsonValue,
      },
    });

    for (const item of planned) {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, chargeId: item.chargeId, amountMinor: item.amountMinor },
      });
      const charge = openCharges.find((c) => c.id === item.chargeId);
      if (!charge) continue;
      const newPaid = charge.paidMinor + item.amountMinor;
      await tx.charge.update({
        where: { id: charge.id },
        data: { paidMinor: newPaid, status: newPaid >= charge.amountMinor ? 'paid' : 'partial' },
      });
    }

    await postLedgerEntry(tx, {
      organizationId: payment.organizationId,
      leaseId: payment.leaseId,
      paymentId: payment.id,
      kind: 'payment',
      amountMinor: -payment.amountMinor,
      currency: payment.currency,
      occurredAt: paidAt,
      memo: payment.reference
        ? `Payment (${payment.method}) ref ${payment.reference}`
        : `Payment (${payment.method})`,
      createdById: params.actorUserId ?? null,
    });

    await recordAudit(tx, {
      organizationId: payment.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'complete',
      entityType: 'Payment',
      entityId: payment.id,
      after: {
        amountMinor: payment.amountMinor.toString(),
        method: payment.method,
        receiptNumber,
        allocations: planned.map((p) => ({ chargeId: p.chargeId, amountMinor: p.amountMinor.toString() })),
      },
    });

    return {
      paymentId: payment.id,
      receiptNumber,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      allocatedMinor: allocated,
      unallocatedMinor: payment.amountMinor - allocated,
      allocations: planned,
      status: 'succeeded',
    };
  };
}
