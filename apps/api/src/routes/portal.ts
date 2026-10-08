import { Router } from 'express';
import { z } from 'zod';
import {
  portalMaintenanceRequestSchema,
  portalRequestSchema,
  portalVerifySchema,
  uuidSchema,
} from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { badRequest, businessRule, notFound } from '../lib/errors.js';
import { nextTicketNumber } from './operations.js';
import { authRateLimiter } from './auth.js';
import { issueTokens } from '../services/auth.service.js';
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
    // still owed ('open'/'partial'). Summing amountMinor alone would re-count
    // money the tenant already handed over.
    const open = await prisma.charge.findMany({
      where: {
        tenantId: tenant.id,
        organizationId: tenant.organizationId,
        status: { in: ['open', 'partial'] },
      },
      select: { amountMinor: true, paidMinor: true },
    });
    const dueMinor = open.reduce((sum, charge) => sum + (charge.amountMinor - charge.paidMinor), BigInt(0));

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
      dueMinor: dueMinor.toString(),
    });
  } catch (error) {
    next(error);
  }
});

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
