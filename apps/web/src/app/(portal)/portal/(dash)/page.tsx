'use client';

/**
 * The tenant portal overview: what is due, where they live, what the landlord
 * has said, and what recently happened — the five cards a tenant actually
 * checks. Every fetch is scoped server-side to the signed-in tenant.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Document, PathTool, Profile2User, TickCircle, Warning2 } from '@/components/icons';

import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui';

export default function PortalDashboardPage() {
  const router = useRouter();
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  useEffect(() => {
    if (ready && !session) router.replace('/portal/login');
  }, [ready, session, router]);

  const me = useAsync(() => (isTenant ? api.portalMe() : Promise.resolve(null)), [isTenant, ready]);
  const documents = useAsync(
    () => (isTenant && ready ? api.portalDocuments() : Promise.resolve(null)),
    [isTenant, ready],
  );
  const leaseAgreement = (documents.data?.items ?? []).find(
    (document) => document.category === 'lease_agreement',
  );
  const notices = useAsync(
    () => (isTenant && ready ? api.portalNotices() : Promise.resolve(null)),
    [isTenant, ready],
  );
  const payments = useAsync(
    () => (isTenant && ready ? api.portalPayments() : Promise.resolve(null)),
    [isTenant, ready],
  );
  const requests = useAsync(
    () => (isTenant && ready ? api.portalMaintenanceRequests() : Promise.resolve(null)),
    [isTenant, ready],
  );

  const { pending: paying, error: payError, run: runPay } = useAction();

  /** Start a provider payment for the full outstanding balance, then follow the redirect. */
  async function payNow() {
    await runPay(async () => {
      const intent = await api.portalInitiatePayment({});
      if (!intent.redirectUrl) throw new Error(t('portal.pay_no_redirect'));
      window.location.assign(intent.redirectUrl);
    }).catch(() => undefined);
  }

  if (!ready || !session || !isTenant) return null;

  const currency = session.organization.currency;
  const due = me.data ? Number(me.data.dueMinor) : 0;
  const credit = me.data ? Number(me.data.creditMinor ?? '0') : 0;
  const activeLease = me.data?.leases.find((lease) => lease.status === 'active') ?? me.data?.leases[0];
  const openRequests = (requests.data?.items ?? []).filter(
    (item) => !['completed', 'cancelled'].includes(item.status),
  );
  const recentPayments = (payments.data?.items ?? []).slice(0, 4);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-strong">
        {t('portal.welcome', { name: me.data?.tenant.fullName ?? session.user.fullName })}
      </h1>

      {me.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : me.error ? (
        <Alert tone="danger">{me.error}</Alert>
      ) : me.data ? (
        <>
          {/* The one number a tenant cares about, with the one primary action
              on this screen underneath it. On desktop it shares the row with
              "My home" — the two facts a tenant reads together — and the grid
              collapses to one column on phones. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardContent className="space-y-3 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted">{t('portal.due_balance')}</p>
                    <p
                      className={cn(
                        'tabular mt-1 text-3xl font-semibold tracking-tight',
                        due > 0 ? 'text-strong' : 'text-brand-700 dark:text-brand-300',
                      )}
                    >
                      {formatAmount(me.data.dueMinor, currency, language)}
                    </p>
                    {credit > 0 ? (
                      <p className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                        {t('portal.credit_on_account')}:{' '}
                        <span className="tabular">{formatAmount(String(credit), currency, language)}</span>
                      </p>
                    ) : null}
                  </div>
                  {due === 0 ? (
                    <Badge tone="brand" className="gap-1.5">
                      <TickCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('portal.up_to_date')}
                    </Badge>
                  ) : null}
                </div>
                {due > 0 ? (
                  <div className="space-y-1">
                    <Button onClick={payNow} disabled={paying} className="w-full sm:w-auto">
                      {paying ? t('portal.pay_starting') : t('portal.pay_now')}
                    </Button>
                    <p className="text-xs text-muted">{t('portal.pay_hint')}</p>
                    {payError ? <Alert tone="danger">{payError}</Alert> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Where they live: the human summary of the active lease. */}
            <Card>
              <CardHeader>
                <CardTitle>{t('portal.my_home')}</CardTitle>
                <Link href="/portal/statement" className="text-xs text-brand-700 dark:text-brand-300 hover:underline">
                  {t('portal.nav.statement')}
                </Link>
              </CardHeader>
              <CardContent>
                {activeLease ? (
                  <dl className="grid gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted">{t('property.name')}</dt>
                      <dd className="mt-0.5 font-medium text-strong">
                        {activeLease.property} · {activeLease.unit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t('portal.rent_per_period')}</dt>
                      <dd className="tabular mt-0.5 font-medium text-strong">
                        {formatAmount(activeLease.rentAmountMinor, activeLease.currency, language)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t('portal.tenant_since')}</dt>
                      <dd className="mt-0.5 font-medium text-strong">
                        {formatDate(activeLease.startDate, { language, calendar })}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyState title={t('portal.no_leases')} description="" />
                )}
                {activeLease ? (
                  leaseAgreement ? (
                    <a
                      href={api.portalDocumentUrl(leaseAgreement.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-block text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline"
                    >
                      {t('portal.lease_download')}
                    </a>
                  ) : (
                    <p className="mt-4 text-[11px] text-faint">{t('portal.lease_download_none')}</p>
                  )
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Notices: reminders and announcements the organization sent. */}
            <Card>
              <CardHeader>
                <CardTitle>{t('portal.notices_title')}</CardTitle>
                <Link href="/portal/notices" className="text-xs text-brand-700 dark:text-brand-300 hover:underline">
                  {t('portal.notices_view_all')}
                </Link>
              </CardHeader>
              <CardContent>
                {notices.loading ? (
                  <Skeleton className="h-16 w-full" />
                ) : (notices.data?.items.length ?? 0) === 0 ? (
                  <EmptyState title={t('portal.notices_empty')} description="" />
                ) : (
                  <ul className="space-y-2">
                    {(notices.data?.items ?? []).slice(0, 4).map((notice) => (
                      <li
                        key={notice.id}
                        className="flex items-start gap-2.5 rounded-lg bg-wash px-3 py-2.5"
                      >
                        {notice.templateKey === 'notification.payment_received' ? (
                          <TickCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                        ) : (
                          <Warning2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm text-strong">
                            {t(
                              notice.templateKey as never,
                              ((notice.payload &&
                              typeof notice.payload === 'object' &&
                              'values' in notice.payload
                                ? (notice.payload as { values?: Record<string, string | number> }).values
                                : notice.payload) ?? {}) as never,
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-faint">
                            {formatDate(notice.createdAt, { language, calendar })}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Recent payments, with the history one click away. */}
            <Card>
              <CardHeader>
                <CardTitle>{t('portal.recent_payments')}</CardTitle>
                <Link href="/portal/payments" className="text-xs text-brand-700 dark:text-brand-300 hover:underline">
                  {t('portal.view_all')}
                </Link>
              </CardHeader>
              <CardContent>
                {payments.loading ? (
                  <Skeleton className="h-16 w-full" />
                ) : recentPayments.length === 0 ? (
                  <EmptyState title={t('portal.payments_empty')} description="" />
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {recentPayments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-strong">
                            {t(`payment.method.${payment.method}` as never)}
                          </p>
                          <p className="text-[11px] text-muted">
                            {formatDate(payment.paidAt, { language, calendar })}
                            {payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}
                          </p>
                        </div>
                        <p className="tabular shrink-0 text-sm font-semibold text-strong">
                          {formatAmount(payment.amountMinor, payment.currency, language)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Open maintenance, with a direct jump to report an issue. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PathTool className="h-4 w-4 text-faint" aria-hidden="true" />
                {t('portal.open_requests')}
              </CardTitle>
              <Link href="/portal/maintenance" className="text-xs text-brand-700 dark:text-brand-300 hover:underline">
                {t('portal.new_maintenance_request')}
              </Link>
            </CardHeader>
            <CardContent>
              {requests.loading ? (
                <Skeleton className="h-16 w-full" />
              ) : openRequests.length === 0 ? (
                <EmptyState
                  title={t('portal.maintenance_empty')}
                  description={t('portal.maintenance_hint')}
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {openRequests.slice(0, 3).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-strong">{item.title}</p>
                        <p className="text-[11px] text-muted">
                          {item.ticketNumber ? `${item.ticketNumber} · ` : ''}
                          {formatDate(item.reportedAt, { language, calendar })}
                        </p>
                      </div>
                      <Badge className={cn(statusTone[item.status])}>
                        {t(`work_order.status.${item.status}` as never)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Quick jumps to the rest of the portal. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/portal/documents"
              className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3.5 text-sm font-medium text-strong shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/50"
            >
              <Document className="h-5 w-5 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {t('portal.documents')}
            </Link>
            <Link
              href="/portal/profile"
              className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3.5 text-sm font-medium text-strong shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/50"
            >
              <Profile2User className="h-5 w-5 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {t('portal.nav.profile')}
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
