/**
 * Payment provider webhook ingest — public by design, authenticated by
 * signature instead of a session.
 *
 * Flow for `POST /webhooks/chapa`:
 * 1. The exact raw request bytes are re-hashed with the organization's webhook
 *    secret and compared to `x-chapa-signature` / `chapa-signature`. A request
 *    that fails this check is discarded with 400 before anything acts on it —
 *    the signature IS the authentication here.
 * 2. The payload's `tx_ref` locates the payment row, which in turn supplies the
 *    organization scope — a webhook can never name an organization itself.
 * 3. Following Chapa's own guidance, the webhook is only a trigger: the
 *    transaction is re-verified against the provider API before any money is
 *    recorded, through the same serialized completion path the tenant's return
 *    page uses. Two racing confirmations therefore allocate the money once.
 * 4. Every handled (and even unhandled-but-valid) event answers 200 so Chapa's
 *    retry schedule (10 attempts over 72 hours) is not burned on cases we
 *    cannot act on. Unknown references answer 200 as well — a retry cannot
 *    make an unknown transaction known.
 */

import { Router } from 'express';

import { resolveOrgPaymentProvider } from '../providers/payments/index.js';
import { ProviderNotConfiguredError, type PaymentVerification } from '../providers/payments/types.js';
import { logger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';
import { recordAudit } from '../services/audit.js';
import { failPendingProviderPayment, settleProviderPayment } from '../services/payments.js';

export const webhooksRouter = Router();

interface ChapaWebhookEnvelope {
  event?: string;
  tx_ref?: string;
  reference?: string;
  status?: string;
}

webhooksRouter.post('/webhooks/chapa', async (req, res) => {
  const prisma = getPrisma();
  const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});

  let envelope: ChapaWebhookEnvelope = {};
  try {
    envelope = JSON.parse(rawBody) as ChapaWebhookEnvelope;
  } catch {
    envelope = {};
  }
  const txRef = envelope.tx_ref ?? '';
  if (!txRef) {
    logger.warn({ event: envelope.event }, 'chapa webhook without tx_ref — discarded');
    res.status(400).json({ received: false, reason: 'missing tx_ref' });
    return;
  }

  // The payment row is the only trusted source of scope: it tells us which
  // organization's credentials must verify the signature.
  const payment = await prisma.payment.findFirst({
    where: { provider: 'chapa', providerRef: txRef },
    orderBy: { createdAt: 'desc' },
    select: { id: true, organizationId: true, tenantId: true, status: true },
  });
  if (!payment) {
    logger.warn({ tx_ref: txRef }, 'chapa webhook for an unknown transaction — acknowledged');
    res.status(200).json({ received: true, matched: false });
    return;
  }

  const resolution = await resolveOrgPaymentProvider(prisma, payment.organizationId, 'chapa').catch(
    (error: unknown) => {
      if (error instanceof ProviderNotConfiguredError) return null;
      throw error;
    },
  );
  if (!resolution || resolution.provider !== 'chapa') {
    logger.error(
      { tx_ref: txRef, organizationId: payment.organizationId },
      'chapa webhook but the organization no longer resolves a chapa adapter — acknowledged',
    );
    res.status(200).json({ received: true, matched: true, processed: false });
    return;
  }

  const event = await resolution.adapter
    .handleWebhook(rawBody, req.headers as Record<string, string | undefined>)
    .catch((error: unknown) => {
      logger.error({ err: error, tx_ref: txRef }, 'chapa webhook could not be parsed');
      return null;
    });
  if (!event) {
    res.status(200).json({ received: true, processed: false });
    return;
  }
  if (!event.signatureValid) {
    logger.warn({ tx_ref: txRef }, 'chapa webhook with an invalid signature — rejected');
    res.status(400).json({ received: false, reason: 'invalid signature' });
    return;
  }

  // Completion events (charge.success): trigger, then verify — the webhook
  // payload alone is never money in the books.
  if (event.status === 'succeeded') {
    if (payment.status === 'succeeded') {
      res.status(200).json({ received: true, processed: true, note: 'already settled' });
      return;
    }
    const verification: PaymentVerification = await resolution.adapter.verify(txRef).catch((error: unknown) => {
      logger.error({ err: error, tx_ref: txRef }, 'chapa re-verify after webhook failed');
      return null as unknown as PaymentVerification;
    });
    if (!verification || verification.status !== 'succeeded') {
      // The provider API disagrees with the webhook: record nothing and let
      // Chapa retry (or the tenant's return page) resolve it.
      logger.warn({ tx_ref: txRef }, 'chapa webhook claims success but verify disagrees — not settled');
      res.status(200).json({ received: true, processed: false, verified: false });
      return;
    }
    if (!payment.tenantId) {
      logger.error({ tx_ref: txRef }, 'chapa payment without a tenant scope cannot be settled');
      res.status(200).json({ received: true, processed: false });
      return;
    }
    await settleProviderPayment(
      prisma,
      { organizationId: payment.organizationId, tenantId: payment.tenantId, providerRef: txRef },
      verification,
      null,
    ).catch((error: unknown) => {
      logger.error({ err: error, tx_ref: txRef }, 'chapa webhook settlement failed');
      return null;
    });
    res.status(200).json({ received: true, processed: true });
    return;
  }

  // Failure events (charge.failed/cancelled): only a still-pending attempt is
  // marked failed — a completed payment keeps its receipt and allocations.
  if (event.status === 'failed') {
    const failed = await failPendingProviderPayment(prisma, {
      organizationId: payment.organizationId,
      providerRef: txRef,
      provider: 'chapa',
      reason: 'The provider reported this payment as failed or cancelled',
    }).catch((error: unknown) => {
      logger.error({ err: error, tx_ref: txRef }, 'chapa webhook failure handling errored');
      return false;
    });
    if (failed) {
      await recordAudit(prisma, {
        organizationId: payment.organizationId,
        actorUserId: null,
        action: 'update',
        entityType: 'Payment',
        entityId: payment.id,
        after: { status: 'failed', source: 'chapa webhook', providerRef: txRef },
      }).catch(() => undefined);
    }
    res.status(200).json({ received: true, processed: failed });
    return;
  }

  // Refund / reversal / anything else: acknowledged, no state change yet —
  // refunds still run through the staff-side reversal flow.
  logger.info({ tx_ref: txRef, type: event.type }, 'chapa webhook event acknowledged without action');
  res.status(200).json({ received: true, processed: false });
});
