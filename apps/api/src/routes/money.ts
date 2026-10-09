/**
 * Money routes: charges, payments, ledger statements and reversals.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  generateChargesSchema,
  moneySchema,
  paginationSchema,
  paymentProofApprovalSchema,
  paymentProofListQuerySchema,
  paymentProofRejectionSchema,
  recordManualPaymentSchema,
  reverseLedgerEntrySchema,
  uuidSchema,
} from '@pms/shared';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { num, pstr, str } from '../lib/query.js';
import { civilToUtcDate, parsePeriodKey, periodGregorianSpan, type CalendarKind } from '@pms/calendar';
import { balanceMinor, leaseStatement, reverseEntry } from '../services/ledger.js';
import { createDepositCharge, generateCharges, waiveCharge } from '../services/charges.js';
import { recordPayment, reversePayment } from '../services/payments.js';
import { approvePaymentProof, listPaymentProofs, rejectPaymentProof } from '../services/payment-proofs.js';
import { buildPaymentReceipt } from '../services/receipts.js';
import { renderReceiptPdf } from '../lib/pdf.js';

export const moneyRouter = Router();
moneyRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

/** Idempotent: running this twice for the same period creates no duplicate charges. */
moneyRouter.post(
  '/charges/generate',
  requirePermission('charges.write'),
  validate({ body: generateChargesSchema }),
  async (req, res, next) => {
    try {
      const result = await generateCharges(getPrisma(), {
        organizationId: organizationIdOf(req),
        periodKeys: req.body.periodKeys,
        sourceCalendar: req.body.calendar,
        leaseIds: req.body.leaseIds,
        skipNotYetStarted: req.body.skipNotYetStarted,
        actorUserId: req.auth?.userId ?? null,
      });
      res.status(201).json({
        created: result.created,
        skippedExisting: result.skippedExisting,
        skippedOutOfRange: result.skippedOutOfRange,
        charges: result.charges.map((charge) => ({
          ...charge,
          amountMinor: charge.amountMinor.toString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.get(
  '/charges',
  requirePermission('charges.read'),
  validate({
    query: paginationSchema.partial().extend({
      leaseId: uuidSchema.optional(),
      tenantId: uuidSchema.optional(),
      // `overdue` is an alias for "open or partial AND past due" — the sidebar
      // task list filters on it and a 400 here used to brick that panel.
      status: z.enum(['open', 'partial', 'paid', 'waived', 'written_off', 'overdue']).optional(),
      periodKey: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
      /** Which calendar `periodKey` is expressed in; charges may be billed in either. */
      calendar: z.enum(['ethiopian', 'gregorian']).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const page = num(req.query.page, 1);
      const pageSize = num(req.query.pageSize, 25);
      const leaseId = str(req.query.leaseId);
      const tenantId = str(req.query.tenantId);
      const status = str(req.query.status);
      const periodKey = str(req.query.periodKey);
      const calendar = str(req.query.calendar) as CalendarKind | '';

      // A period key only has meaning inside its own calendar, but charges are
      // billed in the LEASE's calendar. So when the caller states which calendar
      // it is looking at (the charges screen now always does), the filter becomes
      // the wall-clock window of that period — a lease billed in the other
      // calendar still lands in it instead of silently disappearing.
      const periodFilter = periodKey
        ? calendar
          ? (() => {
              const span = periodGregorianSpan(parsePeriodKey(periodKey, calendar));
              return { periodStart: { gte: civilToUtcDate(span.from), lte: civilToUtcDate(span.to) } };
            })()
          : { periodKey }
        : {};

      const where = {
        organizationId,
        ...(leaseId ? { leaseId } : {}),
        ...(tenantId ? { tenantId } : {}),
        ...(status === 'overdue'
          ? { status: { in: ['open', 'partial'] }, dueDate: { lt: new Date() } }
          : status
            ? { status }
            : {}),
        ...periodFilter,
      };

      const [items, total] = await Promise.all([
        prisma.charge.findMany({
          where,
          orderBy: [{ dueDate: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.charge.count({ where }),
      ]);

      res.json({ items, page, pageSize, total });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/charges/:chargeId/waive',
  requirePermission('charges.waive'),
  validate({
    params: z.object({ chargeId: uuidSchema }),
    body: z.object({ reason: z.string().min(3).max(500) }),
  }),
  async (req, res, next) => {
    try {
      const charge = await waiveCharge(getPrisma(), {
        organizationId: organizationIdOf(req),
        chargeId: pstr(req, 'chargeId'),
        reason: req.body.reason,
        actorUserId: req.auth?.userId ?? null,
      });
      res.json({ charge });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/leases/:leaseId/deposit-charge',
  requirePermission('charges.write'),
  validate({
    params: z.object({ leaseId: uuidSchema }),
    body: z.object({
      amount: moneySchema,
      dueDate: z.string().datetime({ offset: true }),
    }),
  }),
  async (req, res, next) => {
    try {
      const charge = await createDepositCharge(getPrisma(), {
        organizationId: organizationIdOf(req),
        leaseId: pstr(req, 'leaseId'),
        amountMinor: BigInt(req.body.amount.amountMinor),
        currency: req.body.amount.currency,
        dueDate: new Date(req.body.dueDate),
        actorUserId: req.auth?.userId ?? null,
      });
      res.status(201).json({ charge });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

moneyRouter.get(
  '/leases/:leaseId/statement',
  requirePermission('ledger.read'),
  validate({ params: z.object({ leaseId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const leaseId = pstr(req, 'leaseId');
      const lease = await prisma.lease.findFirst({
        where: { id: leaseId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!lease) throw notFound('Lease not found in this organization');

      const statement = await leaseStatement(prisma, { organizationId, leaseId: lease.id });
      const balance = await balanceMinor(prisma, { organizationId, leaseId: lease.id });

      res.json({
        leaseId: statement.leaseId,
        currency: statement.currency,
        balanceMinor: balance.toString(),
        lines: statement.lines.map((line) => ({
          ...line,
          amountMinor: line.amountMinor.toString(),
          runningBalanceMinor: line.runningBalanceMinor.toString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/ledger/entries/:entryId/reverse',
  requirePermission('payments.reconcile'),
  validate({
    params: z.object({ entryId: uuidSchema }),
    body: reverseLedgerEntrySchema.pick({ reason: true }),
  }),
  async (req, res, next) => {
    try {
      const entry = await reverseEntry(getPrisma(), {
        organizationId: organizationIdOf(req),
        entryId: pstr(req, 'entryId'),
        reason: req.body.reason,
        actorUserId: req.auth?.userId ?? null,
      });
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

moneyRouter.post(
  '/payments',
  requirePermission('payments.record'),
  validate({ body: recordManualPaymentSchema }),
  async (req, res, next) => {
    try {
      const result = await recordPayment(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? null,
        leaseId: req.body.leaseId ?? null,
        tenantId: req.body.tenantId ?? null,
        amount: req.body.amount,
        method: req.body.method,
        paidAt: new Date(req.body.paidAt),
        reference: req.body.reference ?? null,
        notes: req.body.notes ?? null,
        allocations: req.body.allocations,
      });

      res.status(201).json({
        ...result,
        amountMinor: result.amountMinor.toString(),
        allocatedMinor: result.allocatedMinor.toString(),
        unallocatedMinor: result.unallocatedMinor.toString(),
        allocations: result.allocations.map((a) => ({ ...a, amountMinor: a.amountMinor.toString() })),
      });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.get(
  '/payments',
  requirePermission('payments.read'),
  validate({
    query: paginationSchema.partial().extend({
      leaseId: uuidSchema.optional(),
      method: z.string().max(40).optional(),
      status: z.string().max(20).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const page = num(req.query.page, 1);
      const pageSize = num(req.query.pageSize, 25);
      const leaseId = str(req.query.leaseId);
      const method = str(req.query.method);
      const status = str(req.query.status);
      const where = {
        organizationId,
        ...(leaseId ? { leaseId } : {}),
        ...(method ? { method } : {}),
        ...(status ? { status } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { paidAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { allocations: true },
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({ items, page, pageSize, total });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/payments/:paymentId/reverse',
  requirePermission('payments.reverse'),
  validate({
    params: z.object({ paymentId: uuidSchema }),
    body: z.object({ reason: z.string().min(3).max(500) }),
  }),
  async (req, res, next) => {
    try {
      const payment = await reversePayment(getPrisma(), {
        organizationId: organizationIdOf(req),
        paymentId: pstr(req, 'paymentId'),
        reason: req.body.reason,
        actorUserId: req.auth?.userId ?? null,
      });
      res.json({ payment });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Proofs of payment (uploaded by tenants, reviewed by staff)
// ---------------------------------------------------------------------------

moneyRouter.get(
  '/payments/proofs',
  requirePermission('payments.read'),
  validate({ query: paymentProofListQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await listPaymentProofs(getPrisma(), {
        organizationId: organizationIdOf(req),
        status: str(req.query.status) || undefined,
        page: num(req.query.page, 1),
        pageSize: num(req.query.pageSize, 25),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.get(
  '/payments/:paymentId/receipt.pdf',
  requirePermission('payments.read'),
  validate({ params: z.object({ paymentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const receipt = await buildPaymentReceipt(getPrisma(), {
        organizationId: organizationIdOf(req),
        paymentId: pstr(req, 'paymentId'),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
      await renderReceiptPdf(receipt.data, res);
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/payments/proofs/:proofId/approve',
  requirePermission('payments.record'),
  validate({
    params: z.object({ proofId: uuidSchema }),
    body: paymentProofApprovalSchema,
  }),
  async (req, res, next) => {
    try {
      const result = await approvePaymentProof(getPrisma(), {
        organizationId: organizationIdOf(req),
        proofId: pstr(req, 'proofId'),
        actorUserId: req.auth?.userId ?? null,
        notes: req.body.notes ?? null,
      });
      res.json({
        proof: result.proof,
        payment: {
          paymentId: result.payment.paymentId,
          receiptNumber: result.payment.receiptNumber,
          allocatedMinor: result.payment.allocatedMinor.toString(),
          unallocatedMinor: result.payment.unallocatedMinor.toString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

moneyRouter.post(
  '/payments/proofs/:proofId/reject',
  requirePermission('payments.record'),
  validate({
    params: z.object({ proofId: uuidSchema }),
    body: paymentProofRejectionSchema,
  }),
  async (req, res, next) => {
    try {
      const result = await rejectPaymentProof(getPrisma(), {
        organizationId: organizationIdOf(req),
        proofId: pstr(req, 'proofId'),
        actorUserId: req.auth?.userId ?? null,
        reason: req.body.reason,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
