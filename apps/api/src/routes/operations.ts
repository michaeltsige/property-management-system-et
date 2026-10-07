/**
 * Operations: maintenance work orders, vendors, documents and notifications.
 *
 * These are the day-to-day records that sit next to the ledger. Two rules carry
 * over from the money side: every query is scoped to the caller's organization
 * (a foreign row is a 404, never a 403), and every create/update writes an audit
 * row.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  createVendorSchema,
  createWorkOrderSchema,
  documentListQuerySchema,
  documentUploadSchema,
  sendNotificationSchema,
  updateVendorSchema,
  updateWorkOrderSchema,
  uuidSchema,
  workOrderNoteSchema,
} from '@pms/shared';

import { getPrisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { num, pstr, str } from '../lib/query.js';
import { organizationIdOf } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../services/audit.js';
import { getSmsProvider } from '../providers/sms/index.js';
import { getStorageDriver } from '../storage/index.js';
import { renderTemplate } from '../services/notifications.js';

export const operationsRouter = Router();

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

operationsRouter.post(
  '/vendors',
  requirePermission('vendors.write'),
  validate({ body: createVendorSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const vendor = await getPrisma().vendor.create({
        data: {
          organizationId,
          name: req.body.name,
          category: req.body.category ?? null,
          phone: req.body.phone ?? null,
          email: req.body.email ?? null,
          tinNumber: req.body.tinNumber ?? null,
          notes: req.body.notes ?? null,
        },
      });
      res.status(201).json({ vendor });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.get('/vendors', requirePermission('vendors.read'), async (req, res, next) => {
  try {
    const vendors = await getPrisma().vendor.findMany({
      where: {
        organizationId: organizationIdOf(req),
        ...(str(req.query.category) ? { category: str(req.query.category) } : {}),
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    res.json({ vendors });
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch(
  '/vendors/:vendorId',
  requirePermission('vendors.write'),
  validate({ params: z.object({ vendorId: uuidSchema }), body: updateVendorSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const prisma = getPrisma();
      const existing = await prisma.vendor.findFirst({
        where: { id: pstr(req, 'vendorId'), organizationId },
      });
      if (!existing) throw notFound('Vendor not found in this organization');

      const vendor = await prisma.vendor.update({
        where: { id: existing.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.category !== undefined ? { category: req.body.category } : {}),
          ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
          ...(req.body.email !== undefined ? { email: req.body.email } : {}),
          ...(req.body.tinNumber !== undefined ? { tinNumber: req.body.tinNumber } : {}),
          ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
        },
      });
      res.json({ vendor });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Work orders (maintenance)
// ---------------------------------------------------------------------------

/** Legal status transitions; anything else is refused with a 409. */
const WORK_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  open: ['assigned', 'in_progress', 'on_hold', 'cancelled'],
  assigned: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function nextTicketNumber(organizationId: string, when: Date): Promise<string> {
  const prisma = getPrisma();
  const year = when.getUTCFullYear();
  const count = await prisma.workOrder.count({
    where: {
      organizationId,
      createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
  });
  for (let attempt = count + 1; attempt < count + 50; attempt += 1) {
    const candidate = `WO-${year}-${String(attempt).padStart(6, '0')}`;
    const existing = await prisma.workOrder.findFirst({ where: { organizationId, ticketNumber: candidate } });
    if (!existing) return candidate;
  }
  throw conflict('Could not allocate a work-order ticket number');
}

operationsRouter.post(
  '/work-orders',
  requirePermission('maintenance.write'),
  validate({ body: createWorkOrderSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);

      const property = await prisma.property.findFirst({
        where: { id: req.body.propertyId, organizationId, deletedAt: null },
      });
      if (!property) throw notFound('Property not found in this organization');
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

      // Optional links must belong to the same organization.
      const unitId = req.body.unitId ?? null;
      if (unitId) {
        const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId, deletedAt: null } });
        if (!unit) throw notFound('Unit not found in this organization');
      }
      const tenantId = req.body.reportedByTenantId ?? null;
      if (tenantId) {
        const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId } });
        if (!tenant) throw notFound('Tenant not found in this organization');
      }
      const vendorId = req.body.vendorId ?? null;
      if (vendorId) {
        const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId } });
        if (!vendor) throw notFound('Vendor not found in this organization');
      }

      const ticketNumber = await nextTicketNumber(organizationId, new Date());

      const workOrder = await prisma.$transaction(async (tx) => {
        const created = await tx.workOrder.create({
          data: {
            organizationId,
            propertyId: property.id,
            unitId,
            tenantId,
            vendorId,
            ticketNumber,
            title: req.body.title,
            description: req.body.description ?? null,
            category: req.body.category ?? null,
            priority: req.body.priority,
            status: 'open',
            scheduledFor: req.body.scheduledFor ? new Date(req.body.scheduledFor) : null,
            estimatedCostMinor: req.body.estimatedCost ? BigInt(req.body.estimatedCost.amountMinor) : null,
            currency: req.body.estimatedCost?.currency ?? organization.currency,
            createdById: req.auth?.userId ?? null,
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'WorkOrder',
          entityId: created.id,
          after: { ticketNumber, title: created.title, priority: created.priority, status: created.status },
          requestId: req.requestId,
        });

        return created;
      });

      res.status(201).json({ workOrder });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.get('/work-orders', requirePermission('maintenance.read'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = organizationIdOf(req);
    const page = num(req.query.page, 1);
    const pageSize = num(req.query.pageSize, 25);
    const status = str(req.query.status);
    const priority = str(req.query.priority);
    const propertyId = str(req.query.propertyId);

    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(propertyId ? { propertyId } : {}),
    };

    const [items, total, openCount, urgentCount] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: {
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, label: true } },
          tenant: { select: { id: true, fullName: true } },
          vendor: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { reportedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.workOrder.count({ where }),
      prisma.workOrder.count({
        where: { organizationId, status: { in: ['open', 'assigned', 'in_progress', 'on_hold'] } },
      }),
      prisma.workOrder.count({
        where: { organizationId, priority: 'urgent', status: { notIn: ['completed', 'cancelled'] } },
      }),
    ]);

    res.json({ items, page, pageSize, total, openCount, urgentCount });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get(
  '/work-orders/:workOrderId',
  requirePermission('maintenance.read'),
  validate({ params: z.object({ workOrderId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const workOrder = await getPrisma().workOrder.findFirst({
        where: { id: pstr(req, 'workOrderId'), organizationId: organizationIdOf(req) },
        include: {
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, label: true } },
          tenant: { select: { id: true, fullName: true, phone: true } },
          vendor: true,
          notes: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!workOrder) throw notFound('Work order not found in this organization');
      res.json({ workOrder });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.patch(
  '/work-orders/:workOrderId',
  requirePermission('maintenance.write'),
  validate({ params: z.object({ workOrderId: uuidSchema }), body: updateWorkOrderSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const existing = await prisma.workOrder.findFirst({
        where: { id: pstr(req, 'workOrderId'), organizationId },
      });
      if (!existing) throw notFound('Work order not found in this organization');

      if (req.body.vendorId) {
        const vendor = await prisma.vendor.findFirst({ where: { id: req.body.vendorId, organizationId } });
        if (!vendor) throw notFound('Vendor not found in this organization');
      }

      if (req.body.status && req.body.status !== existing.status) {
        const allowed = WORK_ORDER_TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(req.body.status)) {
          throw conflict(`A work order cannot move from ${existing.status} to ${req.body.status}`);
        }
        if (
          (req.body.status === 'assigned' || req.body.status === 'in_progress') &&
          !req.body.vendorId &&
          !existing.vendorId
        ) {
          throw badRequest('Assign a vendor before starting the work');
        }
      }

      // Closing a request is a conversation with the tenant: the completion
      // note is required and becomes a tenant-visible note on the work order.
      const isClosing =
        !!req.body.status &&
        ['completed', 'cancelled'].includes(req.body.status) &&
        req.body.status !== existing.status;
      const closingNote = (req.body.resolutionNotes ?? '').trim();
      if (isClosing && closingNote.length < 3) {
        throw badRequest('A closing note describing the outcome is required to complete or cancel a request');
      }

      const completedAt =
        req.body.completedAt !== undefined
          ? req.body.completedAt === null
            ? null
            : new Date(req.body.completedAt)
          : req.body.status === 'completed' && existing.completedAt === null
            ? new Date()
            : undefined;

      const workOrder = await prisma.$transaction(async (tx) => {
        const updated = await tx.workOrder.update({
          where: { id: existing.id },
          data: {
            ...(req.body.title !== undefined ? { title: req.body.title } : {}),
            ...(req.body.description !== undefined ? { description: req.body.description } : {}),
            ...(req.body.category !== undefined ? { category: req.body.category } : {}),
            ...(req.body.priority !== undefined ? { priority: req.body.priority } : {}),
            ...(req.body.status !== undefined ? { status: req.body.status } : {}),
            ...(req.body.vendorId !== undefined ? { vendorId: req.body.vendorId ?? null } : {}),
            ...(req.body.scheduledFor !== undefined
              ? { scheduledFor: req.body.scheduledFor ? new Date(req.body.scheduledFor) : null }
              : {}),
            ...(completedAt !== undefined ? { completedAt } : {}),
            ...(req.body.actualCost !== undefined
              ? { actualCostMinor: req.body.actualCost ? BigInt(req.body.actualCost.amountMinor) : null }
              : {}),
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'update',
          entityType: 'WorkOrder',
          entityId: updated.id,
          before: { status: existing.status, priority: existing.priority, vendorId: existing.vendorId },
          after: { status: updated.status, priority: updated.priority, vendorId: updated.vendorId },
          requestId: req.requestId,
        });

        if (isClosing) {
          const actor = req.auth?.userId
            ? await tx.user.findUnique({ where: { id: req.auth.userId }, select: { fullName: true } })
            : null;
          await tx.workOrderNote.create({
            data: {
              organizationId,
              workOrderId: updated.id,
              authorId: req.auth?.userId ?? null,
              authorName: actor?.fullName ?? 'Staff',
              body: closingNote,
              internal: false,
            },
          });
        }

        return updated;
      });

      res.json({ workOrder });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.post(
  '/work-orders/:workOrderId/notes',
  requirePermission('maintenance.write'),
  validate({ params: z.object({ workOrderId: uuidSchema }), body: workOrderNoteSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const workOrder = await prisma.workOrder.findFirst({
        where: { id: pstr(req, 'workOrderId'), organizationId },
        select: { id: true },
      });
      if (!workOrder) throw notFound('Work order not found in this organization');

      const author = req.auth?.userId
        ? await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { fullName: true } })
        : null;
      const note = await prisma.workOrderNote.create({
        data: {
          organizationId,
          workOrderId: workOrder.id,
          authorId: req.auth?.userId ?? null,
          authorName: author?.fullName ?? 'Staff',
          body: req.body.body,
          internal: req.body.internal ?? false,
        },
      });
      res.status(201).json({ note });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

operationsRouter.post(
  '/documents',
  requirePermission('documents.write'),
  validate({ body: documentUploadSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const data = Buffer.from(req.body.dataBase64, 'base64');
      if (data.byteLength === 0) throw badRequest('The uploaded file is empty');

      // Link targets must belong to this organization, otherwise a document could
      // be attached to another organization's lease.
      const links = [
        {
          label: 'property',
          id: req.body.propertyId,
          find: (id: string) =>
            prisma.property.findFirst({ where: { id, organizationId }, select: { id: true } }),
        },
        {
          label: 'unit',
          id: req.body.unitId,
          find: (id: string) =>
            prisma.unit.findFirst({ where: { id, organizationId }, select: { id: true } }),
        },
        {
          label: 'tenant',
          id: req.body.tenantId,
          find: (id: string) =>
            prisma.tenant.findFirst({ where: { id, organizationId }, select: { id: true } }),
        },
        {
          label: 'lease',
          id: req.body.leaseId,
          find: (id: string) =>
            prisma.lease.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } }),
        },
        {
          label: 'charge',
          id: req.body.chargeId,
          find: (id: string) =>
            prisma.charge.findFirst({ where: { id, organizationId }, select: { id: true } }),
        },
      ];
      for (const link of links) {
        if (!link.id) continue;
        const found = await link.find(link.id);
        if (!found) throw notFound(`The ${link.label} was not found in this organization`);
      }

      // Type and size are validated inside the driver; a rejected upload never
      // reaches the database.
      const stored = await getStorageDriver().save({
        organizationId,
        filename: req.body.filename,
        mimeType: req.body.mimeType,
        data,
      });

      const document = await prisma.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            organizationId,
            category: req.body.category,
            title: req.body.title ?? req.body.filename,
            storageDriver: stored.driver,
            storageKey: stored.key,
            mimeType: stored.mimeType,
            sizeBytes: BigInt(stored.sizeBytes),
            checksumSha256: stored.checksumSha256,
            propertyId: req.body.propertyId ?? null,
            unitId: req.body.unitId ?? null,
            tenantId: req.body.tenantId ?? null,
            leaseId: req.body.leaseId ?? null,
            chargeId: req.body.chargeId ?? null,
            uploadedById: req.auth?.userId ?? null,
          },
        });

        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Document',
          entityId: created.id,
          // The filename and checksum are enough to identify the file; contents
          // are never copied into the audit trail.
          after: { category: created.category, title: created.title, sizeBytes: stored.sizeBytes },
          requestId: req.requestId,
        });

        return created;
      });

      res.status(201).json({ document });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.get(
  '/documents',
  requirePermission('documents.read'),
  validate({ query: documentListQuerySchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const page = num(req.query.page, 1);
      const pageSize = num(req.query.pageSize, 25);
      const where = {
        organizationId,
        deletedAt: null,
        ...(str(req.query.category) ? { category: str(req.query.category) } : {}),
        ...(str(req.query.propertyId) ? { propertyId: str(req.query.propertyId) } : {}),
        ...(str(req.query.leaseId) ? { leaseId: str(req.query.leaseId) } : {}),
        ...(str(req.query.tenantId) ? { tenantId: str(req.query.tenantId) } : {}),
        ...(str(req.query.workOrderId) ? { workOrderId: str(req.query.workOrderId) } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.document.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.document.count({ where }),
      ]);

      res.json({ items: items.map(serializeDocument), page, pageSize, total });
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.get(
  '/documents/:documentId/download',
  requirePermission('documents.read'),
  validate({ params: z.object({ documentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const document = await getPrisma().document.findFirst({
        where: { id: pstr(req, 'documentId'), organizationId: organizationIdOf(req), deletedAt: null },
      });
      if (!document) throw notFound('Document not found in this organization');

      const stream = await getStorageDriver().stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.id}${extensionFor(document.mimeType)}"`,
      );
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

operationsRouter.delete(
  '/documents/:documentId',
  requirePermission('documents.write'),
  validate({ params: z.object({ documentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);
      const document = await prisma.document.findFirst({
        where: { id: pstr(req, 'documentId'), organizationId, deletedAt: null },
      });
      if (!document) throw notFound('Document not found in this organization');

      // Soft delete first (history stays), then remove the bytes.
      await prisma.$transaction(async (tx) => {
        await tx.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'delete',
          entityType: 'Document',
          entityId: document.id,
          before: { category: document.category, title: document.title },
          requestId: req.requestId,
        });
      });
      await getStorageDriver().delete(document.storageKey);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return map[mimeType] ?? '';
}

/** File sizes travel as JSON numbers (they are small); money stays a string. */
function serializeDocument<T extends { sizeBytes: bigint }>(
  document: T,
): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
  return { ...document, sizeBytes: Number(document.sizeBytes) };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

operationsRouter.get('/notifications', requirePermission('notifications.read'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = organizationIdOf(req);
    const page = num(req.query.page, 1);
    const pageSize = num(req.query.pageSize, 25);
    const status = str(req.query.status);

    const where = { organizationId, ...(status ? { status } : {}) };
    const [items, total, queued] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { organizationId, status: 'queued' } }),
    ]);

    res.json({ items, page, pageSize, total, queued });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post(
  '/notifications/send',
  requirePermission('notifications.send'),
  validate({ body: sendNotificationSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = organizationIdOf(req);

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

      let phone = req.body.recipientPhone ?? null;
      let email = req.body.recipientEmail ?? null;
      let language = (organization.language ?? 'en') as 'en' | 'am' | 'om' | 'ti';

      if (req.body.tenantId || req.body.leaseId) {
        const tenant = req.body.tenantId
          ? await prisma.tenant.findFirst({ where: { id: req.body.tenantId, organizationId } })
          : await prisma.lease
              .findFirst({
                where: { id: req.body.leaseId, organizationId, deletedAt: null },
                include: { tenant: true },
              })
              .then((lease) => lease?.tenant ?? null);
        if (!tenant) throw notFound('Tenant not found in this organization');
        phone = phone ?? tenant.phone ?? null;
        email = email ?? tenant.email ?? null;
        language = (tenant.language ?? language) as typeof language;
      }

      const channel = req.body.channel;
      if (channel === 'sms' && !phone) throw badRequest('An SMS needs a recipient phone number');
      if (channel === 'email' && !email) throw badRequest('An email needs a recipient address');

      const { body, status: renderStatus } = await renderTemplate(prisma, {
        organizationId,
        templateKey: req.body.templateKey,
        language,
        values: req.body.values,
      });

      const notification = await prisma.notification.create({
        data: {
          organizationId,
          templateKey: req.body.templateKey,
          channel,
          recipientPhone: phone,
          recipientEmail: email,
          language,
          payload: { values: req.body.values, renderedStatus: renderStatus },
          status: 'queued',
        },
      });

      if (channel === 'in_app') {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        res.status(201).json({ notification: { ...notification, status: 'sent' }, body });
        return;
      }

      try {
        const result = await getSmsProvider().send({
          to: phone ?? email ?? '',
          templateKey: req.body.templateKey,
          values: req.body.values,
          language,
        });
        const updated = await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: result.status === 'sent' ? 'sent' : 'failed',
            providerRef: result.providerRef ?? null,
            sentAt: new Date(),
            error: result.status === 'sent' ? null : (result.detail ?? null),
          },
        });
        res.status(201).json({ notification: updated, body });
      } catch (error) {
        // The row already exists, so a provider outage is recorded rather than lost.
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: String(error) },
        });
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);
