/**
 * Organization routes: settings, members, and the tenant ID-type configuration.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  inviteUserSchema,
  organizationSettingsSchema,
  paginationSchema,
  paymentGatewayConfigSchema,
  updateMembershipSchema,
  updateOrganizationProfileSchema,
} from '@pms/shared';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { pstr } from '../lib/query.js';
import { notFound } from '../lib/errors.js';
import { recordAudit } from '../services/audit.js';
import { getPrisma } from '../lib/prisma.js';
import {
  getOrganization,
  getSettings,
  inviteMember,
  listMembers,
  resendInvite,
  updateMembership,
  updateSettings,
} from '../services/organizations.service.js';
import { getGatewayStatus, resetGatewayConfig, saveGatewayConfig } from '../services/gateway.js';
import type { Role } from '@pms/shared';

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.get('/', async (req, res, next) => {
  try {
    const organization = await getOrganization(getPrisma(), organizationIdOf(req));
    res.json({ organization });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.get('/settings', requirePermission('org.read'), async (req, res, next) => {
  try {
    res.json({ settings: await getSettings(getPrisma(), organizationIdOf(req)) });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.patch(
  '/settings',
  requirePermission('org.settings.manage'),
  validate({ body: organizationSettingsSchema }),
  async (req, res, next) => {
    try {
      const settings = await updateSettings(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
        patch: req.body,
      });
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.get(
  '/members',
  requirePermission('users.read'),
  validate({ query: paginationSchema.partial() }),
  async (req, res, next) => {
    try {
      res.json({ members: await listMembers(getPrisma(), organizationIdOf(req)) });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.post(
  '/members',
  requirePermission('users.invite'),
  validate({ body: inviteUserSchema }),
  async (req, res, next) => {
    try {
      const result = await inviteMember(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
        email: req.body.email,
        role: req.body.role as Role,
        fullName: req.body.fullName,
      });
      // The invite token is shown once so staff can hand it to the invitee;
      // it is stored hashed and can be re-issued via resend-invite.
      res.status(201).json({ membership: result.membership, invite: result.invite });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.post(
  '/members/:membershipId/resend-invite',
  requirePermission('users.invite'),
  validate({ params: z.object({ membershipId: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      const result = await resendInvite(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
        membershipId: pstr(req, 'membershipId'),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.patch(
  '/profile',
  requirePermission('org.settings.manage'),
  validate({ body: updateOrganizationProfileSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Organization not found');
      const updated = await prisma.organization.update({
        where: { id: organizationId },
        data: { name: req.body.name },
      });
      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'update',
        entityType: 'Organization',
        entityId: updated.id,
        before: { name: existing.name },
        after: { name: updated.name },
        requestId: req.requestId,
      });
      res.json({ organization: updated });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.patch(
  '/members/:membershipId',
  requirePermission('users.manage'),
  validate({ params: z.object({ membershipId: z.string().uuid() }), body: updateMembershipSchema }),
  async (req, res, next) => {
    try {
      const membership = await updateMembership(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
        membershipId: pstr(req, 'membershipId'),
        patch: { role: req.body.role as Role | undefined, status: req.body.status },
      });
      res.json({ membership });
    } catch (error) {
      next(error);
    }
  },
);

/** ID document types are organization data, not an enum in code. */
organizationsRouter.get('/id-types', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = organizationIdOf(req);
    const types = await prisma.tenantIdType.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }], isActive: true },
      orderBy: { code: 'asc' },
    });
    res.json({ idTypes: types });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.post(
  '/id-types',
  requirePermission('org.settings.manage'),
  validate({
    body: z.object({
      code: z.string().min(2).max(40),
      label: z.string().min(2).max(80),
      labelAm: z.string().max(80).optional(),
      requiresBackImage: z.boolean().default(false),
    }),
  }),
  async (req, res, next) => {
    try {
      const created = await getPrisma().tenantIdType.create({
        data: {
          organizationId: organizationIdOf(req),
          code: req.body.code,
          label: req.body.label,
          labelAm: req.body.labelAm ?? null,
          requiresBackImage: req.body.requiresBackImage,
        },
      });
      res.status(201).json({ idType: created });
    } catch (error) {
      next(error);
    }
  },
);

// --- payment gateway (per-organization provider configuration) ---------------
// Responses never contain credential values — only set/missing state and a
// `••••last4` hint. See services/gateway.ts for the secret-handling rules.

organizationsRouter.get(
  '/payment-gateway',
  requirePermission('org.read'),
  async (req, res, next) => {
    try {
      res.json({ gateway: await getGatewayStatus(getPrisma(), organizationIdOf(req)) });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.put(
  '/payment-gateway',
  requirePermission('org.settings.manage'),
  validate({ body: paymentGatewayConfigSchema }),
  async (req, res, next) => {
    try {
      const gateway = await saveGatewayConfig(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
        input: req.body,
      });
      res.json({ gateway });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.delete(
  '/payment-gateway',
  requirePermission('org.settings.manage'),
  async (req, res, next) => {
    try {
      const gateway = await resetGatewayConfig(getPrisma(), {
        organizationId: organizationIdOf(req),
        actorUserId: req.auth?.userId ?? '',
      });
      res.json({ gateway });
    } catch (error) {
      next(error);
    }
  },
);
