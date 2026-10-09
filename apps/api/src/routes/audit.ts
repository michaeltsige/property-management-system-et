/**
 * Audit trail reads.
 *
 * Every financial and lease mutation is already written to `AuditLog` inside the
 * same transaction as the change — but there was no way to READ any of it:
 * `audit.read` was granted to roles with nothing to read. This exposes the log
 * with org scoping, filters and pagination. Sensitive cell values are already
 * redacted at write time; reads add no new exposure.
 */

import { Router } from 'express';
import { z } from 'zod';

import { paginationSchema, uuidSchema } from '@pms/shared';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { num, str } from '../lib/query.js';

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get(
  '/audit-logs',
  requirePermission('audit.read'),
  validate({
    query: paginationSchema.partial().extend({
      entityType: z.string().trim().max(60).optional(),
      entityId: uuidSchema.optional(),
      actorUserId: uuidSchema.optional(),
      action: z
        .enum(['create', 'update', 'delete', 'login', 'logout', 'export', 'reversal', 'generate', 'initiate', 'complete'])
        .optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const page = num(req.query.page, 1);
      const pageSize = num(req.query.pageSize, 50);
      const entityType = str(req.query.entityType);
      const entityId = str(req.query.entityId);
      const actorUserId = str(req.query.actorUserId);
      const action = str(req.query.action);
      const from = req.query.from as Date | undefined;
      const to = req.query.to as Date | undefined;

      const where = {
        organizationId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(action ? { action } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { actor: { select: { id: true, email: true, fullName: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        items: items.map((item) => ({
          id: item.id,
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          actor: item.actor
            ? { id: item.actor.id, email: item.actor.email, fullName: item.actor.fullName }
            : null,
          before: item.before,
          after: item.after,
          ipAddress: item.ipAddress,
          requestId: item.requestId,
          createdAt: item.createdAt,
        })),
        page,
        pageSize,
        total,
      });
    } catch (error) {
      next(error);
    }
  },
);
