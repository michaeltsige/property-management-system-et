'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
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
  Table,
  Td,
  Th,
} from '@/components/ui';

/**
 * Tenant workspace: one person, everything about them — contact facts, their
 * leases (with the unit each one covers), what they still owe, and what they
 * have paid. Every clickable tenant name in the app lands here, so moving
 * list → person never needs a search detour.
 */
export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { t, language } = usePreferences();

  const detail = useAsync(() => api.tenant(id), [id]);

  if (detail.loading) return <Skeleton className="h-64 w-full" />;
  if (detail.error) return <Alert tone="danger">{detail.error}</Alert>;

  const data = detail.data;
  if (!data) {
    return (
      <div>
        <PageHeader titleKey="tenant.detail.title" />
        <EmptyState title={t('tenant.not_found')} />
        <Button asChild className="mt-3">
          <Link href="/tenants">{t('tenant.back_to_tenants')}</Link>
        </Button>
      </div>
    );
  }

  const tenant = data.tenant;
  const openTotalMinor = data.openCharges.reduce((sum, charge) => {
    const outstanding = Number(charge.amountMinor) - Number(charge.paidMinor);
    return sum + (outstanding > 0 ? outstanding : 0);
  }, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        titleKey="tenant.detail.title"
        description={tenant.fullName}
        actions={
          <Button asChild variant="ghost">
            <Link href="/tenants">{t('tenant.back_to_tenants')}</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('tenant.detail.contact')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted">{t('tenant.full_name')}: </span>
              <span className="text-strong">{tenant.fullName}</span>
            </p>
            <p>
              <span className="text-muted">{t('tenant.phone')}: </span>
              <span className="tabular text-strong">{tenant.phone ?? '—'}</span>
            </p>
            <p>
              <span className="text-muted">{t('tenant.alt_phone')}: </span>
              <span className="tabular text-strong">{tenant.altPhone ?? '—'}</span>
            </p>
            <p>
              <span className="text-muted">{t('tenant.email')}: </span>
              <span className="text-strong">{tenant.email ?? '—'}</span>
            </p>
            <p>
              <span className="text-muted">{t('tenant.employer')}: </span>
              <span className="text-strong">{tenant.employer ?? '—'}</span>
            </p>
            <p>
              <span className="text-muted">{t('tenant.emergency_contact')}: </span>
              <span className="text-strong">
                {tenant.emergencyContactName
                  ? `${tenant.emergencyContactName}${tenant.emergencyContactPhone ? ` · ${tenant.emergencyContactPhone}` : ''}`
                  : '—'}
              </span>
            </p>
            {tenant.portalEnabledAt ? (
              <Badge className={statusTone.active}>{t('tenant.portal_active')}</Badge>
            ) : null}
            {tenant.notes ? <p className="pt-1 text-xs text-muted">{tenant.notes}</p> : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('tenant.detail.leases')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.leases.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{t('tenant.detail.no_leases')}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('nav.units')}</Th>
                    <Th className="whitespace-nowrap">{t('lease.rent_amount')}</Th>
                    <Th className="whitespace-nowrap">{t('lease.start_date')}</Th>
                    <Th className="whitespace-nowrap">{t('lease.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.leases.map((lease) => (
                    <tr key={lease.id}>
                      <Td className="min-w-0">
                        <Link
                          href={`/units/${lease.unit.id}`}
                          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                        >
                          {lease.unit.label}
                        </Link>
                        <span className="block truncate text-[11px] text-muted">{lease.unit.property.name}</span>
                      </Td>
                      <Td className="tabular">{formatAmount(lease.rentAmountMinor, lease.currency, language)}</Td>
                      <Td className="tabular whitespace-nowrap">
                        {formatDate(lease.startDate, { language, calendar: lease.billingCalendar })}
                      </Td>
                      <Td>
                        <Badge className={statusTone[lease.status]}>
                          {t(`lease.status.${lease.status}` as never)}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('tenant.detail.open_charges')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.openCharges.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{t('tenant.detail.no_open_charges')}</p>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('reports.period')}</Th>
                      <Th className="whitespace-nowrap">{t('money.amount')}</Th>
                      <Th className="whitespace-nowrap">{t('money.outstanding')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.openCharges.map((charge) => (
                      <tr key={charge.id}>
                        <Td className="min-w-0">
                          <span className="block truncate text-strong">
                            {charge.description ?? t(`charge.type.${charge.type}` as never)}
                          </span>
                          <span className="block text-[11px] text-muted tabular">
                            {formatDate(charge.dueDate, { language, calendar: 'gregorian' })}
                          </span>
                        </Td>
                        <Td className="tabular">{formatAmount(charge.amountMinor, charge.currency, language)}</Td>
                        <Td className="tabular">
                          {formatAmount(
                            String(Math.max(0, Number(charge.amountMinor) - Number(charge.paidMinor))),
                            charge.currency,
                            language,
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <p className="border-t border-line px-4 py-2 text-sm">
                  <span className="text-muted">{t('tenant.detail.total_due')}: </span>
                  <span className="tabular font-medium text-strong">
                    {formatAmount(String(openTotalMinor), data.openCharges[0]?.currency ?? 'ETB', language)}
                  </span>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('tenant.detail.recent_payments')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.payments.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{t('tenant.detail.no_payments')}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('money.receipt_number')}</Th>
                    <Th className="whitespace-nowrap">{t('money.amount')}</Th>
                    <Th className="whitespace-nowrap">{t('payment.paid_on')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <Td className="min-w-0">
                        <span className="block truncate text-strong">{payment.receiptNumber ?? '—'}</span>
                        <span className="block text-[11px] text-muted">
                          {t(`payment.method.${payment.method}` as never)}
                        </span>
                      </Td>
                      <Td className="tabular">{formatAmount(payment.amountMinor, payment.currency, language)}</Td>
                      <Td className="tabular whitespace-nowrap">
                        {formatDate(payment.paidAt, { language, calendar: 'gregorian' })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
