import { Router } from 'express';
import { z } from 'zod';
import {
  portalMaintenanceRequestSchema,
  portalPaymentInitiateSchema,
  portalPaymentProofUploadSchema,
  portalRequestSchema,
  portalVerifySchema,
  uuidSchema,
} from '@pms/shared';
import { getConfig } from '../config.js';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { pstr } from '../lib/query.js';
import { badRequest, businessRule, notFound } from '../lib/errors.js';
import { nextTicketNumber } from './operations.js';
import { authRateLimiter } from './auth.js';
import { issueTokens } from '../services/auth.service.js';
import {
  completePortalPayment,
  getPortalPaymentIntent,
  initiatePortalPayment,
} from '../services/payments.js';
import { buildPaymentReceipt } from '../services/receipts.js';
import { renderReceiptPdf } from '../lib/pdf.js';
import {
  getPortalProofDocument,
  listPortalPaymentProofs,
  uploadPaymentProof,
} from '../services/payment-proofs.js';
import { getStorageDriver } from '../storage/index.js';
import {
  disableTenantPortal,
  enrollTenantPortal,
  normalizePhone,
  requestPortalCode,
  verifyPortalCode,
} from '../services/portal.js';

export const portalRouter = Router();

// --- enrollment (staff side) ------------------------------------------------

portalRouter.post(
  '/tenants/:tenantId/portal',
  requireAuth,
  requirePermission('tenants.write'),
  validate({ params: z.object({ tenantId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const result = await enrollTenantPortal(getPrisma(), {
        organizationId,
        actorUserId: req.auth?.userId ?? '',
        tenantId: String(req.params.tenantId ?? ''),
      });
      res.status(201).json({ enrolled: result.enrolled, replayed: result.replayed ?? false });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.delete(
  '/tenants/:tenantId/portal',
  requireAuth,
  requirePermission('tenants.write'),
  validate({ params: z.object({ tenantId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const result = await disableTenantPortal(getPrisma(), {
        organizationId,
        actorUserId: req.auth?.userId ?? '',
        tenantId: String(req.params.tenantId ?? ''),
      });
      res.json({ enrolled: result.enrolled });
    } catch (error) {
      next(error);
    }
  },
);

// --- OTP login (tenant side) ------------------------------------------------

/**
 * Both unknown and known numbers answer identically, so the endpoint cannot be
 * used to discover who rents in which building.
 */
portalRouter.post(
  '/portal/request-code',
  authRateLimiter,
  validate({ body: portalRequestSchema }),
  async (req, res, next) => {
    try {
      const phone = normalizePhone(req.body.phone);
      if (!phone) throw businessRule('Enter a valid Ethiopian phone number');
      await requestPortalCode(getPrisma(), phone, { requestId: req.requestId });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.post(
  '/portal/verify',
  authRateLimiter,
  validate({ body: portalVerifySchema }),
  async (req, res, next) => {
    try {
      const phone = normalizePhone(req.body.phone);
      if (!phone) throw businessRule('Enter a valid Ethiopian phone number');
      const { tenant, user, organizationId } = await verifyPortalCode(getPrisma(), phone, req.body.code, {
        requestId: req.requestId,
      });
      const tokens = await issueTokens(user.id, organizationId, 'tenant', user.email, false, {
        requestId: req.requestId,
      });
      res.json({
        tokens,
        role: 'tenant',
        // Same identity shape as `/auth/login` so the web session layer can treat
        // a verified OTP exactly like a password sign-in.
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          calendar: user.calendar,
          language: user.language,
        },
        organization: {
          id: tenant.organization.id,
          name: tenant.organization.name,
          slug: tenant.organization.slug,
          calendar: tenant.organization.calendar,
          currency: tenant.organization.currency,
        },
        memberships: [],
        tenant: { id: tenant.id, fullName: tenant.fullName, organizationId },
      });
    } catch (error) {
      next(error);
    }
  },
);

// --- tenant self-service ----------------------------------------------------

portalRouter.get('/portal/me', requireAuth, requirePermission('portal.use'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findFirst({
      where: { userId: req.auth?.userId, organizationId: req.auth?.organizationId, deletedAt: null },
      include: { organization: { select: { currency: true } } },
    });
    if (!tenant) throw notFound('Portal account is not linked to a tenant');

    const leases = await prisma.lease.findMany({
      where: { tenantId: tenant.id, organizationId: tenant.organizationId },
      include: {
        unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
      },
      orderBy: { startDate: 'desc' },
    });

    // Outstanding = amount minus what was already paid, over charges that are
    // still owed ('open'/'partial') in the organization's billing currency —
    // summing across currencies would produce a number in neither.
    const open = await prisma.charge.findMany({
      where: {
        tenantId: tenant.id,
        organizationId: tenant.organizationId,
        currency: tenant.organization.currency,
        status: { in: ['open', 'partial'] },
      },
      select: { amountMinor: true, paidMinor: true },
    });
    const owedMinor = open.reduce((sum, charge) => sum + (charge.amountMinor - charge.paidMinor), BigInt(0));

    // Credit from earlier overpayments lives on the ledger, not on the charges:
    // without netting it here the tenant would be asked to pay twice.
    const leaseIds = leases.map((lease) => lease.id);
    let creditMinor = 0n;
    if (leaseIds.length > 0) {
      const grouped = await prisma.ledgerEntry.groupBy({
        by: ['currency'],
        where: {
          organizationId: tenant.organizationId,
          leaseId: { in: leaseIds },
        },
        _sum: { amountMinor: true },
      });
      for (const row of grouped) {
        if (row.currency === tenant.organization.currency && (row._sum.amountMinor ?? 0n) < 0n) {
          creditMinor = -(row._sum.amountMinor ?? 0n);
        }
      }
    }
    const netDue = owedMinor - creditMinor;

    res.json({
      tenant: {
        id: tenant.id,
        fullName: tenant.fullName,
        phone: tenant.phone,
        language: tenant.language ?? 'en',
      },
      leases: leases.map((lease) => ({
        id: lease.id,
        status: lease.status,
        unit: lease.unit.label,
        property: lease.unit.property.name,
        rentAmountMinor: lease.rentAmountMinor.toString(),
        currency: lease.currency,
        startDate: lease.startDate.toISOString().slice(0, 10),
      })),
      dueMinor: (netDue > 0n ? netDue : 0n).toString(),
      creditMinor: creditMinor.toString(),
      currency: tenant.organization.currency,
    });
  } catch (error) {
    next(error);
  }
});

// --- payments (tenant-initiated, provider-confirmed) ------------------------

/**
 * The browser origin the provider sends the payer back to. PORTAL_RETURN_ORIGIN
 * wins when set (production behind a proxy or custom domain); otherwise the
 * stack is one web app on one origin (CORS_ORIGINS[0]).
 */
function portalReturnUrl(): string {
  const origin =
    getConfig().PORTAL_RETURN_ORIGIN ?? getConfig().CORS_ORIGINS[0] ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/portal/pay/mock`;
}

portalRouter.post(
  '/portal/payments/initiate',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ body: portalPaymentInitiateSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await initiatePortalPayment(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        actorUserId: req.auth?.userId ?? null,
        amountMinor: req.body.amountMinor ? BigInt(req.body.amountMinor) : undefined,
        returnUrl: portalReturnUrl(),
      });
      res.status(201).json(intent);
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payments/:providerRef',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await getPortalPaymentIntent(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
      });
      res.json(intent);
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.post(
  '/portal/payments/:providerRef/complete',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const result = await completePortalPayment(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
        actorUserId: req.auth?.userId ?? null,
      });
      res.json({
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

portalRouter.get(
  '/portal/payments/:providerRef/receipt.pdf',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await getPortalPaymentIntent(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
      });
      const receipt = await buildPaymentReceipt(getPrisma(), {
        organizationId: tenant.organizationId,
        paymentId: intent.paymentId,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
      await renderReceiptPdf(receipt.data, res);
    } catch (error) {
      next(error);
    }
  },
);

// --- proofs of payment (tenant uploads, staff review) -----------------------

portalRouter.post(
  '/portal/payment-proofs',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ body: portalPaymentProofUploadSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const proof = await uploadPaymentProof(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        actorUserId: req.auth?.userId ?? null,
        amount: req.body.amount,
        method: req.body.method,
        reference: req.body.reference ?? null,
        notes: req.body.notes ?? null,
        filename: req.body.filename,
        mimeType: req.body.mimeType,
        data: Buffer.from(req.body.dataBase64, 'base64'),
        requestId: req.requestId,
      });
      res.status(201).json({ proof });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payment-proofs',
  requireAuth,
  requirePermission('portal.pay'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const items = await listPortalPaymentProofs(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
      });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payment-proofs/:proofId/document',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ proofId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const document = await getPortalProofDocument(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        proofId: String(req.params.proofId ?? ''),
      });
      const stream = await getStorageDriver().stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${document.id}"`);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

// --- documents (tenant-visible lease papers) --------------------------------

/**
 * Documents the tenant may see: anything filed directly against them, against
 * their leases, or their units. Categories containing other tenants' data
 * (payment proofs of the house, staff notes) are not exposed through this list;
 * payment proofs keep their own endpoint.
 */
portalRouter.get(
  '/portal/documents',
  requireAuth,
  requirePermission('portal.use'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const leases = await prisma.lease.findMany({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId },
        select: { id: true, unitId: true },
      });

      const documents = await prisma.document.findMany({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          OR: [
            { tenantId: tenant.id },
            { leaseId: { in: leases.map((lease) => lease.id) } },
            { unitId: { in: leases.map((lease) => lease.unitId).filter((id): id is string => Boolean(id)) } },
          ],
        },
        include: {
          property: { select: { name: true } },
          unit: { select: { label: true } },
          lease: { select: { id: true, unit: { select: { label: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({
        items: documents.map((document) => ({
          id: document.id,
          category: document.category,
          title: document.title,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes.toString(),
          property: document.property?.name ?? null,
          unit: document.unit?.label ?? document.lease?.unit.label ?? null,
          createdAt: document.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/documents/:documentId/download',
  requireAuth,
  requirePermission('portal.use'),
  validate({ params: z.object({ documentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const leases = await prisma.lease.findMany({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId },
        select: { id: true, unitId: true },
      });

      // Scope check before the bytes move: a document belongs to this tenant only
      // when it is filed against them, one of their leases, or one of their units.
      const document = await prisma.document.findFirst({
        where: {
          id: pstr(req, 'documentId'),
          organizationId: tenant.organizationId,
          deletedAt: null,
          OR: [
            { tenantId: tenant.id },
            { leaseId: { in: leases.map((lease) => lease.id) } },
            { unitId: { in: leases.map((lease) => lease.unitId).filter((id): id is string => Boolean(id)) } },
          ],
        },
      });
      if (!document) throw notFound('Document not found');

      const storage = getStorageDriver();
      const stream = await storage.stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.title ?? document.id}"`,
      );
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

// --- maintenance requests (tenant-initiated, staff-managed) -----------------

async function portalTenant(
  prisma: ReturnType<typeof getPrisma>,
  req: { auth?: { userId?: string; organizationId?: string } },
) {
  const tenant = await prisma.tenant.findFirst({
    where: { userId: req.auth?.userId, organizationId: req.auth?.organizationId, deletedAt: null },
  });
  if (!tenant) throw notFound('Portal account is not linked to a tenant');
  return tenant;
}

portalRouter.post(
  '/portal/maintenance-requests',
  requireAuth,
  requirePermission('portal.use'),
  validate({ body: portalMaintenanceRequestSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);

      // The request is filed against the tenant's current home: their active
      // lease (most recent one first). Without an active lease there is no
      // unit to attach the request to.
      const lease = await prisma.lease.findFirst({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId, status: 'active' },
        include: { unit: { select: { id: true, propertyId: true } } },
        orderBy: { startDate: 'desc' },
      });
      if (!lease)
        throw badRequest('No active lease found; contact your landlord to file a maintenance request');

      const ticketNumber = await nextTicketNumber(tenant.organizationId, new Date());
      const workOrder = await prisma.workOrder.create({
        data: {
          organizationId: tenant.organizationId,
          propertyId: lease.unit.propertyId,
          unitId: lease.unit.id,
          tenantId: tenant.id,
          ticketNumber,
          title: req.body.title,
          description: req.body.description ?? null,
          status: 'open',
          reportedAt: new Date(),
          createdById: req.auth?.userId ?? null,
        },
        include: {
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, label: true } },
        },
      });
      res.status(201).json({ workOrder });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/maintenance-requests',
  requireAuth,
  requirePermission('portal.use'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const items = await prisma.workOrder.findMany({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId },
        include: {
          unit: { select: { id: true, label: true } },
          property: { select: { id: true, name: true } },
          notes: { where: { internal: false }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { reportedAt: 'desc' },
      });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  },
);
