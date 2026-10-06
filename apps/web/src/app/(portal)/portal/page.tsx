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
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Table,
  Td,
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
          <div>
            <p className="text-sm font-semibold text-slate-900">{t('portal.title')}</p>
            <p className="text-xs text-slate-500">{session.user.fullName}</p>
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
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">{t('portal.due_balance')}</p>
                  <p className="mt-1 text-2xl font-semibold tabular text-slate-900">
                    {formatAmount(me.data.dueMinor, session.organization.currency, language)}
                  </p>
                </div>
                {me.data.dueMinor === '0' ? <Badge tone="brand">{t('portal.up_to_date')}</Badge> : null}
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
