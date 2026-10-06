import { Router } from 'express';
import { z } from 'zod';
import { portalRequestSchema, portalVerifySchema, uuidSchema } from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { businessRule, notFound } from '../lib/errors.js';
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
        tenant: { id: tenant.id, fullName: tenant.fullName, organizationId },
        role: 'tenant',
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

    const open = await prisma.charge.groupBy({
      by: ['status'],
      where: {
        tenantId: tenant.id,
        organizationId: tenant.organizationId,
        status: { in: ['pending', 'overdue'] },
      },
      _sum: { amountMinor: true },
    });
    const dueMinor = open.reduce((sum, row) => sum + (row._sum.amountMinor ?? BigInt(0)), BigInt(0));

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
