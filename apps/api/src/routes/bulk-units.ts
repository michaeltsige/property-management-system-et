import { Router } from 'express';
import { bulkUnitSchema, unitLabelsWithFloors } from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { checkBuilding } from '../services/hierarchy.js';
import { recordAudit } from '../services/audit.js';

export const bulkUnitsRouter = Router();
bulkUnitsRouter.post(
  '/units/bulk',
  requireAuth,
  requirePermission('units.write'),
  validate({ body: bulkUnitSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const input = bulkUnitSchema.parse(req.body);
      // Floor-wise patterns assign each generated unit its floor; a colliding
      // pattern (duplicate labels) is a client error, not a 500.
      let generated;
      try {
        generated = unitLabelsWithFloors(input.naming);
      } catch (error) {
        throw conflict(error instanceof Error ? error.message : 'Invalid naming pattern');
      }
      const labels = generated.map((u) => u.label);
      const units = await getPrisma().$transaction(
        async (tx) => {
          const property = await tx.property.findFirst({
            where: { id: input.propertyId, organizationId, deletedAt: null },
            include: { organization: true },
          });
          if (!property) throw notFound('Property not found in this organization');
          await checkBuilding(tx, organizationId, property.id, input.buildingId);
          const existing = await tx.unit.findMany({
            where: { organizationId, propertyId: property.id, label: { in: labels } },
            select: { label: true },
          });
          // Include soft-deleted labels: the property-wide unique constraint reserves them.
          if (existing.length)
            throw conflict('Some unit labels already exist; no units were created', {
              labels: existing.map((u) => u.label),
            });
          const created = await tx.unit.createManyAndReturn({
            data: generated.map((unit, index) => ({
              organizationId,
              propertyId: property.id,
              buildingId: input.buildingId ?? null,
              label: labels[index]!,
              typeLabel: input.typeLabel ?? null,
              status: 'vacant',
              floor: unit.floor ?? input.floor ?? null,
              bedrooms: input.bedrooms,
              bathrooms: input.bathrooms,
              areaSqm: input.areaSqm,
              notes: input.notes,
              marketRentMinor: input.marketRent ? BigInt(input.marketRent.amountMinor) : null,
              currency: input.marketRent?.currency ?? property.organization.currency,
            })),
          });
          for (const unit of created)
            await recordAudit(tx, {
              organizationId,
              actorUserId: req.auth?.userId,
              action: 'create',
              entityType: 'Unit',
              entityId: unit.id,
              after: {
                label: unit.label,
                propertyId: unit.propertyId,
                buildingId: unit.buildingId,
                source: 'bulk',
              },
              requestId: req.requestId,
            });
          return created;
        },
        { timeout: 20000 },
      );
      res.status(201).json({ units, count: units.length });
    } catch (error) {
      next(error);
    }
  },
);
