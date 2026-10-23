/**
 * Overdue sweep and reminder job.
 *
 * Two messaging passes and one money pass, in one daily sweep:
 *  - **Rent due soon**: an open rent charge whose due date (the lease's own
 *    anniversary day) falls within the organization's `reminderDaysBefore`
 *    window gets one heads-up SMS. A prepaid cycle (status `paid`) is never
 *    reminded — the whole point of registering advance payments as future
 *    charges is that "paid ahead" and "owing" look different.
 *  - **Overdue**: charges past their due date with money outstanding, repeated
 *    on a throttle, in the tenant's own language, using the translatable
 *    templates from `@pms/i18n`.
 *  - **Late fees**: applied before messaging so the numbers are current.
 */

import type { PrismaClient } from '@prisma/client';

import { DEFAULT_ORG_SETTINGS, formatMoney } from '@pms/shared';
import { formatCivilDate, utcDateToCivil, type CalendarKind, type LanguageCode } from '@pms/calendar';

import { logger } from '../lib/logger.js';
import { getSmsProvider } from '../providers/sms/index.js';
import { applyLateFees } from '../services/charges.js';

export interface OverdueSweepPayload {
  organizationId?: string;
}

export interface OverdueSweepResult {
  chargesScanned: number;
  notificationsQueued: number;
  smsSent: number;
  smsFailed: number;
  lateFeesApplied: number;
  dueSoonQueued: number;
  dueSoonSent: number;
  dueSoonFailed: number;
}

export async function runOverdueSweep(
  prisma: PrismaClient,
  payload: OverdueSweepPayload = {},
  now: Date = new Date(),
): Promise<OverdueSweepResult> {
  const result: OverdueSweepResult = {
    chargesScanned: 0,
    notificationsQueued: 0,
    smsSent: 0,
    smsFailed: 0,
    lateFeesApplied: 0,
    dueSoonQueued: 0,
    dueSoonSent: 0,
    dueSoonFailed: 0,
  };
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

    // Late fees run even when reminders are switched off: one is about money
    // the lease agreed to, the other is about messaging.
    const lateFeeResult = await applyLateFees(
      prisma,
      organization.id,
      {
        lateFeeEnabled: settings.lateFeeEnabled !== false && settings.lateFeeEnabled !== undefined,
        lateFeeType: settings.lateFeeType === 'fixed' ? 'fixed' : 'percent',
        lateFeePercent: Number(settings.lateFeePercent ?? 0),
        lateFeeFixedMinor: Number(settings.lateFeeFixedMinor ?? 0),
        gracePeriodDays: Number(settings.gracePeriodDays ?? 0),
      },
      now,
    );
    result.lateFeesApplied += lateFeeResult.applied;

    // --- rent due soon (one heads-up per cycle) ------------------------------
    if (settings.remindersEnabled !== false) {
      const daysBefore = Number(settings.reminderDaysBefore ?? DEFAULT_ORG_SETTINGS.reminderDaysBefore);
      if (daysBefore > 0) {
        const windowEnd = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);
        const upcoming = await prisma.charge.findMany({
          where: {
            organizationId: organization.id,
            type: 'rent',
            status: { in: ['open', 'partial'] },
            dueDate: { gte: now, lte: windowEnd },
          },
          include: { tenant: true, lease: true },
          take: 500,
        });

        for (const charge of upcoming) {
          const outstandingMinor = charge.amountMinor - charge.paidMinor;
          if (outstandingMinor <= 0n) continue;
          if (!charge.tenant?.phone) continue;

          // One reminder per charge, ever — a second would be nagging, and the
          // overdue sweep takes over after the due date passes.
          const alreadyReminded = await prisma.notification.findFirst({
            where: {
              organizationId: organization.id,
              templateKey: 'notification.rent_due_soon',
              payload: { path: ['chargeId'], equals: charge.id },
            },
            select: { id: true },
          });
          if (alreadyReminded) continue;

          const language = (charge.tenant.language ?? organization.language ?? 'en') as LanguageCode;
          const calendar =
            ((charge.lease?.billingCalendar ?? organization.calendar) as CalendarKind) ?? 'ethiopian';
          const values = {
            amount: formatMoney(
              { amountMinor: Number(outstandingMinor), currency: charge.currency },
              { language },
            ),
            dueDate: formatCivilDate(utcDateToCivil(charge.dueDate, calendar), {
              language,
              showEra: true,
            }),
          };

          const notification = await prisma.notification.create({
            data: {
              organizationId: organization.id,
              templateKey: 'notification.rent_due_soon',
              channel: 'sms',
              recipientPhone: charge.tenant.phone,
              recipientUserId: null,
              language,
              payload: { chargeId: charge.id, ...values },
              status: 'queued',
            },
          });
          result.dueSoonQueued += 1;

          try {
            const sendResult = await sms.send({
              to: charge.tenant.phone,
              templateKey: 'notification.rent_due_soon',
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
            if (sendResult.status === 'sent') result.dueSoonSent += 1;
            else result.dueSoonFailed += 1;
          } catch (error) {
            await prisma.notification.update({
              where: { id: notification.id },
              data: { status: 'failed', error: String(error) },
            });
            result.dueSoonFailed += 1;
            logger.warn({ err: error, chargeId: charge.id }, 'rent-due-soon SMS failed');
          }
        }
      }
    }

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
