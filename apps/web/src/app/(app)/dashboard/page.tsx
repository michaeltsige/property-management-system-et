'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { formatAmount, formatPeriodKey } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { api } from '@/lib/api';
import { todayFor } from '@/lib/format';

import { PageHeader } from '@/components/app-shell';
import { ArrearsChart, CollectionsChart, MoneyComparisonChart, OccupancyChart } from '@/components/charts';
import { PeriodPicker } from '@/components/form-controls';
import { StatCard } from '@/components/stat-card';
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@/components/ui';

export default function DashboardPage() {
  const { t, language, calendar, session } = usePreferences();
  const today = todayFor(calendar);
  const [periodKey, setPeriodKey] = useState(`${today.year}-${String(today.month).padStart(2, '0')}`);

  const query = `?periodKey=${periodKey}&calendar=${calendar}`;
  const summary = useAsync(() => api.summary(query), [query]);
  const collections = useAsync(() => api.collections(`?calendar=${calendar}&months=13`), [calendar]);
  const occupancy = useAsync(() => api.occupancy(), []);
  const arrears = useAsync(() => api.arrears(), []);

  const currency = summary.data?.organization.currency ?? session?.organization.currency ?? 'ETB';

  const collectionSeries = useMemo(() => {
    const rows = collections.data?.rows ?? [];
    return {
      labels: rows.map((row) => formatPeriodKey(row.periodKey, calendar, language)),
      values: rows.map((row) => Number(row.totalMinor) / 100),
    };
  }, [collections.data, calendar, language]);

  const arrearsSeries = useMemo(
    () =>
      (arrears.data?.buckets ?? []).map((bucket) => ({
        label: bucket.label,
        value: Number(bucket.totalMinor) / 100,
      })),
    [arrears.data],
  );

  const money = summary.data?.money;

  return (
    <div>
      <PageHeader
        titleKey="dashboard.title"
        description={`${formatPeriodKey(periodKey, calendar, language)} · ${summary.data?.portfolio.properties ?? 0} ${t('nav.properties').toLowerCase()}`}
        actions={
          <PeriodPicker
            periodKey={periodKey}
            onChange={setPeriodKey}
            calendar={calendar}
            label={t('reports.period')}
          />
        }
      />

      {summary.error ? (
        <Alert tone="danger" className="mb-4">
          {summary.error}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dashboard.expected_rent')}
          value={formatAmount(money?.expectedMinor ?? '0', currency, language)}
          tone="brand"
          loading={summary.loading}
        />
        <StatCard
          label={t('dashboard.collected')}
          value={formatAmount(money?.collectedMinor ?? '0', currency, language)}
          tone="gold"
          hint={
            money?.collectionRate === null || money === undefined ? undefined : `${money.collectionRate}%`
          }
          loading={summary.loading}
        />
        <StatCard
          label={t('dashboard.arrears')}
          value={formatAmount(money?.arrearsMinor ?? '0', currency, language)}
          tone={Number(money?.arrearsMinor ?? 0) > 0 ? 'danger' : 'default'}
          loading={summary.loading}
        />
        <StatCard
          label={t('dashboard.occupancy')}
          value={`${summary.data?.portfolio.occupancyRate ?? 0}%`}
          hint={`${summary.data?.portfolio.occupiedUnits ?? 0} / ${summary.data?.portfolio.units ?? 0} ${t('nav.units')}`}
          loading={summary.loading}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('nav.tenants')}
          value={String(summary.data?.portfolio.tenants ?? 0)}
          loading={summary.loading}
        />
        <StatCard
          label={t('nav.leases')}
          value={String(summary.data?.portfolio.activeLeases ?? 0)}
          loading={summary.loading}
        />
        <StatCard
          label={t('dashboard.open_work_orders')}
          value={String(summary.data?.portfolio.openWorkOrders ?? 0)}
          tone={Number(summary.data?.portfolio.openWorkOrders ?? 0) > 0 ? 'warning' : 'default'}
          loading={summary.loading}
        />
        <StatCard
          label={t('money.rent_due')}
          value={formatAmount(
            money?.expectedMinor ? String(Number(money.expectedMinor) - Number(money.collectedMinor)) : '0',
            currency,
            language,
          )}
          loading={summary.loading}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.rent_this_period')}</CardTitle>
            <Link href="/reports" className="text-xs text-brand-700 hover:underline">
              {t('reports.title')}
            </Link>
          </CardHeader>
          <CardContent>
            {summary.loading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <MoneyComparisonChart
                expected={Number(money?.expectedMinor ?? 0) / 100}
                collected={Number(money?.collectedMinor ?? 0) / 100}
                currencyLabel={currency}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.collections_trend')}</CardTitle>
          </CardHeader>
          <CardContent>
            {collections.loading ? (
              <Skeleton className="h-56 w-full" />
            ) : collectionSeries.labels.length === 0 ? (
              <EmptyState title={t('common.no_results')} />
            ) : (
              <CollectionsChart
                labels={collectionSeries.labels}
                values={collectionSeries.values}
                currencyLabel={currency}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('reports.occupancy')}</CardTitle>
          </CardHeader>
          <CardContent>
            {occupancy.loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <OccupancyChart
                rows={(occupancy.data?.rows ?? []).map((row) => ({
                  name: row.name,
                  occupied: row.occupiedUnits,
                  vacant: row.vacantUnits,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('reports.arrears')}</CardTitle>
          </CardHeader>
          <CardContent>
            {arrears.loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ArrearsChart buckets={arrearsSeries} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
