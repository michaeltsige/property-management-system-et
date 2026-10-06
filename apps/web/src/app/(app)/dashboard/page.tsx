'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Building2, CalendarPlus, UserPlus, Wallet } from 'lucide-react';

import { formatAmount, formatPeriodKey, todayFor } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { api } from '@/lib/api';

import { PageHeader } from '@/components/app-shell';
import { ArrearsChart, CollectionsChart, MoneyComparisonChart, OccupancyChart } from '@/components/charts';
import { PeriodPicker } from '@/components/form-controls';
import { StatCard } from '@/components/stat-card';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui';

/**
 * The four things a landlord does most often. Each link opens the screen with
 * its create form already open (`?new=1`), so the dashboard is a place to start
 * work, not just a place to read numbers.
 */
const QUICK_ACTIONS = [
  { href: '/leases?new=1', labelKey: 'dashboard.quick.lease', icon: CalendarPlus },
  { href: '/payments?new=1', labelKey: 'money.record_payment', icon: Wallet },
  { href: '/tenants?new=1', labelKey: 'dashboard.quick.tenant', icon: UserPlus },
  { href: '/properties?new=1', labelKey: 'dashboard.onboarding_cta', icon: Building2 },
] as const;

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
  const rentDueMinor = Number(money?.expectedMinor ?? 0) - Number(money?.collectedMinor ?? 0);
  const isEmptyPortfolio = !summary.loading && (summary.data?.portfolio.properties ?? 0) === 0;

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

      <section aria-labelledby="quick-actions" className="mb-4">
        <h2 id="quick-actions" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('dashboard.quick_actions')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button key={action.href} variant="secondary" size="sm" asChild>
                <Link href={action.href}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(action.labelKey)}
                </Link>
              </Button>
            );
          })}
        </div>
      </section>

      {summary.error ? (
        <Alert tone="danger" className="mb-4">
          {summary.error}
        </Alert>
      ) : null}

      {isEmptyPortfolio ? (
        <Card className="mb-4">
          <CardContent className="p-0">
            <EmptyState
              title={t('dashboard.onboarding_title')}
              description={t('dashboard.onboarding_body')}
            />
            <div className="flex justify-center pb-6">
              <Button asChild>
                <Link href="/properties?new=1">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  {t('dashboard.onboarding_cta')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
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
          // Over-collected periods are real (a tenant pays ahead), but "rent due"
          // can never be negative: the arrears card carries the balance picture.
          value={formatAmount(String(Math.max(0, rentDueMinor)), currency, language)}
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
                ariaLabel={t('dashboard.rent_this_period')}
                expectedLabel={t('dashboard.expected_rent')}
                collectedLabel={t('dashboard.collected')}
                chartDataLabel={t('a11y.chart_data')}
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
                ariaLabel={t('dashboard.collections_trend')}
                periodLabel={t('reports.period')}
                chartDataLabel={t('a11y.chart_data')}
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
                ariaLabel={t('reports.occupancy')}
                occupiedLabel={t('unit.status.occupied')}
                vacantLabel={t('unit.status.vacant')}
                chartDataLabel={t('a11y.chart_data')}
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
              <ArrearsChart
                buckets={arrearsSeries}
                ariaLabel={t('reports.arrears')}
                bucketLabel={t('reports.period')}
                currencyLabel={currency}
                chartDataLabel={t('a11y.chart_data')}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
