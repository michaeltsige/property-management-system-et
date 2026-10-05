/**
 * Overdue sweep and reminder job.
 *
 * Finds charges that are past their due date with money still outstanding and
 * queues a notification for each tenant **in the tenant's own language**, using the
 * translatable templates from `@pms/i18n`. Repeats are throttled per charge so a
 * tenant is not messaged every day.
 */

import type { PrismaClient } from '@prisma/client';

import { DEFAULT_ORG_SETTINGS, formatMoney } from '@pms/shared';
import { formatCivilDate, utcDateToCivil, type CalendarKind, type LanguageCode } from '@pms/calendar';

import { logger } from '../lib/logger.js';
import { getSmsProvider } from '../providers/sms/index.js';

export interface OverdueSweepPayload {
  organizationId?: string;
}

export interface OverdueSweepResult {
  chargesScanned: number;
  notificationsQueued: number;
  smsSent: number;
  smsFailed: number;
}

export async function runOverdueSweep(
  prisma: PrismaClient,
  payload: OverdueSweepPayload = {},
  now: Date = new Date(),
): Promise<OverdueSweepResult> {
  const result: OverdueSweepResult = { chargesScanned: 0, notificationsQueued: 0, smsSent: 0, smsFailed: 0 };
  const sms = getSmsProvider();

  const organizations = await prisma.organization.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      ...(payload.organizationId ? { id: payload.organizationId } : {}),
    },
  });

  for (const organization of organizations) {
    const settingsRows = await prisma.organizationSetting.findMany({
      where: { organizationId: organization.id },
    });
    const settings: Record<string, unknown> = { ...DEFAULT_ORG_SETTINGS };
    for (const row of settingsRows) settings[row.key] = row.value;
    if (settings.overdueRemindersEnabled === false) continue;

    const everyDays = Number(
      settings.overdueReminderEveryDays ?? DEFAULT_ORG_SETTINGS.overdueReminderEveryDays,
    );
    const cutoff = new Date(now.getTime() - everyDays * 24 * 60 * 60 * 1000);

    const charges = await prisma.charge.findMany({
      where: {
        organizationId: organization.id,
        dueDate: { lt: now },
        status: { in: ['open', 'partial'] },
      },
      include: { tenant: true, lease: true },
      take: 500,
    });

    for (const charge of charges) {
      result.chargesScanned += 1;
      const outstandingMinor = charge.amountMinor - charge.paidMinor;
      if (outstandingMinor <= 0n) continue;
      if (!charge.tenant?.phone) continue;

      // Throttle: was this charge already notified inside the window?
      const recent = await prisma.notification.findFirst({
        where: {
          organizationId: organization.id,
          templateKey: 'notification.rent_overdue',
          payload: { path: ['chargeId'], equals: charge.id },
          createdAt: { gte: cutoff, lte: now },
        },
      });
      if (recent) continue;

      const language = (charge.tenant.language ?? organization.language ?? 'en') as LanguageCode;
      const calendar =
        ((charge.lease?.billingCalendar ?? organization.calendar) as CalendarKind) ?? 'ethiopian';

      const values = {
        amount: formatMoney(
          { amountMinor: Number(outstandingMinor), currency: charge.currency },
          { language },
        ),
        dueDate: formatCivilDate(utcDateToCivil(charge.dueDate, calendar), { language, showEra: true }),
      };

      const notification = await prisma.notification.create({
        data: {
          organizationId: organization.id,
          templateKey: 'notification.rent_overdue',
          channel: 'sms',
          recipientPhone: charge.tenant.phone,
          recipientUserId: null,
          language,
          payload: { chargeId: charge.id, ...values },
          status: 'queued',
        },
      });
      result.notificationsQueued += 1;

      try {
        // The body is rendered by the provider adapter; rendering here as well would
        // send the same message twice if someone wired it up by mistake.
        const sendResult = await sms.send({
          to: charge.tenant.phone,
          templateKey: 'notification.rent_overdue',
          values,
          language,
        });
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: sendResult.status === 'sent' ? 'sent' : 'failed',
            providerRef: sendResult.providerRef,
            sentAt: new Date(),
            error: sendResult.detail ?? null,
          },
        });
        if (sendResult.status === 'sent') result.smsSent += 1;
        else result.smsFailed += 1;
      } catch (error) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: String(error) },
        });
        result.smsFailed += 1;
        logger.warn({ err: error, chargeId: charge.id }, 'overdue SMS failed');
      }
    }
  }

  return result;
}
