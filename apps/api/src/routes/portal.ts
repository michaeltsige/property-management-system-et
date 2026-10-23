import { Router, type NextFunction, type Request } from 'express';
import { z } from 'zod';
import { translationManagerRows } from '@pms/i18n';
import type { LanguageCode } from '@pms/calendar';
import {
  portalMaintenanceRequestSchema,
  portalPaymentInitiateSchema,
  portalPaymentProofUploadSchema,
  portalRequestSchema,
  portalVerifySchema,
  uuidSchema,
} from '@pms/shared';
import { getConfig } from '../config.js';
import { organizationIdOf, requireAuth } from '../middleware/context.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { getPrisma } from '../lib/prisma.js';
import { pstr, str } from '../lib/query.js';
import { badRequest, businessRule, notFound, AppError } from '../lib/errors.js';
import { isMultipartRequest, parseMultipartUpload } from '../lib/multipart.js';
import { nextTicketNumber } from './operations.js';
import { authRateLimiter } from './auth.js';
import { issueTokens } from '../services/auth.service.js';
import {
  completePortalPayment,
  getPortalPaymentIntent,
  initiatePortalPayment,
} from '../services/payments.js';
import { buildPaymentReceipt } from '../services/receipts.js';
import { renderReceiptPdf } from '../lib/pdf.js';
import {
  getPortalProofDocument,
  listPortalPaymentProofs,
  uploadPaymentProof,
} from '../services/payment-proofs.js';
import { getStorageDriver } from '../storage/index.js';
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
 * Tenant code request. The owner wants plain feedback: an unregistered phone
 * gets an explicit 404 (translated via `portal.phone_not_registered`) instead
 * of a fake `ok`.
 */
portalRouter.post(
  '/portal/request-code',
  authRateLimiter,
  validate({ body: portalRequestSchema }),
  async (req, res, next) => {
    try {
      const phone = normalizePhone(req.body.phone);
      if (!phone) throw businessRule('Enter a valid Ethiopian phone number');
      const result = await requestPortalCode(getPrisma(), phone, { requestId: req.requestId });
      if (!result.ok && result.reason === 'not_registered') {
        // Owner decision: tell the user plainly instead of pretending success.
        // userMessageKey lets the portal login screen translate it in the
        // tenant's language.
        throw new AppError(404, 'NOT_FOUND', 'This phone number is not registered for the tenant portal', {
          userMessageKey: 'portal.phone_not_registered',
        });
      }
      if (!result.ok && result.reason === 'cooldown') {
        throw new AppError(429, 'RATE_LIMITED', 'A code was requested recently; wait before asking again', {
          details: { retryAfterSeconds: result.retryAfterSeconds },
          userMessageKey: 'auth.too_many_attempts',
        });
      }
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
      include: { organization: { select: { currency: true } } },
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
    // still owed ('open'/'partial') in the organization's billing currency —
    // summing across currencies would produce a number in neither.
    const open = await prisma.charge.findMany({
      where: {
        tenantId: tenant.id,
        organizationId: tenant.organizationId,
        currency: tenant.organization.currency,
        status: { in: ['open', 'partial'] },
      },
      select: { amountMinor: true, paidMinor: true },
    });
    const owedMinor = open.reduce((sum, charge) => sum + (charge.amountMinor - charge.paidMinor), BigInt(0));

    // Credit from earlier overpayments lives on the ledger, not on the charges:
    // without netting it here the tenant would be asked to pay twice.
    const leaseIds = leases.map((lease) => lease.id);
    let creditMinor = 0n;
    if (leaseIds.length > 0) {
      const grouped = await prisma.ledgerEntry.groupBy({
        by: ['currency'],
        where: {
          organizationId: tenant.organizationId,
          leaseId: { in: leaseIds },
        },
        _sum: { amountMinor: true },
      });
      for (const row of grouped) {
        if (row.currency === tenant.organization.currency && (row._sum.amountMinor ?? 0n) < 0n) {
          creditMinor = -(row._sum.amountMinor ?? 0n);
        }
      }
    }
    const netDue = owedMinor - creditMinor;

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
      dueMinor: (netDue > 0n ? netDue : 0n).toString(),
      creditMinor: creditMinor.toString(),
      currency: tenant.organization.currency,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The tenant's own language preference. Persisted on the tenant record so the
 * portal, SMS and letters all follow it; the session cache on the client is
 * refreshed by the caller.
 */
portalRouter.patch(
  '/portal/me/language',
  requireAuth,
  requirePermission('portal.use'),
  validate({ body: z.object({ language: z.enum(['en', 'am', 'om', 'ti']) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const updated = await prisma.tenant.update({
        where: { id: tenant.id },
        data: { language: req.body.language },
        select: { id: true, language: true },
      });
      res.json({ tenant: updated });
    } catch (error) {
      next(error);
    }
  },
);

// --- translations ------------------------------------------------------------

/**
 * Translation overrides for tenant sessions.
 *
 * The staff endpoint (`GET /translations`) requires `translations.read`, which
 * tenants do not hold — every portal page load answered 403 and the tenant
 * silently missed organization-tuned wording. This returns the same rows,
 * scoped behind `portal.use`.
 */
portalRouter.get(
  '/portal/translations',
  requireAuth,
  requirePermission('portal.use'),
  validate({ query: z.object({ language: z.enum(['en', 'am', 'om', 'ti']).default('en') }) }),
  async (req, res, next) => {
    try {
      const organizationId = organizationIdOf(req);
      const language = (str(req.query.language) ?? 'en') as LanguageCode;
      const rows = await getPrisma().translationOverride.findMany({
        where: { OR: [{ organizationId }, { organizationId: null }] },
      });
      const overrides = rows.map((row) => ({
        key: row.key,
        language: row.language as LanguageCode,
        text: row.text,
        organizationId: row.organizationId,
        status: row.status as 'machine_draft' | 'unreviewed' | 'reviewed',
      }));
      res.json({ rows: translationManagerRows(language, { organizationId, overrides }) });
    } catch (error) {
      next(error);
    }
  },
);

// --- rent account statement --------------------------------------------------

/**
 * The tenant's rent account: their charges (rent, utilities, late fees) with
 * what has been paid against each. This is the ledger behind the due balance —
 * showing the lines rather than only the total answers "what am I paying for?"
 * without exposing anyone else's records.
 */
portalRouter.get('/portal/charges', requireAuth, requirePermission('portal.use'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const tenant = await portalTenant(prisma, req);
    const charges = await prisma.charge.findMany({
      where: { tenantId: tenant.id, organizationId: tenant.organizationId },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 48,
      select: {
        id: true,
        type: true,
        description: true,
        periodKey: true,
        periodCalendar: true,
        dueDate: true,
        amountMinor: true,
        paidMinor: true,
        status: true,
        currency: true,
      },
    });
    res.json({
      items: charges.map((charge) => ({
        id: charge.id,
        type: charge.type,
        description: charge.description,
        periodKey: charge.periodKey,
        periodCalendar: charge.periodCalendar,
        dueDate: charge.dueDate.toISOString().slice(0, 10),
        amountMinor: charge.amountMinor.toString(),
        paidMinor: charge.paidMinor.toString(),
        status: charge.status,
        currency: charge.currency,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// --- payment history (tenant-visible) ----------------------------------------

/** Every payment recorded against this tenant, newest first — manual records,
 * online payments and portal payments alike. Receipts download per payment. */
portalRouter.get('/portal/payments', requireAuth, requirePermission('portal.pay'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const tenant = await portalTenant(prisma, req);
    const payments = await prisma.payment.findMany({
      where: { tenantId: tenant.id, organizationId: tenant.organizationId, status: 'succeeded' },
      orderBy: { paidAt: 'desc' },
      take: 60,
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        method: true,
        status: true,
        paidAt: true,
        reference: true,
        receiptNumber: true,
        notes: true,
      },
    });
    res.json({
      items: payments.map((payment) => ({
        id: payment.id,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        paidAt: payment.paidAt.toISOString(),
        reference: payment.reference,
        receiptNumber: payment.receiptNumber,
        notes: payment.notes,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** The receipt PDF for one of the tenant's own payments. */
portalRouter.get(
  '/portal/payments/by-id/:paymentId/receipt.pdf',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ paymentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      // Scope check before the bytes move: only this tenant's payments.
      const payment = await prisma.payment.findFirst({
        where: {
          id: String(req.params.paymentId ?? ''),
          tenantId: tenant.id,
          organizationId: tenant.organizationId,
        },
        select: { id: true },
      });
      if (!payment) throw notFound('Payment not found');
      const receipt = await buildPaymentReceipt(getPrisma(), {
        organizationId: tenant.organizationId,
        paymentId: payment.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
      await renderReceiptPdf(receipt.data, res);
    } catch (error) {
      next(error);
    }
  },
);

// --- notices (in-app, tenant-visible) -----------------------------------------

/**
 * In-app notices for the signed-in tenant: rent reminders, receipts and
 * announcements the organization sent them. Body text lives on the i18n layer —
 * the web client translates `templateKey` with `payload` as values, the same
 * contract the SMS renderer uses.
 */
portalRouter.get('/portal/notices', requireAuth, requirePermission('portal.use'), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const tenant = await portalTenant(prisma, req);
    const notices = await prisma.notification.findMany({
      where: {
        organizationId: tenant.organizationId,
        recipientUserId: req.auth?.userId,
        channel: 'in_app',
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, templateKey: true, payload: true, createdAt: true, status: true },
    });
    res.json({
      items: notices.map((notice) => ({
        id: notice.id,
        templateKey: notice.templateKey,
        payload: notice.payload,
        createdAt: notice.createdAt,
        status: notice.status,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// --- announcements (staff-posted notices, Telegram-style) ---------------------

/**
 * Staff-posted announcements visible to the signed-in tenant: audience
 * `tenants` or `all`, organization-wide or scoped to a property the tenant
 * leases. `imageUrl` is a same-origin path the portal UI can put straight into
 * an <img> tag (the image endpoint below authorizes via the session cookie).
 */
portalRouter.get(
  '/portal/announcements',
  requireAuth,
  requirePermission('portal.use'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const leaseUnits = await prisma.lease.findMany({
        where: { organizationId: tenant.organizationId, tenantId: tenant.id, deletedAt: null },
        select: { unit: { select: { propertyId: true } } },
        distinct: ['unitId'],
      });
      const propertyIds = leaseUnits
        .map((lease) => lease.unit?.propertyId)
        .filter((id): id is string => Boolean(id));
      const announcements = await prisma.notice.findMany({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          audience: { in: ['tenants', 'all'] },
          OR: [{ propertyId: null }, ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])],
        },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      });
      const authors = announcements.some((a) => a.authorUserId)
        ? await prisma.user.findMany({
            where: {
              id: {
                in: [
                  ...new Set(
                    announcements
                      .map((a) => a.authorUserId)
                      .filter((id): id is string => Boolean(id)),
                  ),
                ],
              },
            },
            select: { id: true, fullName: true },
          })
        : [];
      const authorNames = new Map(authors.map((a) => [a.id, a.fullName]));
      res.json({
        items: announcements.map((announcement) => ({
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          propertyId: announcement.propertyId,
          imageUrl: announcement.imageDocumentId
            ? `/portal/announcements/${announcement.id}/image`
            : null,
          publishedAt: announcement.publishedAt,
          authorName: announcement.authorUserId
            ? (authorNames.get(announcement.authorUserId) ?? null)
            : null,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Inline image for a tenant-visible announcement (<img> in the portal). */
portalRouter.get(
  '/portal/announcements/:noticeId/image',
  requireAuth,
  requirePermission('portal.use'),
  validate({ params: z.object({ noticeId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const announcement = await prisma.notice.findFirst({
        where: {
          id: pstr(req, 'noticeId'),
          organizationId: tenant.organizationId,
          deletedAt: null,
          audience: { in: ['tenants', 'all'] },
        },
      });
      if (!announcement?.imageDocumentId) throw notFound('Notice image not found');
      const document = await prisma.document.findFirst({
        where: { id: announcement.imageDocumentId, organizationId: tenant.organizationId, deletedAt: null },
      });
      if (!document) throw notFound('Notice image not found');

      const stream = await getStorageDriver().stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${document.id}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
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

// --- payments (tenant-initiated, provider-confirmed) ------------------------

/**
 * The browser origin the provider sends the payer back to. PORTAL_RETURN_ORIGIN
 * wins when set (production behind a proxy or custom domain); otherwise the
 * stack is one web app on one origin (CORS_ORIGINS[0]).
 */
function portalReturnUrl(): string {
  const origin =
    getConfig().PORTAL_RETURN_ORIGIN ?? getConfig().CORS_ORIGINS[0] ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/portal/pay/mock`;
}

portalRouter.post(
  '/portal/payments/initiate',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ body: portalPaymentInitiateSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await initiatePortalPayment(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        actorUserId: req.auth?.userId ?? null,
        amountMinor: req.body.amountMinor ? BigInt(req.body.amountMinor) : undefined,
        returnUrl: portalReturnUrl(),
      });
      res.status(201).json(intent);
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payments/:providerRef',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await getPortalPaymentIntent(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
      });
      res.json(intent);
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.post(
  '/portal/payments/:providerRef/complete',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const result = await completePortalPayment(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
        actorUserId: req.auth?.userId ?? null,
      });
      res.json({
        ...result,
        amountMinor: result.amountMinor.toString(),
        allocatedMinor: result.allocatedMinor.toString(),
        unallocatedMinor: result.unallocatedMinor.toString(),
        allocations: result.allocations.map((a) => ({ ...a, amountMinor: a.amountMinor.toString() })),
      });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payments/:providerRef/receipt.pdf',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ providerRef: z.string().min(6).max(120) }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const intent = await getPortalPaymentIntent(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        providerRef: String(req.params.providerRef ?? ''),
      });
      const receipt = await buildPaymentReceipt(getPrisma(), {
        organizationId: tenant.organizationId,
        paymentId: intent.paymentId,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
      await renderReceiptPdf(receipt.data, res);
    } catch (error) {
      next(error);
    }
  },
);

// --- proofs of payment (tenant uploads, staff review) -----------------------

/**
 * Multipart upload support for payment proofs (phone cameras): the parsed file
 * and fields are re-expressed as the same JSON body the route already
 * validates, so the storage/limits path stays single.
 */
async function attachMultipartPaymentProofBody(
  req: Request,
  _res: unknown,
  next: NextFunction,
) {
  try {
    if (!isMultipartRequest(req)) return next();
    const { fields, file } = await parseMultipartUpload(req, {
      maxBytes: getConfig().MAX_UPLOAD_BYTES,
    });
    if (!file) throw badRequest('Attach the file in the "file" field');
    if (file.data.byteLength === 0) throw badRequest('The uploaded file is empty');
    req.body = {
      amount: {
        amountMinor: Number(fields.amountMinor ?? Number.NaN),
        currency: fields.currency ?? 'ETB',
      },
      method: fields.method ?? '',
      ...(fields.reference ? { reference: fields.reference } : {}),
      ...(fields.notes ? { notes: fields.notes } : {}),
      filename: file.filename || 'upload',
      mimeType: file.mimeType || 'application/octet-stream',
      dataBase64: file.data.toString('base64'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

portalRouter.post(
  '/portal/payment-proofs',
  requireAuth,
  requirePermission('portal.pay'),
  attachMultipartPaymentProofBody,
  validate({ body: portalPaymentProofUploadSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const proof = await uploadPaymentProof(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        actorUserId: req.auth?.userId ?? null,
        amount: req.body.amount,
        method: req.body.method,
        reference: req.body.reference ?? null,
        notes: req.body.notes ?? null,
        filename: req.body.filename,
        mimeType: req.body.mimeType,
        data: Buffer.from(req.body.dataBase64, 'base64'),
        requestId: req.requestId,
      });
      res.status(201).json({ proof });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payment-proofs',
  requireAuth,
  requirePermission('portal.pay'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const items = await listPortalPaymentProofs(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
      });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/payment-proofs/:proofId/document',
  requireAuth,
  requirePermission('portal.pay'),
  validate({ params: z.object({ proofId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const document = await getPortalProofDocument(prisma, {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        proofId: String(req.params.proofId ?? ''),
      });
      const stream = await getStorageDriver().stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${document.id}"`);
      // A read that fails mid-flight must not hang the response.
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

// --- documents (tenant-visible lease papers) --------------------------------

/**
 * Documents the tenant may see: anything filed directly against them, against
 * their leases, or their units. Categories containing other tenants' data
 * (payment proofs of the house, staff notes) are not exposed through this list;
 * payment proofs keep their own endpoint.
 */
portalRouter.get(
  '/portal/documents',
  requireAuth,
  requirePermission('portal.use'),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const leases = await prisma.lease.findMany({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId },
        select: { id: true, unitId: true },
      });

      const documents = await prisma.document.findMany({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          OR: [
            { tenantId: tenant.id },
            { leaseId: { in: leases.map((lease) => lease.id) } },
            { unitId: { in: leases.map((lease) => lease.unitId).filter((id): id is string => Boolean(id)) } },
          ],
        },
        include: {
          property: { select: { name: true } },
          unit: { select: { label: true } },
          lease: { select: { id: true, unit: { select: { label: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({
        items: documents.map((document) => ({
          id: document.id,
          category: document.category,
          title: document.title,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes.toString(),
          property: document.property?.name ?? null,
          unit: document.unit?.label ?? document.lease?.unit.label ?? null,
          createdAt: document.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

portalRouter.get(
  '/portal/documents/:documentId/download',
  requireAuth,
  requirePermission('portal.use'),
  validate({ params: z.object({ documentId: uuidSchema }) }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const tenant = await portalTenant(prisma, req);
      const leases = await prisma.lease.findMany({
        where: { tenantId: tenant.id, organizationId: tenant.organizationId },
        select: { id: true, unitId: true },
      });

      // Scope check before the bytes move: a document belongs to this tenant only
      // when it is filed against them, one of their leases, or one of their units.
      const document = await prisma.document.findFirst({
        where: {
          id: pstr(req, 'documentId'),
          organizationId: tenant.organizationId,
          deletedAt: null,
          OR: [
            { tenantId: tenant.id },
            { leaseId: { in: leases.map((lease) => lease.id) } },
            { unitId: { in: leases.map((lease) => lease.unitId).filter((id): id is string => Boolean(id)) } },
          ],
        },
      });
      if (!document) throw notFound('Document not found');

      const storage = getStorageDriver();
      const stream = await storage.stream(document.storageKey);
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.title ?? document.id}"`,
      );
      // A read that fails mid-flight must not hang the response.
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
  // The specific portal permission, so the matrix stays honest: reading the
  // portal needs `portal.use`, filing a request needs `portal.request_maintenance`.
  requirePermission('portal.request_maintenance'),
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
