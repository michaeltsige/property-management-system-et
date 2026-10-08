/**
 * Portfolio routes: properties, units, tenants and leases.
 *
 * Every handler resolves `organizationId` from the authenticated principal and
 * passes it into every query. A record belonging to another organization is
 * indistinguishable from one that does not exist (`notFound`), so the API cannot
 * be used to probe for other organizations' data.
 */

import { Router } from 'express';
import { z } from 'zod';

import { civilToUtcDate, periodForDate, utcDateToCivil, type CalendarKind } from '@pms/calendar';
import {
  createLeaseSchema,
  createPropertySchema,
  createTenantSchema,
  createUnitSchema,
  paginationSchema,
  terminateLeaseSchema,
  updateLeaseSchema,
  updatePropertySchema,
  updateTenantSchema,
  updateUnitSchema,
  setRentByTypeSchema,
  uuidSchema,
} from '@pms/shared';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { businessRule, notFound } from '../lib/errors.js';
import { decryptField, encryptField, lastFour } from '../lib/crypto.js';
import { pstr, str } from '../lib/query.js';
import { getPrisma } from '../lib/prisma.js';
import { balanceMinor, postLedgerEntry } from '../services/ledger.js';
import { createDepositChargeInTx } from '../services/charges.js';
import { getSettings } from '../services/organizations.service.js';
import { resolveOwner, checkBuilding } from '../services/hierarchy.js';
import { recordAudit } from '../services/audit.js';

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

portfolioRouter.post(
  '/properties',
  requirePermission('properties.write'),
  validate({ body: createPropertySchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const { address, ...rest } = req.body;

      const property = await getPrisma().$transaction(async (tx) => {
        const ownerId = await resolveOwner(tx, organizationId, rest.ownerId);
        const created = await tx.property.create({
          data: {
            organizationId,
            ownerId,
            name: rest.name,
            code: rest.code ?? null,
            type: rest.type,
            notes: rest.notes ?? null,
            yearBuilt: rest.yearBuilt ?? null,
            totalFloors: rest.totalFloors ?? null,
            regionCode: address?.regionCode ?? null,
            region: address?.region ?? null,
            cityOrZone: address?.cityOrZone ?? null,
            subCity: address?.subCity ?? null,
            woreda: address?.woreda ?? null,
            kebele: address?.kebele ?? null,
            houseNumber: address?.houseNumber ?? null,
            street: address?.street ?? null,
            landmark: address?.landmark ?? null,
            latitude: address?.latitude ?? null,
            longitude: address?.longitude ?? null,
          },
        });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Property',
          entityId: created.id,
          after: { name: created.name, type: created.type, ownerId: created.ownerId },
          requestId: req.requestId,
        });
        return created;
      });

      res.status(201).json({ property });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.get('/properties', requirePermission('properties.read'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = organizationIdOf(req);
    const properties = await prisma.property.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true } },
        buildings: true,
        units: { where: { deletedAt: null }, select: { id: true, label: true, status: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ properties });
  } catch (error) {
    next(error);
  }
});

portfolioRouter.patch(
  '/properties/:propertyId',
  requirePermission('properties.write'),
  validate({ params: z.object({ propertyId: uuidSchema }), body: updatePropertySchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.property.findFirst({
        where: { id: pstr(req, 'propertyId'), organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Property not found in this organization');

      const { address, ...rest } = req.body;
      const updated = await prisma.$transaction(async (tx) => {
        const ownerId =
          rest.ownerId === undefined ? undefined : await resolveOwner(tx, organizationId, rest.ownerId);
        const property = await tx.property.update({
          where: { id: existing.id },
          data: {
            ...(ownerId !== undefined ? { ownerId } : {}),
            ...(rest.name !== undefined ? { name: rest.name } : {}),
            ...(rest.type !== undefined ? { type: rest.type } : {}),
            ...(rest.status !== undefined ? { status: rest.status } : {}),
            ...(rest.notes !== undefined ? { notes: rest.notes } : {}),
            ...(address
              ? {
                  regionCode: address.regionCode ?? existing.regionCode,
                  cityOrZone: address.cityOrZone ?? existing.cityOrZone,
                  subCity: address.subCity ?? existing.subCity,
                  woreda: address.woreda ?? existing.woreda,
                  kebele: address.kebele ?? existing.kebele,
                  landmark: address.landmark ?? existing.landmark,
                }
              : {}),
          },
        });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Property',
          entityId: property.id,
          before: { name: existing.name, status: existing.status, ownerId: existing.ownerId },
          after: { name: property.name, status: property.status, ownerId: property.ownerId },
          requestId: req.requestId,
        });
        return property;
      });

      res.json({ property: updated });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

portfolioRouter.post(
  '/units',
  requirePermission('units.write'),
  validate({ body: createUnitSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const property = await prisma.property.findFirst({
        where: { id: req.body.propertyId, organizationId, deletedAt: null },
        // The organization's currency is the default for the unit's market rent.
        include: { organization: { select: { currency: true } } },
      });
      if (!property) throw notFound('Property not found in this organization');

      const unit = await prisma.$transaction(async (tx) => {
        await checkBuilding(tx, organizationId, property.id, req.body.buildingId);
        const created = await tx.unit.create({
          data: {
            organizationId,
            propertyId: property.id,
            buildingId: req.body.buildingId ?? null,
            label: req.body.label,
            typeLabel: req.body.typeLabel ?? null,
            floor: req.body.floor ?? null,
            bedrooms: req.body.bedrooms ?? null,
            bathrooms: req.body.bathrooms ?? null,
            areaSqm: req.body.areaSqm ?? null,
            marketRentMinor: req.body.marketRent ? BigInt(req.body.marketRent.amountMinor) : null,
            currency: req.body.marketRent?.currency ?? property.organization?.currency ?? 'ETB',
            status: req.body.status,
            notes: req.body.notes ?? null,
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Unit',
          entityId: created.id,
          after: {
            label: created.label,
            status: created.status,
            propertyId: created.propertyId,
            buildingId: created.buildingId,
          },
          requestId: req.requestId,
        });

        return created;
      });

      res.status(201).json({ unit });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.get('/units', requirePermission('units.read'), async (req, res, next) => {
  try {
    const units = await getPrisma().unit.findMany({
      where: { organizationId: organizationIdOf(req), deletedAt: null },
      include: {
        property: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
      },
      orderBy: [{ propertyId: 'asc' }, { label: 'asc' }],
    });
    res.json({ units });
  } catch (error) {
    next(error);
  }
});

portfolioRouter.patch(
  '/units/rent-by-type',
  requirePermission('units.write'),
  validate({ body: setRentByTypeSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const property = await prisma.property.findFirst({
        where: { id: req.body.propertyId, organizationId, deletedAt: null },
        include: { organization: { select: { currency: true } } },
      });
      if (!property) throw notFound('Property not found in this organization');

      const result = await prisma.unit.updateMany({
        where: {
          organizationId,
          propertyId: property.id,
          typeLabel: req.body.typeLabel,
          deletedAt: null,
        },
        data: {
          marketRentMinor: BigInt(req.body.marketRent.amountMinor),
          currency: req.body.marketRent.currency ?? property.organization?.currency ?? 'ETB',
        },
      });
      if (result.count === 0) throw notFound('No units of this type in the property');

      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'update',
        entityType: 'UnitType',
        entityId: property.id,
        after: {
          typeLabel: req.body.typeLabel,
          marketRentMinor: req.body.marketRent.amountMinor,
          unitsUpdated: result.count,
        },
        requestId: req.requestId,
      });

      res.json({ updated: result.count });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.patch(
  '/units/:unitId',
  requirePermission('units.write'),
  validate({ params: z.object({ unitId: uuidSchema }), body: updateUnitSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.unit.findFirst({
        where: { id: pstr(req, 'unitId'), organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Unit not found in this organization');

      const unit = await prisma.$transaction(async (tx) => {
        await checkBuilding(tx, organizationId, existing.propertyId, req.body.buildingId);
        const updated = await tx.unit.update({
          where: { id: existing.id },
          data: {
            ...(req.body.buildingId !== undefined ? { buildingId: req.body.buildingId } : {}),
            ...(req.body.label !== undefined ? { label: req.body.label } : {}),
            ...(req.body.typeLabel !== undefined ? { typeLabel: req.body.typeLabel || null } : {}),
            ...(req.body.status !== undefined ? { status: req.body.status } : {}),
            ...(req.body.marketRent !== undefined
              ? { marketRentMinor: req.body.marketRent ? BigInt(req.body.marketRent.amountMinor) : null }
              : {}),
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Unit',
          entityId: updated.id,
          before: { label: existing.label, status: existing.status, buildingId: existing.buildingId },
          after: { label: updated.label, status: updated.status, buildingId: updated.buildingId },
          requestId: req.requestId,
        });

        return updated;
      });
      res.json({ unit });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Tenants (ID numbers encrypted at rest)
// ---------------------------------------------------------------------------

portfolioRouter.post(
  '/tenants',
  requirePermission('tenants.write'),
  validate({ body: createTenantSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);

      const tenant = await prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            organizationId,
            fullName: req.body.fullName,
            phone: req.body.phone ?? null,
            altPhone: req.body.altPhone ?? null,
            email: req.body.email ?? null,
            nationality: req.body.nationality ?? null,
            emergencyContactName: req.body.emergencyContactName ?? null,
            emergencyContactPhone: req.body.emergencyContactPhone ?? null,
            employer: req.body.employer ?? null,
            notes: req.body.notes ?? null,
          },
        });

        for (const document of req.body.idDocuments ?? []) {
          await tx.tenantIdDocument.create({
            data: {
              organizationId,
              tenantId: created.id,
              typeCode: document.type,
              numberEncrypted: encryptField(document.number),
              numberLast4: lastFour(document.number),
              issuedBy: document.issuedBy ?? null,
              issuedAt: document.issuedAt ? new Date(document.issuedAt) : null,
              expiresAt: document.expiresAt ? new Date(document.expiresAt) : null,
            },
          });
        }

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Tenant',
          entityId: created.id,
          // Note: ID numbers are never part of the audit snapshot.
          after: { fullName: created.fullName, idDocumentCount: req.body.idDocuments?.length ?? 0 },
          requestId: req.requestId,
        });

        return created;
      });

      res.status(201).json({ tenant });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.get(
  '/tenants',
  requirePermission('tenants.read'),
  validate({ query: paginationSchema.partial() }),
  async (req, res, next) => {
    try {
      const tenants = await getPrisma().tenant.findMany({
        where: {
          organizationId: organizationIdOf(req),
          deletedAt: null,
          ...(str(req.query.search)
            ? { fullName: { contains: str(req.query.search), mode: 'insensitive' as const } }
            : {}),
        },
        orderBy: { fullName: 'asc' },
        take: 200,
      });
      res.json({ tenants });
    } catch (error) {
      next(error);
    }
  },
);

/** ID documents are returned masked; the full number requires `tenants.ids.read`. */
portfolioRouter.get(
  '/tenants/:tenantId/id-documents',
  requirePermission('tenants.read'),
  validate({ params: z.object({ tenantId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const tenant = await prisma.tenant.findFirst({
        where: { id: pstr(req, 'tenantId'), organizationId, deletedAt: null },
      });
      if (!tenant) throw notFound('Tenant not found in this organization');

      const documents = await prisma.tenantIdDocument.findMany({
        where: { organizationId, tenantId: tenant.id },
      });
      res.json({
        documents: documents.map((document) => ({
          id: document.id,
          type: document.typeCode,
          maskedNumber: `****${document.numberLast4}`,
          last4: document.numberLast4,
          issuedBy: document.issuedBy,
          expiresAt: document.expiresAt,
          verifiedAt: document.verifiedAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Reveal one document's full number. `tenants.ids.read` only, and every read is
 * audited: the number is sensitive data and its access must be explainable.
 */
portfolioRouter.get(
  '/tenants/:tenantId/id-documents/:documentId',
  requirePermission('tenants.ids.read'),
  validate({ params: z.object({ tenantId: uuidSchema, documentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const document = await prisma.tenantIdDocument.findFirst({
        where: {
          id: String(req.params.documentId ?? ''),
          tenantId: pstr(req, 'tenantId'),
          organizationId,
        },
        include: { tenant: { select: { deletedAt: true } } },
      });
      if (!document || document.tenant.deletedAt) throw notFound('Document not found in this organization');

      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'read_id',
        entityType: 'TenantIdDocument',
        entityId: document.id,
        // The audit row proves the read happened without storing the number.
        after: { typeCode: document.typeCode, last4: document.numberLast4 },
        requestId: req.requestId,
      });

      res.json({
        document: {
          id: document.id,
          type: document.typeCode,
          number: decryptField(document.numberEncrypted),
          last4: document.numberLast4,
          issuedBy: document.issuedBy,
          issuedAt: document.issuedAt,
          expiresAt: document.expiresAt,
          verifiedAt: document.verifiedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Staff review: mark a document verified (or undo it). `verifiedAt` is the only
 * state this sets; the document itself never changes.
 */
portfolioRouter.post(
  '/tenants/:tenantId/id-documents/:documentId/verification',
  requirePermission('tenants.write'),
  validate({
    params: z.object({ tenantId: uuidSchema, documentId: uuidSchema }),
    body: z.object({ verified: z.boolean() }),
  }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const document = await prisma.tenantIdDocument.findFirst({
        where: {
          id: String(req.params.documentId ?? ''),
          tenantId: pstr(req, 'tenantId'),
          organizationId,
        },
        include: { tenant: { select: { deletedAt: true } } },
      });
      if (!document || document.tenant.deletedAt) throw notFound('Document not found in this organization');

      const verifiedAt = req.body.verified ? new Date() : null;
      const updated = await prisma.tenantIdDocument.update({
        where: { id: document.id },
        data: { verifiedAt },
      });
      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'verify',
        entityType: 'TenantIdDocument',
        entityId: document.id,
        after: { verified: req.body.verified },
        requestId: req.requestId,
      });

      res.json({ document: { id: updated.id, verifiedAt: updated.verifiedAt } });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.patch(
  '/tenants/:tenantId',
  requirePermission('tenants.write'),
  validate({ params: z.object({ tenantId: uuidSchema }), body: updateTenantSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.tenant.findFirst({
        where: { id: pstr(req, 'tenantId'), organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Tenant not found in this organization');

      const tenant = await prisma.$transaction(async (tx) => {
        const updated = await tx.tenant.update({
          where: { id: existing.id },
          data: {
            ...(req.body.fullName !== undefined ? { fullName: req.body.fullName } : {}),
            ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
            ...(req.body.email !== undefined ? { email: req.body.email } : {}),
            ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Tenant',
          entityId: updated.id,
          before: { fullName: existing.fullName },
          after: { fullName: updated.fullName },
          requestId: req.requestId,
        });

        return updated;
      });
      res.json({ tenant });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

portfolioRouter.post(
  '/leases',
  requirePermission('leases.write'),
  validate({ body: createLeaseSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);

      const [unit, tenant] = await Promise.all([
        prisma.unit.findFirst({ where: { id: req.body.unitId, organizationId, deletedAt: null } }),
        prisma.tenant.findFirst({ where: { id: req.body.tenantId, organizationId, deletedAt: null } }),
      ]);
      if (!unit) throw notFound('Unit not found in this organization');
      if (!tenant) throw notFound('Tenant not found in this organization');

      const overlapping = await prisma.lease.findFirst({
        where: {
          organizationId,
          unitId: unit.id,
          deletedAt: null,
          status: { in: ['pending', 'active'] },
        },
      });
      if (overlapping) throw businessRule('This unit already has an active or pending lease');

      const startDate = civilToUtcDate(req.body.startDate);
      const endDate = req.body.endDate ? civilToUtcDate(req.body.endDate) : null;
      if (endDate && endDate <= startDate)
        throw businessRule('The lease end date must be after the start date');

      const depositAmountMinor =
        req.body.depositAmount?.amountMinor ??
        (req.body.depositType === 'months_of_rent' && req.body.depositMonths
          ? Math.round(req.body.rentAmount.amountMinor * req.body.depositMonths)
          : null);

      // The billing calendar is an organization-level owner decision; every
      // lease inherits it instead of picking its own.
      const settings = await getSettings(prisma, organizationId);
      const billingCalendar = settings.defaultBillingCalendar === 'gregorian' ? 'gregorian' : 'ethiopian';

      const lease = await prisma.$transaction(async (tx) => {
        const created = await tx.lease.create({
          data: {
            organizationId,
            unitId: unit.id,
            tenantId: tenant.id,
            billingCalendar,
            status: req.body.status,
            startDate,
            endDate,
            rentAmountMinor: BigInt(req.body.rentAmount.amountMinor),
            currency: req.body.rentAmount.currency,
            billingFrequency: req.body.billingFrequency,
            dueDayOfMonth: req.body.dueDayOfMonth,
            gracePeriodDays: req.body.gracePeriodDays ?? 0,
            lateFeePercent: req.body.lateFeePercent ?? null,
            depositType: req.body.depositType,
            depositMonths: req.body.depositMonths ?? null,
            depositAmountMinor: depositAmountMinor === null ? null : BigInt(depositAmountMinor),
            escalationPercent: req.body.escalationPercent ?? null,
            escalationEveryMonths: req.body.escalationEveryMonths ?? null,
            signedAt: req.body.signedAt ? new Date(req.body.signedAt) : null,
            notes: req.body.notes ?? null,
          },
        });

        for (const coTenantId of req.body.coTenantIds ?? []) {
          const coTenant = await tx.tenant.findFirst({ where: { id: coTenantId, organizationId } });
          if (!coTenant) throw notFound('A co-tenant was not found in this organization');
          await tx.leaseCoTenant.create({ data: { leaseId: created.id, tenantId: coTenantId } });
        }

        if (created.status === 'active') {
          await tx.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } });
        }

        // Deposit becomes a real charge on the same transaction so it cannot be
        // forgotten: the UI already collects it, but without a charge it never
        // appeared in the ledger or arrears.
        if (depositAmountMinor !== null && BigInt(depositAmountMinor) > 0n) {
          await createDepositChargeInTx(tx, {
            organizationId,
            leaseId: created.id,
            amountMinor: BigInt(depositAmountMinor),
            currency: req.body.rentAmount.currency,
            actorUserId: req.auth?.userId ?? null,
            dueDate: startDate,
          });
        }

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Lease',
          entityId: created.id,
          after: {
            unitId: unit.id,
            tenantId: tenant.id,
            billingCalendar: created.billingCalendar,
            rentAmountMinor: created.rentAmountMinor.toString(),
            dueDayOfMonth: created.dueDayOfMonth,
          },
          requestId: req.requestId,
        });

        return created;
      });

      res.status(201).json({ lease });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.get('/leases', requirePermission('leases.read'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = organizationIdOf(req);
    const leases = await prisma.lease.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        unit: { include: { property: { select: { id: true, name: true } } } },
        tenant: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // One aggregate for all leases beats N round-trips; the list can have hundreds.
    const balances = await prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { organizationId, leaseId: { in: leases.map((l) => l.id) } },
      _sum: { amountMinor: true },
    });
    const balanceByLease = new Map(balances.map((b) => [b.leaseId, b._sum.amountMinor ?? 0n]));
    const withBalances = leases.map((lease) => ({
      ...lease,
      balanceMinor: (balanceByLease.get(lease.id) ?? 0n).toString(),
    }));

    res.json({ leases: withBalances });
  } catch (error) {
    next(error);
  }
});

portfolioRouter.get(
  '/leases/:leaseId',
  requirePermission('leases.read'),
  validate({ params: z.object({ leaseId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const lease = await prisma.lease.findFirst({
        where: { id: pstr(req, 'leaseId'), organizationId, deletedAt: null },
        include: {
          unit: { include: { property: true } },
          tenant: true,
          coTenants: { include: { tenant: { select: { id: true, fullName: true } } } },
          charges: { orderBy: { dueDate: 'desc' }, take: 24 },
        },
      });
      if (!lease) throw notFound('Lease not found in this organization');

      const balance = await balanceMinor(prisma, { organizationId, leaseId: lease.id });
      const calendar = lease.billingCalendar as CalendarKind;

      res.json({
        lease,
        balanceMinor: balance.toString(),
        // The client renders in the user's calendar; the server states the facts.
        periodOfToday: periodForDate(utcDateToCivil(new Date(), calendar)),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Terminate a lease.
 *
 * Ends the lease today (or on the given date), frees the unit, and — when a
 * deposit refund is stated — records it as a ledger entry, because money moving
 * back to a tenant belongs in the books, not in a note field.
 */
portfolioRouter.post(
  '/leases/:leaseId/terminate',
  requirePermission('leases.write'),
  validate({ params: z.object({ leaseId: uuidSchema }), body: terminateLeaseSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.lease.findFirst({
        where: { id: pstr(req, 'leaseId'), organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Lease not found in this organization');
      if (existing.status === 'terminated' || existing.status === 'expired') {
        throw businessRule('This lease has already ended');
      }

      const terminatedOn = civilToUtcDate(req.body.terminatedOn);

      const lease = await prisma.$transaction(async (tx) => {
        const updated = await tx.lease.update({
          where: { id: existing.id },
          data: { status: 'terminated', endDate: terminatedOn },
        });

        await tx.unit.update({ where: { id: existing.unitId }, data: { status: 'vacant' } });

        const refundMinor = req.body.depositRefundedAmount?.amountMinor ?? 0;
        if (refundMinor > 0) {
          await postLedgerEntry(tx, {
            organizationId,
            leaseId: existing.id,
            kind: 'adjustment',
            amountMinor: -BigInt(refundMinor),
            currency: req.body.depositRefundedAmount?.currency ?? existing.currency,
            occurredAt: terminatedOn,
            memo: 'Security deposit refunded on termination',
            createdById: req.auth?.userId ?? null,
          });
        }

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Lease',
          entityId: updated.id,
          before: { status: existing.status, endDate: existing.endDate },
          after: {
            status: updated.status,
            endDate: updated.endDate,
            reason: req.body.reason ?? null,
            depositRefundedMinor: refundMinor.toString(),
          },
          requestId: req.requestId,
        });

        return updated;
      });

      res.json({ lease });
    } catch (error) {
      next(error);
    }
  },
);

portfolioRouter.patch(
  '/leases/:leaseId',
  requirePermission('leases.write'),
  validate({ params: z.object({ leaseId: uuidSchema }), body: updateLeaseSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.lease.findFirst({
        where: { id: pstr(req, 'leaseId'), organizationId, deletedAt: null },
      });
      if (!existing) throw notFound('Lease not found in this organization');

      const updated = await prisma.$transaction(async (tx) => {
        const lease = await tx.lease.update({
          where: { id: existing.id },
          data: {
            ...(req.body.rentAmount ? { rentAmountMinor: BigInt(req.body.rentAmount.amountMinor) } : {}),
            ...(req.body.dueDayOfMonth !== undefined ? { dueDayOfMonth: req.body.dueDayOfMonth } : {}),
            ...(req.body.status !== undefined ? { status: req.body.status } : {}),
            ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
            ...(req.body.endDate ? { endDate: civilToUtcDate(req.body.endDate) } : {}),
          },
        });

        // Activating a pending lease must also materialise its deposit; creating
        // the lease as pending is the only path that skipped it.
        const activating = existing.status !== 'active' && lease.status === 'active';
        if (activating && lease.depositAmountMinor !== null && lease.depositAmountMinor > 0n) {
          try {
            await createDepositChargeInTx(tx, {
              organizationId,
              leaseId: lease.id,
              amountMinor: lease.depositAmountMinor,
              currency: lease.currency,
              actorUserId: req.auth?.userId ?? null,
              dueDate: lease.startDate,
            });
          } catch (error) {
            // Already has a deposit (e.g. retried activation) — not a failure.
            const isConflict =
              typeof error === 'object' &&
              error !== null &&
              'statusCode' in error &&
              (error as { statusCode?: number }).statusCode === 409;
            if (!isConflict) throw error;
          }
          await tx.unit.update({ where: { id: lease.unitId }, data: { status: 'occupied' } });
        } else if (lease.status === 'active' && existing.status !== 'active') {
          // No deposit to create but the unit still becomes occupied.
          await tx.unit.update({ where: { id: lease.unitId }, data: { status: 'occupied' } });
        }

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'Lease',
          entityId: lease.id,
          before: { rentAmountMinor: existing.rentAmountMinor.toString(), status: existing.status },
          after: { rentAmountMinor: lease.rentAmountMinor.toString(), status: lease.status },
          requestId: req.requestId,
        });

        return lease;
      });

      res.json({ lease: updated });
    } catch (error) {
      next(error);
    }
  },
);
