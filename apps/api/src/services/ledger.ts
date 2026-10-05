/**
 * The ledger: append-only record of everything that affects a balance.
 *
 * Sign convention
 * ---------------
 * - charges, waivers, write-offs, adjustments: **positive** (money owed)
 * - payments: **negative** (money received)
 * - reversals: the exact negation of the entry they reverse
 *
 * Therefore `sum(amountMinor)` over a lease or charge *is* the outstanding
 * balance. Nothing is ever updated or deleted: a mistake is corrected by posting
 * a reversing entry, which keeps the history auditable.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import type { LedgerEntryKind } from '@pms/shared';

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface LedgerPosting {
  organizationId: string;
  leaseId?: string | null;
  chargeId?: string | null;
  paymentId?: string | null;
  kind: LedgerEntryKind;
  /** Signed amount in minor units, using the convention above. */
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  memo?: string | null;
  createdById?: string | null;
  reversesEntryId?: string | null;
}

export async function postLedgerEntry(tx: PrismaLike, posting: LedgerPosting) {
  if (posting.amountMinor === 0n) {
    throw businessRule('A ledger entry of zero would have no effect and is not written');
  }
  return tx.ledgerEntry.create({
    data: {
      organizationId: posting.organizationId,
      leaseId: posting.leaseId ?? null,
      chargeId: posting.chargeId ?? null,
      paymentId: posting.paymentId ?? null,
      kind: posting.kind,
      amountMinor: posting.amountMinor,
      currency: posting.currency,
      occurredAt: posting.occurredAt,
      memo: posting.memo ?? null,
      createdById: posting.createdById ?? null,
      reversesEntryId: posting.reversesEntryId ?? null,
    },
  });
}

/**
 * Balance of a lease (or `null` scope to check a single charge), in minor units.
 * Positive means the tenant owes money; negative means a credit.
 */
export async function balanceMinor(
  tx: PrismaLike,
  filter: { organizationId: string; leaseId?: string; chargeId?: string },
): Promise<bigint> {
  const result = await tx.ledgerEntry.aggregate({
    where: {
      organizationId: filter.organizationId,
      ...(filter.leaseId ? { leaseId: filter.leaseId } : {}),
      ...(filter.chargeId ? { chargeId: filter.chargeId } : {}),
    },
    _sum: { amountMinor: true },
  });
  return result._sum.amountMinor ?? 0n;
}

export interface ReverseEntryInput {
  organizationId: string;
  entryId: string;
  actorUserId?: string | null;
  reason: string;
  occurredAt?: Date;
}

/**
 * Reverse a posted entry.
 *
 * The reversing entry carries the negated amount and points at the original, so
 * the net effect is zero while both rows remain visible. An entry can only be
 * reversed once — reversing twice would double the refund.
 */
export async function reverseEntry(tx: PrismaLike, input: ReverseEntryInput) {
  const original = await tx.ledgerEntry.findFirst({
    where: { id: input.entryId, organizationId: input.organizationId },
  });
  if (!original) throw notFound('Ledger entry not found in this organization');

  const alreadyReversed = await tx.ledgerEntry.findFirst({ where: { reversesEntryId: original.id } });
  if (alreadyReversed) throw conflict('This entry has already been reversed');

  return postLedgerEntry(tx, {
    organizationId: original.organizationId,
    leaseId: original.leaseId,
    chargeId: original.chargeId,
    paymentId: original.paymentId,
    kind: 'reversal',
    amountMinor: -original.amountMinor,
    currency: original.currency,
    occurredAt: input.occurredAt ?? new Date(),
    memo: `Reversal of ${original.kind} entry ${original.id}: ${input.reason}`,
    createdById: input.actorUserId ?? null,
    reversesEntryId: original.id,
  });
}

export interface StatementLine {
  id: string;
  kind: LedgerEntryKind;
  occurredAt: Date;
  amountMinor: bigint;
  currency: string;
  memo: string | null;
  chargeId: string | null;
  paymentId: string | null;
  runningBalanceMinor: bigint;
}

export interface LeaseStatement {
  leaseId: string;
  currency: string;
  closingBalanceMinor: bigint;
  lines: StatementLine[];
}

/** Chronological statement with a running balance, for the UI and for PDF export. */
export async function leaseStatement(
  tx: PrismaLike,
  params: { organizationId: string; leaseId: string; from?: Date; to?: Date },
): Promise<LeaseStatement> {
  const entries = await tx.ledgerEntry.findMany({
    where: {
      organizationId: params.organizationId,
      leaseId: params.leaseId,
      ...(params.from || params.to
        ? {
            occurredAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  });

  let running = 0n;
  const lines: StatementLine[] = entries.map((entry) => {
    running += entry.amountMinor;
    return {
      id: entry.id,
      kind: entry.kind as LedgerEntryKind,
      occurredAt: entry.occurredAt,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      memo: entry.memo,
      chargeId: entry.chargeId,
      paymentId: entry.paymentId,
      runningBalanceMinor: running,
    };
  });

  return {
    leaseId: params.leaseId,
    currency: entries[0]?.currency ?? 'ETB',
    closingBalanceMinor: running,
    lines,
  };
}
