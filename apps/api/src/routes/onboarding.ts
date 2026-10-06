import { Router } from 'express';
import { finishOnboardingSchema, unitLabels } from '@pms/shared';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { businessRule } from '../lib/errors.js';
import { resolveOwner } from '../services/hierarchy.js';
import { recordAudit } from '../services/audit.js';

export const onboardingRouter = Router();
onboardingRouter.post(
  '/organizations/onboarding',
  requireAuth,
  requirePermission('org.settings.manage'),
  validate({ body: finishOnboardingSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const input = finishOnboardingSchema.parse(req.body);
      const result = await getPrisma().$transaction(
        async (tx) => {
          // Durable state and transaction lock make repeated/concurrent submissions safe.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
          const key = { organizationId_key: { organizationId, key: 'onboardingStatus' } };
          const state = await tx.organizationSetting.findUnique({ where: key });
          if (state?.value === 'complete' || state?.value === 'skipped')
            return { status: state.value, replayed: true };
          if (state?.value !== 'portfolio_pending')
            throw businessRule('This organization is not in signup onboarding');
          let propertyId: string | null = null;
          if (input.action === 'create') {
            const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
            let ownerId: string;
            if (org.portfolioMode === 'managed') {
              if (!input.ownerName) throw businessRule('Enter the landlord name for this managed property');
              const owner = await tx.owner.create({ data: { organizationId, name: input.ownerName } });
              ownerId = owner.id;
              await recordAudit(tx, {
                organizationId,
                actorUserId: req.auth?.userId,
                action: 'create',
                entityType: 'Owner',
                entityId: owner.id,
                after: { name: owner.name, source: 'onboarding' },
              });
            } else ownerId = await resolveOwner(tx, organizationId);
            const { address, ...propertyInput } = input.property;
            const { postalCode: _postalCode, ...addressFields } = address ?? {};
            void _postalCode;
            const property = await tx.property.create({
              data: { ...propertyInput, ...addressFields, organizationId, ownerId },
            });
            propertyId = property.id;
            await recordAudit(tx, {
              organizationId,
              actorUserId: req.auth?.userId,
              action: 'create',
              entityType: 'Property',
              entityId: property.id,
              after: { name: property.name, ownerId, source: 'onboarding' },
            });
            if (input.units) {
              const units = await tx.unit.createManyAndReturn({
                data: unitLabels(input.units).map((label) => ({
                  organizationId,
                  propertyId: property.id,
                  label,
                  status: 'vacant',
                  currency: org.currency,
                })),
              });
              for (const unit of units)
                await recordAudit(tx, {
                  organizationId,
                  actorUserId: req.auth?.userId,
                  action: 'create',
                  entityType: 'Unit',
                  entityId: unit.id,
                  after: { label: unit.label, propertyId, source: 'onboarding' },
                });
            }
          }
          const status = input.action === 'skip' ? 'skipped' : 'complete';
          await tx.organizationSetting.update({
            where: key,
            data: { value: status, updatedById: req.auth?.userId },
          });
          await recordAudit(tx, {
            organizationId,
            actorUserId: req.auth?.userId,
            action: 'update',
            entityType: 'OrganizationSetting',
            entityId: organizationId,
            after: { onboardingStatus: status, propertyId },
          });
          return { status, propertyId, replayed: false };
        },
        { timeout: 20000 },
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
