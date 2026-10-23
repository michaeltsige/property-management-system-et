/**
 * Notices — organization announcements posted by staff.
 *
 * A notice is a Telegram-style post: a message body with an optional image,
 * scoped to one property or the whole organization, with an audience of
 * tenants, staff or everyone. Tenants read them through the portal routes in
 * `routes/portal.ts` (`/portal/announcements`); this router is the staff side.
 *
 * The optional image is a `Document` row created through the normal upload
 * route (`POST /documents`), so storage, size limits and magic-byte checks all
 * stay in one place. Serving it here is `inline` (not an attachment) because
 * the UI renders it inside an <img> tag.
 */

import { Router } from 'express';
import { z } from 'zod';
import { noticeCreateSchema, uuidSchema } from '@pms/shared';

import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { pstr } from '../lib/query.js';
import { notFound } from '../lib/errors.js';
import { recordAudit } from '../services/audit.js';
import { getStorageDriver } from '../storage/index.js';

export const noticesRouter = Router();
noticesRouter.use(requireAuth);

/** Inline content types a notice image may carry (documents allow PDF too). */
const NOTICE_IMAGE_MIME_PREFIXES = ['image/', 'application/pdf'];

noticesRouter.get(
  '/',
  requirePermission('notifications.read'),
  validate({ query: z.object({ propertyId: uuidSchema.optional() }).partial() }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const notices = await getPrisma().notice.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(req.query.propertyId ? { propertyId: pstr(req, 'propertyId') } : {}),
        },
        orderBy: { publishedAt: 'desc' },
        take: 100,
        include: {
          property: { select: { id: true, name: true } },
        },
      });
      const authorIds = [...new Set(notices.map((n) => n.authorUserId).filter(Boolean))] as string[];
      const authors = authorIds.length
        ? await getPrisma().user.findMany({ where: { id: { in: authorIds } }, select: { id: true, fullName: true } })
        : [];
      const authorNames = new Map(authors.map((a) => [a.id, a.fullName]));
      res.json({
        items: notices.map((notice) => ({
          id: notice.id,
          title: notice.title,
          body: notice.body,
          propertyId: notice.propertyId,
          property: notice.property ?? null,
          audience: notice.audience,
          imageDocumentId: notice.imageDocumentId,
          publishedAt: notice.publishedAt,
          authorName: notice.authorUserId ? (authorNames.get(notice.authorUserId) ?? null) : null,
        })),
        total: notices.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

noticesRouter.post(
  '/',
  requirePermission('notices.write'),
  validate({ body: noticeCreateSchema }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const { title, body, propertyId, audience, imageDocumentId } = req.body as {
        title?: string;
        body: string;
        propertyId?: string;
        audience: 'tenants' | 'staff' | 'all';
        imageDocumentId?: string;
      };

      const notice = await getPrisma().$transaction(async (tx) => {
        // Referenced rows must belong to this organization — a notice can never
        // point at another org's property or image.
        if (propertyId) {
          const property = await tx.property.findFirst({ where: { id: propertyId, organizationId } });
          if (!property) throw notFound('Property not found in this organization');
        }
        if (imageDocumentId) {
          const image = await tx.document.findFirst({
            where: { id: imageDocumentId, organizationId, deletedAt: null },
          });
          if (!image) throw notFound('Image document not found in this organization');
          if (!NOTICE_IMAGE_MIME_PREFIXES.some((p) => image.mimeType.startsWith(p))) {
            throw notFound('The referenced document is not an image');
          }
        }
        const created = await tx.notice.create({
          data: {
            organizationId,
            title: title ?? null,
            body,
            propertyId: propertyId ?? null,
            audience,
            imageDocumentId: imageDocumentId ?? null,
            authorUserId: req.auth?.userId ?? null,
          },
        });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'create',
          entityType: 'Notice',
          entityId: created.id,
          after: { audience, propertyId: propertyId ?? null, hasImage: Boolean(imageDocumentId) },
          requestId: req.requestId,
        });
        return created;
      });

      res.status(201).json({ notice });
    } catch (error) {
      next(error);
    }
  },
);

noticesRouter.delete(
  '/:noticeId',
  requirePermission('notices.write'),
  validate({ params: z.object({ noticeId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const notice = await getPrisma().$transaction(async (tx) => {
        const existing = await tx.notice.findFirst({
          where: { id: pstr(req, 'noticeId'), organizationId, deletedAt: null },
        });
        if (!existing) throw notFound('Notice not found in this organization');
        const deleted = await tx.notice.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
        await recordAudit(tx, {
          organizationId,
          actorUserId: req.auth?.userId,
          action: 'delete',
          entityType: 'Notice',
          entityId: existing.id,
          before: { title: existing.title, audience: existing.audience },
          requestId: req.requestId,
        });
        return deleted;
      });
      res.json({ notice });
    } catch (error) {
      next(error);
    }
  },
);

/** Inline image for the staff-side preview (<img> in the Notices screen). */
noticesRouter.get(
  '/:noticeId/image',
  requirePermission('documents.read'),
  validate({ params: z.object({ noticeId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const notice = await getPrisma().notice.findFirst({
        where: { id: pstr(req, 'noticeId'), organizationId: organizationIdOf(req), deletedAt: null },
      });
      if (!notice?.imageDocumentId) throw notFound('Notice image not found');
      const document = await getPrisma().document.findFirst({
        where: { id: notice.imageDocumentId, organizationId: organizationIdOf(req), deletedAt: null },
      });
      if (!document) throw notFound('Notice image not found');

      const stream = await getStorageDriver().stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${document.id}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      // A failed read mid-flight must not hang the response: destroy the socket
      // (the status code is already sent once piping starts).
      stream.on('error', (error) => {
        if (res.headersSent) res.destroy(error);
        else next(error);
      });
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);
