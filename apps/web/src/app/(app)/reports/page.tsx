'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import { todayIn } from '@pms/calendar';

import { api } from '@/lib/api';
import { formatAmount, formatDate, formatPeriodKey, statusTone } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { ArrearsChart } from '@/components/charts';
import { PeriodPicker } from '@/components/form-controls';
import { StatCard } from '@/components/stat-card';
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

type Tab = 'rent_roll' | 'arrears' | 'occupancy' | 'collections';

const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'rent_roll', labelKey: 'reports.rent_roll' },
  { id: 'arrears', labelKey: 'reports.arrears' },
  { id: 'occupancy', labelKey: 'reports.occupancy' },
  { id: 'collections', labelKey: 'reports.collections' },
];

export default function ReportsPage() {
  const { t, language, calendar, session } = usePreferences();
  const today = todayIn(calendar);
  const [tab, setTab] = useState<Tab>('rent_roll');
  const [periodKey, setPeriodKey] = useState(`${today.year}-${String(today.month).padStart(2, '0')}`);

  const currency = session?.organization.currency ?? 'ETB';
  const rentRoll = useAsync(
    () => api.rentRoll(`?periodKey=${periodKey}&calendar=${calendar}`),
    [periodKey, calendar, tab],
  );
  const arrears = useAsync(() => api.arrears(), [tab]);
  const occupancy = useAsync(() => api.occupancy(), [tab]);
  const collections = useAsync(() => api.collections(`?calendar=${calendar}&months=13`), [tab, calendar]);

  function exportCsv(filename: string, rows: (string | number)[][], header: string[]) {
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        titleKey="reports.title"
        description={formatPeriodKey(periodKey, calendar, language)}
        actions={
          <>
            <PeriodPicker
              periodKey={periodKey}
              onChange={setPeriodKey}
              calendar={calendar}
              label={t('reports.period')}
            />
            <Button
              variant="secondary"
              onClick={() => {
                if (tab === 'rent_roll' && rentRoll.data) {
                  exportCsv(
                    `rent-roll-${periodKey}.csv`,
                    rentRoll.data.rows.map((row) => [
                      row.property.name,
                      row.unit.label,
                      row.tenant.fullName,
                      row.periodDueMinor,
                      row.periodPaidMinor,
                      row.outstandingMinor,
                    ]),
                    ['Property', 'Unit', 'Tenant', 'Due (minor)', 'Paid (minor)', 'Outstanding (minor)'],
                  );
                }
                if (tab === 'arrears' && arrears.data) {
                  exportCsv(
                    `arrears-${today.year}-${today.month}.csv`,
                    arrears.data.rows.map((row) => [
                      row.property?.name ?? '',
                      row.unit?.label ?? '',
                      row.tenant?.fullName ?? '',
                      row.totalMinor,
                      row.oldestDueDate ?? '',
                    ]),
                    ['Property', 'Unit', 'Tenant', 'Outstanding (minor)', 'Oldest due date'],
                  );
                }
              }}
            >
              <Download className="h-4 w-4" />
              {t('reports.export_csv')}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === item.id
                ? 'border-brand-600 font-medium text-brand-800'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t(item.labelKey as never)}
          </button>
        ))}
      </div>

      {tab === 'rent_roll' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label={t('dashboard.expected_rent')}
              value={formatAmount(rentRoll.data?.totals.dueMinor ?? '0', currency, language)}
              tone="brand"
              loading={rentRoll.loading}
            />
            <StatCard
              label={t('dashboard.collected')}
              value={formatAmount(rentRoll.data?.totals.paidMinor ?? '0', currency, language)}
              tone="gold"
              loading={rentRoll.loading}
            />
            <StatCard
              label={t('money.outstanding')}
              value={formatAmount(rentRoll.data?.totals.outstandingMinor ?? '0', currency, language)}
              tone={Number(rentRoll.data?.totals.outstandingMinor ?? 0) > 0 ? 'danger' : 'default'}
              loading={rentRoll.loading}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              {rentRoll.loading ? (
                <div className="p-4">
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : (rentRoll.data?.rows.length ?? 0) === 0 ? (
                <EmptyState title={t('common.no_results')} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('nav.properties')}</Th>
                      <Th>{t('unit.label')}</Th>
                      <Th>{t('nav.tenants')}</Th>
                      <Th>{t('money.rent_due')}</Th>
                      <Th>{t('money.paid')}</Th>
                      <Th>{t('money.outstanding')}</Th>
                      <Th>{t('reports.period')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentRoll.data?.rows.map((row) => (
                      <tr key={row.leaseId}>
                        <Td>{row.property.name}</Td>
                        <Td className="font-medium text-slate-900">{row.unit.label}</Td>
                        <Td>{row.tenant.fullName}</Td>
                        <Td className="tabular">
                          {formatAmount(row.periodDueMinor, row.currency, language)}
                        </Td>
                        <Td className="tabular">
                          {formatAmount(row.periodPaidMinor, row.currency, language)}
                        </Td>
                        <Td
                          className={cn(
                            'tabular',
                            Number(row.outstandingMinor) > 0 && 'font-medium text-red-600',
                          )}
                        >
                          {formatAmount(row.outstandingMinor, row.currency, language)}
                        </Td>
                        <Td>
                          {row.periodCharged ? (
                            <Badge tone="brand">
                              {formatPeriodKey(row.period.key, row.period.calendar, language)}
                            </Badge>
                          ) : (
                            <Badge tone="warning">{t('charge.status.open')}</Badge>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'arrears' ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('reports.arrears')}</CardTitle>
                <span className="tabular text-sm font-semibold text-red-600">
                  {formatAmount(arrears.data?.totalMinor ?? '0', currency, language)}
                </span>
              </CardHeader>
              <CardContent>
                {arrears.loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <ArrearsChart
                    buckets={(arrears.data?.buckets ?? []).map((bucket) => ({
                      label: bucket.label,
                      value: Number(bucket.totalMinor) / 100,
                    }))}
                    ariaLabel={t('reports.arrears')}
                    bucketLabel={t('reports.period')}
                    currencyLabel={currency}
                    chartDataLabel={t('a11y.chart_data')}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('common.total')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(arrears.data?.buckets ?? []).map((bucket) => (
                  <div key={bucket.key} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{bucket.label}</span>
                    <span className="tabular font-medium">
                      {formatAmount(bucket.totalMinor, currency, language)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {(arrears.data?.rows.length ?? 0) === 0 ? (
                <EmptyState title={t('common.no_results')} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('nav.tenants')}</Th>
                      <Th>{t('unit.label')}</Th>
                      <Th>{t('money.outstanding')}</Th>
                      <Th>{t('money.overdue')}</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {arrears.data?.rows.map((row) => (
                      <tr key={row.leaseId}>
                        <Td>
                          {row.tenant?.fullName ?? '—'}
                          {row.tenant?.phone ? (
                            <span className="block text-[11px] tabular text-slate-500">
                              {row.tenant.phone}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {row.property?.name ?? '—'}
                          {row.unit?.label ? (
                            <span className="block text-[11px] text-slate-500">{row.unit.label}</span>
                          ) : null}
                        </Td>
                        <Td className="tabular font-medium text-red-600">
                          {formatAmount(row.totalMinor, currency, language)}
                        </Td>
                        <Td>
                          <Badge className={cn(statusTone.overdue)}>
                            {row.buckets.days_90_plus && Number(row.buckets.days_90_plus) > 0
                              ? '90+'
                              : row.buckets.days_31_60 && Number(row.buckets.days_31_60) > 0
                                ? '31–60'
                                : '1–30'}
                          </Badge>
                        </Td>
                        <Td className="text-[11px] text-slate-500">
                          {row.oldestDueDate ? formatDate(row.oldestDueDate, { language, calendar }) : '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'occupancy' ? (
        <Card>
          <CardContent className="p-0">
            {occupancy.loading ? (
              <div className="p-4">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('nav.properties')}</Th>
                    <Th>{t('nav.units')}</Th>
                    <Th>{t('unit.status.occupied')}</Th>
                    <Th>{t('unit.status.vacant')}</Th>
                    <Th>{t('dashboard.occupancy')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {occupancy.data?.rows.map((row) => (
                    <tr key={row.propertyId}>
                      <Td className="font-medium text-slate-900">{row.name}</Td>
                      <Td className="tabular">{row.totalUnits}</Td>
                      <Td className="tabular">{row.occupiedUnits}</Td>
                      <Td className="tabular">{row.vacantUnits}</Td>
                      <Td>
                        <Badge
                          tone={
                            row.occupancyRate >= 80 ? 'brand' : row.occupancyRate >= 50 ? 'warning' : 'danger'
                          }
                        >
                          {row.occupancyRate}%
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'collections' ? (
        <Card>
          <CardContent className="p-0">
            {collections.loading ? (
              <div className="p-4">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('reports.period')}</Th>
                    <Th>{t('common.total')}</Th>
                    <Th>{t('dashboard.collected')}</Th>
                    <Th>{t('money.method')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {collections.data?.rows
                    .slice()
                    .reverse()
                    .map((row) => (
                      <tr key={row.periodKey}>
                        <Td className="font-medium text-slate-900">
                          {formatPeriodKey(row.periodKey, calendar, language)}
                        </Td>
                        <Td className="tabular">{row.paymentCount}</Td>
                        <Td className="tabular">{formatAmount(row.totalMinor, currency, language)}</Td>
                        <Td className="text-[11px] text-slate-500">
                          {Object.entries(row.byMethod)
                            .map(
                              ([method, total]) =>
                                `${t(`payment.method.${method}` as never)} ${formatAmount(total, currency, language)}`,
                            )
                            .join(' · ') || '—'}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {rentRoll.error || arrears.error || occupancy.error || collections.error ? (
        <Alert tone="danger" className="mt-3">
          {rentRoll.error ?? arrears.error ?? occupancy.error ?? collections.error}
        </Alert>
      ) : null}
    </div>
  );
}
