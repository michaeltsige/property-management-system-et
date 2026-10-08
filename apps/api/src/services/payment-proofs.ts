/**
 * Proof of payment: the tenant uploads a bank slip or cheque photo from the
 * portal, staff review it, and approving it records the actual payment.
 *
 * The file is a normal `Document` (category `payment_proof`) stored through the
 * regular storage driver; the `PaymentProof` row carries the review state. The
 * payment itself is recorded through `recordPaymentInTx` inside the approval
 * transaction, so a proof can never end up approved without its payment, and
 * two staff members approving simultaneously cannot record the money twice.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { type Money, type PaymentMethod } from '@pms/shared';

import { businessRule, conflict, notFound } from '../lib/errors.js';
import { getStorageDriver } from '../storage/index.js';
import { recordAudit } from './audit.js';
import { recordPaymentInTx } from './payments.js';

const MAX_SERIALIZATION_RETRIES = 3;

export interface PaymentProofView {
  id: string;
  organizationId: string;
  tenantId: string;
  leaseId: string | null;
  documentId: string;
  amountMinor: string;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  paymentId: string | null;
  createdAt: string;
  tenant?: { id: string; fullName: string; phone: string | null };
  document?: { id: string; filename: string; mimeType: string; sizeBytes: number };
}

interface ProofRow {
  id: string;
  organizationId: string;
  tenantId: string;
  leaseId: string | null;
  documentId: string;
  amountMinor: bigint;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  paymentId: string | null;
  createdAt: Date;
  document?: { id: string; title: string | null; mimeType: string; sizeBytes: bigint } | null;
  tenant?: { id: string; fullName: string; phone: string | null } | null;
}

function serialize(proof: ProofRow): PaymentProofView {
  return {
    id: proof.id,
    organizationId: proof.organizationId,
    tenantId: proof.tenantId,
    leaseId: proof.leaseId ?? null,
    documentId: proof.documentId,
    amountMinor: proof.amountMinor.toString(),
    currency: proof.currency,
    method: proof.method,
    reference: proof.reference ?? null,
    notes: proof.notes ?? null,
    status: proof.status,
    reviewedAt: proof.reviewedAt ? proof.reviewedAt.toISOString() : null,
    reviewNotes: proof.reviewNotes ?? null,
    paymentId: proof.paymentId ?? null,
    createdAt: proof.createdAt.toISOString(),
    ...(proof.tenant ? { tenant: proof.tenant } : {}),
    ...(proof.document
      ? {
          document: {
            id: proof.document.id,
            filename: proof.document.title ?? proof.document.id,
            mimeType: proof.document.mimeType,
            sizeBytes: Number(proof.document.sizeBytes),
          },
        }
      : {}),
  };
}

export async function uploadPaymentProof(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    tenantId: string;
    actorUserId?: string | null;
    amount: Money;
    method: PaymentMethod;
    reference?: string | null;
    notes?: string | null;
    filename: string;
    mimeType: string;
    data: Buffer;
    requestId?: string;
  },
): Promise<PaymentProofView> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, organizationId: input.organizationId, deletedAt: null },
    include: { organization: { select: { currency: true } } },
  });
  if (!tenant) throw notFound('Tenant not found in this organization');

  if (input.amount.currency !== tenant.organization.currency) {
    throw businessRule(`Proofs are recorded in ${tenant.organization.currency}`);
  }
  if (input.amount.amountMinor <= 0) throw businessRule('The amount must be greater than zero');

  // The proof is filed against the tenant's current home, mirroring how a
  // portal maintenance request picks its lease.
  const lease = await prisma.lease.findFirst({
    where: { tenantId: tenant.id, organizationId: input.organizationId, status: 'active' },
    select: { id: true },
    orderBy: { startDate: 'desc' },
  });

  // Type and size are validated inside the driver; a rejected upload never
  // reaches the database.
  const stored = await getStorageDriver().save({
    organizationId: input.organizationId,
    filename: input.filename,
    mimeType: input.mimeType,
    data: input.data,
  });

  const proof = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        organizationId: input.organizationId,
        category: 'payment_proof',
        title: input.filename,
        storageDriver: stored.driver,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        checksumSha256: stored.checksumSha256,
        tenantId: tenant.id,
        leaseId: lease?.id ?? null,
        uploadedById: input.actorUserId ?? null,
      },
    });

    const created = await tx.paymentProof.create({
      data: {
        organizationId: input.organizationId,
        tenantId: tenant.id,
        leaseId: lease?.id ?? null,
        documentId: document.id,
        amountMinor: BigInt(input.amount.amountMinor),
        currency: input.amount.currency,
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        status: 'pending',
      },
      include: { document: true, tenant: { select: { id: true, fullName: true, phone: true } } },
    });

    await recordAudit(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: 'create',
      entityType: 'PaymentProof',
      entityId: created.id,
      after: { amountMinor: input.amount.amountMinor, method: input.method, documentId: document.id },
      requestId: input.requestId,
    });

    return created;
  });

  return serialize(proof);
}

export async function listPortalPaymentProofs(
  prisma: PrismaClient,
  params: { organizationId: string; tenantId: string },
): Promise<PaymentProofView[]> {
  const proofs = await prisma.paymentProof.findMany({
    where: { organizationId: params.organizationId, tenantId: params.tenantId },
    include: { document: true, tenant: { select: { id: true, fullName: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return proofs.map(serialize);
}

export async function listPaymentProofs(
  prisma: PrismaClient,
  params: { organizationId: string; status?: string; page?: number; pageSize?: number },
): Promise<{ items: PaymentProofView[]; page: number; pageSize: number; total: number }> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.PaymentProofWhereInput = {
    organizationId: params.organizationId,
    ...(params.status ? { status: params.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.paymentProof.findMany({
      where,
      include: {
        document: true,
        tenant: { select: { id: true, fullName: true, phone: true } },
        lease: { select: { id: true, unit: { select: { label: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.paymentProof.count({ where }),
  ]);
  return {
    items: items.map((proof) => ({
      ...serialize(proof),
      ...(proof.lease ? { leaseId: proof.lease.id } : {}),
    })),
    page,
    pageSize,
    total,
  };
}

export async function approvePaymentProof(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    proofId: string;
    actorUserId?: string | null;
    notes?: string | null;
  },
) {
  for (let attempt = 0; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const proof = await tx.paymentProof.findFirst({
            where: { id: params.proofId, organizationId: params.organizationId },
            include: { tenant: true },
          });
          if (!proof) throw notFound('Proof of payment not found in this organization');
          if (proof.status !== 'pending') {
            throw conflict('This proof has already been reviewed');
          }

          // The money enters the books exactly as a staff-recorded payment does.
          const payment = await recordPaymentInTx({
            organizationId: proof.organizationId,
            actorUserId: params.actorUserId ?? null,
            leaseId: proof.leaseId ?? null,
            tenantId: proof.tenantId,
            amount: { amountMinor: Number(proof.amountMinor), currency: proof.currency },
            method: proof.method as PaymentMethod,
            paidAt: new Date(),
            reference: proof.reference ?? undefined,
            notes: proof.notes ?? undefined,
          })(tx);

          const updated = await tx.paymentProof.update({
            where: { id: proof.id },
            data: {
              status: 'approved',
              reviewedById: params.actorUserId ?? null,
              reviewedAt: new Date(),
              reviewNotes: params.notes ?? null,
              paymentId: payment.paymentId,
            },
            include: { document: true, tenant: { select: { id: true, fullName: true, phone: true } } },
          });

          await recordAudit(tx, {
            organizationId: proof.organizationId,
            actorUserId: params.actorUserId ?? null,
            action: 'update',
            entityType: 'PaymentProof',
            entityId: proof.id,
            before: { status: 'pending' },
            after: { status: 'approved', paymentId: payment.paymentId },
          });

          return { proof: serialize(updated), payment };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (isSerializationFailure && attempt < MAX_SERIALIZATION_RETRIES) continue;
      throw error;
    }
  }
  throw conflict('Could not approve the proof after several attempts; please retry');
}

export async function rejectPaymentProof(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    proofId: string;
    actorUserId?: string | null;
    reason: string;
  },
) {
  const updated = await prisma.$transaction(async (tx) => {
    const proof = await tx.paymentProof.findFirst({
      where: { id: params.proofId, organizationId: params.organizationId },
    });
    if (!proof) throw notFound('Proof of payment not found in this organization');
    if (proof.status !== 'pending') throw conflict('This proof has already been reviewed');

    const result = await tx.paymentProof.update({
      where: { id: proof.id },
      data: {
        status: 'rejected',
        reviewedById: params.actorUserId ?? null,
        reviewedAt: new Date(),
        reviewNotes: params.reason,
      },
      include: { document: true, tenant: { select: { id: true, fullName: true, phone: true } } },
    });

    await recordAudit(tx, {
      organizationId: proof.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: 'update',
      entityType: 'PaymentProof',
      entityId: proof.id,
      before: { status: 'pending' },
      after: { status: 'rejected', reason: params.reason },
    });

    return result;
  });
  return { proof: serialize(updated) };
}

export async function getPortalProofDocument(
  prisma: PrismaClient,
  params: { organizationId: string; tenantId: string; proofId: string },
) {
  const proof = await prisma.paymentProof.findFirst({
    where: {
      id: params.proofId,
      organizationId: params.organizationId,
      tenantId: params.tenantId,
    },
    include: { document: true },
  });
  if (!proof) throw notFound('Proof of payment not found');
  return proof.document;
}
