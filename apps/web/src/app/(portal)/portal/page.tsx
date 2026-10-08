'use client';

/**
 * The tenant's portal page: their leases and what is due, nothing else.
 *
 * Every piece of data here comes from `GET /portal/me`, which the API scopes to
 * the tenant linked to this session — the page cannot ask for anyone else's
 * records, and the standard org/permission middleware applies to that endpoint.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Logo } from '@/components/logo';
import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

export default function PortalPage() {
  const router = useRouter();
  const { session, ready, language, calendar, t, signOut } = usePreferences();
  const isTenant = session?.role === 'tenant';

  useEffect(() => {
    if (ready && !session) router.replace('/portal/login');
  }, [ready, session, router]);

  const me = useAsync(() => (isTenant ? api.portalMe() : Promise.resolve(null)), [isTenant, ready]);
  const { pending: paying, error: payError, run: runPay } = useAction();

  /** Start a provider payment for the full outstanding balance, then follow the redirect. */
  async function payNow() {
    await runPay(async () => {
      const intent = await api.portalInitiatePayment({});
      if (!intent.redirectUrl) throw new Error('The payment provider did not return a checkout page');
      window.location.assign(intent.redirectUrl);
    }).catch(() => undefined);
  }

  const [maintenanceVersion, setMaintenanceVersion] = useState(0);
  const requests = useAsync(
    () => (isTenant && ready ? api.portalMaintenanceRequests() : Promise.resolve(null)),
    [isTenant, ready, maintenanceVersion],
  );
  const [requestForm, setRequestForm] = useState({ title: '', description: '' });
  const [requestSent, setRequestSent] = useState(false);
  const { pending: submitting, error: requestError, run } = useAction();

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createPortalMaintenanceRequest({
        title: requestForm.title.trim(),
        description: requestForm.description.trim() || undefined,
      });
      setRequestForm({ title: '', description: '' });
      setRequestSent(true);
      setMaintenanceVersion((version) => version + 1);
    }).catch(() => undefined);
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      signOut();
      router.replace('/portal/login');
    }
  }

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  if (!isTenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-sm text-slate-600">{t('portal.not_tenant')}</p>
          <Link href="/portal/login" className="text-sm font-medium text-brand-700 underline">
            {t('portal.title')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <div>
              <p className="text-sm font-semibold text-slate-900">{t('portal.title')}</p>
              <p className="text-xs text-slate-500">{session.user.fullName}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={logout}>
            {t('auth.sign_out')}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-slate-900">
          {t('portal.welcome', { name: me.data?.tenant.fullName ?? session.user.fullName })}
        </h1>

        {me.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : me.error ? (
          <Alert tone="danger">{me.error}</Alert>
        ) : me.data ? (
          <>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">{t('portal.due_balance')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular text-slate-900">
                      {formatAmount(me.data.dueMinor, session.organization.currency, language)}
                    </p>
                  </div>
                  {me.data.dueMinor === '0' ? <Badge tone="brand">{t('portal.up_to_date')}</Badge> : null}
                </div>
                {me.data.dueMinor !== '0' ? (
                  <div className="space-y-1">
                    <Button onClick={payNow} disabled={paying}>
                      {paying ? t('portal.pay_starting') : t('portal.pay_now')}
                    </Button>
                    <p className="text-xs text-slate-500">{t('portal.pay_hint')}</p>
                    {payError ? <Alert tone="danger">{payError}</Alert> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                  {t('portal.maintenance_title')}
                </div>

                {requests.loading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : requests.error ? (
                  <div className="p-4">
                    <Alert tone="danger">{requests.error}</Alert>
                  </div>
                ) : (requests.data?.items.length ?? 0) === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title={t('portal.maintenance_empty')}
                      description={t('portal.maintenance_hint')}
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {(requests.data?.items ?? []).map((item) => (
                      <li key={item.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900">{item.title}</p>
                          <Badge className={cn(statusTone[item.status])}>
                            {t(`work_order.status.${item.status}` as never)}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {item.ticketNumber ?? ''}
                          {item.ticketNumber ? ' · ' : ''}
                          {formatDate(item.reportedAt, { language, calendar })}
                        </p>
                        {item.description ? (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                            {item.description}
                          </p>
                        ) : null}
                        {(item.notes ?? []).length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {(item.notes ?? []).map((note) => (
                              <li key={note.id} className="rounded-md bg-slate-50 px-2 py-1.5">
                                <p className="whitespace-pre-wrap text-xs text-slate-700">{note.body}</p>
                                <p className="mt-0.5 text-[10px] text-slate-400">
                                  {note.authorName} · {formatDate(note.createdAt, { language, calendar })}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                <form className="space-y-2 border-t border-slate-200 px-4 py-3" onSubmit={submitRequest}>
                  <p className="text-xs text-slate-500">{t('portal.maintenance_hint')}</p>
                  <div className="space-y-1">
                    <Label htmlFor="request-title">{t('maintenance.title')}</Label>
                    <Input
                      id="request-title"
                      required
                      minLength={5}
                      value={requestForm.title}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="request-description">{t('maintenance.description')}</Label>
                    <Textarea
                      id="request-description"
                      value={requestForm.description}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, description: event.target.value }))
                      }
                    />
                  </div>
                  {requestError ? <Alert tone="danger">{requestError}</Alert> : null}
                  {requestSent ? <Alert tone="success">{t('portal.maintenance_submitted')}</Alert> : null}
                  <Button type="submit" disabled={submitting || requestForm.title.trim().length < 5}>
                    {submitting ? t('app.loading') : t('portal.new_maintenance_request')}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                  {t('portal.my_leases')}
                </div>
                {me.data.leases.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title={t('portal.no_leases')} description="" />
                  </div>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t('unit.label')}</Th>
                        <Th>{t('property.name')}</Th>
                        <Th>{t('lease.rent_amount')}</Th>
                        <Th>{t('lease.start_date')}</Th>
                        <Th>{t('lease.status')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {me.data.leases.map((lease) => (
                        <tr key={lease.id}>
                          <Td className="font-medium text-slate-900">{lease.unit}</Td>
                          <Td>{lease.property}</Td>
                          <Td className="tabular">
                            {formatAmount(lease.rentAmountMinor, lease.currency, language)}
                          </Td>
                          <Td>{formatDate(lease.startDate, { language, calendar })}</Td>
                          <Td>
                            <Badge>{t(`lease.status.${lease.status}` as never)}</Badge>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}
