import { Router } from 'express';
import { z } from 'zod';
import {
  createOwnerSchema,
  updateOwnerSchema,
  createBuildingSchema,
  updateBuildingSchema,
  uuidSchema,
} from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { pstr } from '../lib/query.js';
import { businessRule, notFound } from '../lib/errors.js';
import { recordAudit } from '../services/audit.js';

export const hierarchyRouter = Router();
hierarchyRouter.use(requireAuth);

hierarchyRouter.get(
  '/owners',
  requirePermission('owners.read'),
  validate({ query: z.object({}) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const org = await getPrisma().organization.findUniqueOrThrow({ where: { id: organizationId } });
      const owners = await getPrisma().owner.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
      });
      res.json({ owners, portfolioMode: org.portfolioMode });
    } catch (error) {
      next(error);
    }
  },
);

hierarchyRouter.post(
  '/owners',
  requirePermission('owners.write'),
  validate({ body: createOwnerSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const owner = await getPrisma().$transaction(async (tx) => {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
        if (org.portfolioMode !== 'managed')
          throw businessRule('Additional owners require a managed portfolio');
        const created = await tx.owner.create({ data: { ...req.body, organizationId } });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Owner',
          entityId: created.id,
          after: { name: created.name, managementFeeBps: created.managementFeeBps },
          requestId: req.requestId,
        });
        return created;
      });
      res.status(201).json({ owner });
    } catch (error) {
      next(error);
    }
  },
);

hierarchyRouter.patch(
  '/owners/:ownerId',
  requirePermission('owners.write'),
  validate({ params: z.object({ ownerId: uuidSchema }), body: updateOwnerSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const owner = await getPrisma().$transaction(async (tx) => {
        const existing = await tx.owner.findFirst({ where: { id: pstr(req, 'ownerId'), organizationId } });
        if (!existing) throw notFound('Owner not found in this organization');
        const updated = await tx.owner.update({ where: { id: existing.id }, data: req.body });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Owner',
          entityId: updated.id,
          before: { name: existing.name, managementFeeBps: existing.managementFeeBps },
          after: { name: updated.name, managementFeeBps: updated.managementFeeBps },
          requestId: req.requestId,
        });
        return updated;
      });
      res.json({ owner });
    } catch (error) {
      next(error);
    }
  },
);

hierarchyRouter.get(
  '/buildings',
  requirePermission('properties.read'),
  validate({ query: z.object({ propertyId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const propertyId = String(req.query.propertyId);
      const property = await getPrisma().property.findFirst({
        where: { id: propertyId, organizationId, deletedAt: null },
      });
      if (!property) throw notFound('Property not found in this organization');
      const buildings = await getPrisma().building.findMany({
        where: { organizationId, propertyId },
        orderBy: { name: 'asc' },
      });
      res.json({ buildings });
    } catch (error) {
      next(error);
    }
  },
);

hierarchyRouter.post(
  '/buildings',
  requirePermission('properties.write'),
  validate({ body: createBuildingSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const building = await getPrisma().$transaction(async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: req.body.propertyId, organizationId, deletedAt: null },
        });
        if (!property) throw notFound('Property not found in this organization');
        const created = await tx.building.create({ data: { ...req.body, organizationId } });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Building',
          entityId: created.id,
          after: { name: created.name, propertyId: created.propertyId },
          requestId: req.requestId,
        });
        return created;
      });
      res.status(201).json({ building });
    } catch (error) {
      next(error);
    }
  },
);

hierarchyRouter.patch(
  '/buildings/:buildingId',
  requirePermission('properties.write'),
  validate({ params: z.object({ buildingId: uuidSchema }), body: updateBuildingSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const building = await getPrisma().$transaction(async (tx) => {
        const existing = await tx.building.findFirst({
          where: { id: pstr(req, 'buildingId'), organizationId, property: { deletedAt: null } },
        });
        if (!existing) throw notFound('Building not found in this organization');
        const updated = await tx.building.update({ where: { id: existing.id }, data: req.body });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Building',
          entityId: updated.id,
          before: { name: existing.name },
          after: { name: updated.name },
          requestId: req.requestId,
        });
        return updated;
      });
      res.json({ building });
    } catch (error) {
      next(error);
    }
  },
);
