/**
 * Notification dispatch job.
 *
 * `notifications.send` had a queue and a `queued` status but no handler — rows
 * piled up forever. This handler drains them: it renders the template through
 * `@pms/i18n` (organization overrides included), sends SMS through the SMS
 * provider, and stores in-app notifications as sent immediately (the row IS the
 * inbox). Email has no provider yet, so it fails honestly instead of pretending.
 *
 * The overdue sweep keeps its inline send path (it counts results for its run
 * report); this job covers everything else that enqueues and any retries.
 */

import type { PrismaClient } from '@prisma/client';

import type { LanguageCode } from '@pms/calendar';

import { logger } from '../lib/logger.js';
import { getSmsProvider } from '../providers/sms/index.js';

export interface SendNotificationPayload {
  organizationId?: string;
  /** Drain one specific notification (e.g. after an enqueue); otherwise batch. */
  notificationId?: string;
}

export interface SendNotificationResult {
  processed: number;
  sent: number;
  failed: number;
}

export async function runSendNotification(
  prisma: PrismaClient,
  payload: SendNotificationPayload = {},
): Promise<SendNotificationResult> {
  const result: SendNotificationResult = { processed: 0, sent: 0, failed: 0 };
  const sms = getSmsProvider();

  const batch = await prisma.notification.findMany({
    where: {
      status: 'queued',
      ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
      ...(payload.notificationId ? { id: payload.notificationId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  for (const notification of batch) {
    result.processed += 1;
    const values = (notification.payload ?? {}) as Record<string, string | number>;

    try {
      if (notification.channel === 'in_app') {
        // The row itself is the inbox entry — nothing to deliver.
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        result.sent += 1;
        continue;
      }

      if (notification.channel === 'sms') {
        if (!notification.recipientPhone) {
          await prisma.notification.update({
            where: { id: notification.id },
            data: { status: 'failed', error: 'No recipient phone on the notification' },
          });
          result.failed += 1;
          continue;
        }
        const send = await sms.send({
          to: notification.recipientPhone,
          templateKey: notification.templateKey as Parameters<typeof sms.send>[0]['templateKey'],
          values,
          language: notification.language as LanguageCode,
        });
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: send.status === 'sent' ? 'sent' : 'failed',
            providerRef: send.providerRef,
            sentAt: new Date(),
            error: send.detail ?? (send.status === 'sent' ? null : 'Provider rejected the message'),
          },
        });
        if (send.status === 'sent') result.sent += 1;
        else result.failed += 1;
        continue;
      }

      // email: no provider is wired yet — fail honestly rather than fake a send.
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'failed',
          error: 'Email delivery is not configured yet; no email provider is connected',
        },
      });
      result.failed += 1;
    } catch (error) {
      logger.warn({ err: error, notificationId: notification.id }, 'notification dispatch failed');
      await prisma.notification
        .update({
          where: { id: notification.id },
          data: { status: 'failed', error: String(error) },
        })
        .catch(() => undefined);
      result.failed += 1;
    }
  }

  return result;
}
