'use client';

import { useCalendarPeriod } from '@/lib/use-calendar-period';
import Link from 'next/link';
import { useMemo } from 'react';
import { Building2, CalendarPlus, TrendingDown, TrendingUp, UserPlus, Wallet } from 'lucide-react';

import { formatAmount, formatPeriodKey } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { api } from '@/lib/api';

import { PageHeader } from '@/components/app-shell';
import { ArrearsChart, CollectionsChart, MoneyComparisonChart, OccupancyChart } from '@/components/charts';
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
} from '@/components/ui';

/**
 * The four things a landlord does most often. Each link opens the screen with
 * its create form already open (`?new=1`), so the dashboard is a place to start
 * work, not just a place to read numbers. Recording money is the daily action
 * and gets the one primary button on this screen; the rest stay quiet.
 */
const QUICK_ACTIONS = [
  { href: '/payments?new=1', labelKey: 'money.record_payment', icon: Wallet, primary: true },
  { href: '/leases?new=1', labelKey: 'dashboard.quick.lease', icon: CalendarPlus, primary: false },
  { href: '/tenants?new=1', labelKey: 'dashboard.quick.tenant', icon: UserPlus, primary: false },
  { href: '/properties?new=1', labelKey: 'dashboard.onboarding_cta', icon: Building2, primary: false },
];

export default function DashboardPage() {
  const { t, language, calendar, session } = usePreferences();
  const setup = useAsync(
    () => (session?.role === 'owner_admin' ? api.settings() : Promise.resolve(null)),
    [session?.role],
  );
  const [periodKey, setPeriodKey] = useCalendarPeriod(calendar);

  const query = `?periodKey=${periodKey}&calendar=${calendar}`;
  const summary = useAsync(() => api.summary(query), [query]);
  const collections = useAsync(
    async () => ({
      requestedCalendar: calendar,
      ...(await api.collections(`?calendar=${calendar}&months=13`)),
    }),
    [calendar],
  );
  const occupancy = useAsync(() => api.occupancy(), []);
  const arrears = useAsync(() => api.arrears(), []);

  const currency = summary.data?.organization.currency ?? session?.organization.currency ?? 'ETB';

  const collectionSeries = useMemo(() => {
    const rows = collections.data?.requestedCalendar === calendar ? collections.data.rows : [];
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

  /*
   * Trend context for the collections chart: the LAST row of the series is the
   * period still in progress, so comparing it to a finished month would read as
   * a slump every early month. The honest like-for-like pair is the two most
   * recent COMPLETE periods — and the chip says exactly that.
   */
  const trendDelta = useMemo(() => {
    const values = collectionSeries.values;
    if (values.length < 3) return null;
    const current = values[values.length - 2];
    const previous = values[values.length - 3];
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
    const shift = ((current - previous) / previous) * 100;
    return {
      value: `${shift > 0 ? '+' : ''}${shift.toFixed(1)}%`,
      direction: shift > 0.05 ? ('up' as const) : shift < -0.05 ? ('down' as const) : ('flat' as const),
    };
  }, [collectionSeries]);

  return (
    <div>
      {setup.data?.settings.onboardingStatus === 'portfolio_pending' && (
        <Alert>
          <Link href="/onboarding" className="underline">
            {t('onboarding.resume')}
          </Link>
        </Alert>
      )}
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
        <h2 id="quick-actions" className="sr-only">{t('dashboard.quick_actions')}</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.href}
                variant={action.primary ? 'default' : 'ghost'}
                size="sm"
                asChild
              >
                <Link href={action.href}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(action.labelKey as never)}
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

      {/*
       * The money row has ONE lead: collected this period renders double-wide
       * with the largest figure on the screen, so the eye lands there first and
       * the three supporting metrics read as context, not as three rivals.
       */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          size="hero"
          className="sm:col-span-2 xl:col-span-2"
          label={t('dashboard.collected')}
          value={formatAmount(money?.collectedMinor ?? '0', currency, language)}
          tone="brand"
          // A rate above 100% is real (a tenant paid ahead) but must not read
          // as a broken gauge: the bar clamps at 100 and the hint explains it.
          progress={
            money === undefined || money.collectionRate === null
              ? undefined
              : Math.max(0, Math.min(100, Number(money.collectionRate)))
          }
          hint={
            money === undefined || money.collectionRate === null
              ? undefined
              : Number(money.collectionRate) > 100
                ? t('dashboard.advance_payments')
                : t('dashboard.collection_rate', { rate: money.collectionRate })
          }
          loading={summary.loading}
        />
        <StatCard
          label={t('dashboard.expected_rent')}
          value={formatAmount(money?.expectedMinor ?? '0', currency, language)}
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

      {/* The counts a landlord checks in passing — one quiet strip, not five
          more shouty cards competing with the money row above. */}
      <Card className="mt-3">
        <CardContent className="grid grid-cols-2 gap-y-4 py-3.5 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              { label: t('nav.tenants'), value: summary.data?.portfolio.tenants, loading: summary.loading },
              { label: t('nav.leases'), value: summary.data?.portfolio.activeLeases, loading: summary.loading },
              {
                label: t('dashboard.open_work_orders'),
                value: summary.data?.portfolio.openWorkOrders,
                tone: Number(summary.data?.portfolio.openWorkOrders ?? 0) > 0 ? 'text-amber-600' : undefined,
                loading: summary.loading,
              },
              {
                label: t('dashboard.vacant_units'),
                value: occupancy.data?.totals?.vacantUnits,
                tone: Number(occupancy.data?.totals?.vacantUnits ?? 0) > 0 ? 'text-amber-600' : undefined,
                loading: occupancy.loading,
              },
              {
                label: t('money.rent_due'),
                // Over-collected periods are real (a tenant pays ahead), but
                // "rent due" can never be negative: the arrears picture above
                // carries the balance.
                value: formatAmount(String(Math.max(0, rentDueMinor)), currency, language),
                loading: summary.loading,
              },
            ] as { label: string; value?: string | number; tone?: string; loading: boolean }[]
          ).map((item) => (
            <div key={item.label} className="px-4 text-left lg:border-l lg:border-slate-100 lg:first:border-l-0">
              <p className="text-xs text-slate-500">{item.label}</p>
              {item.loading ? (
                <Skeleton className="mt-1 h-6 w-14" />
              ) : (
                <p className={`tabular mt-0.5 text-lg font-semibold text-slate-900 ${item.tone ?? ''}`}>
                  {item.value ?? '—'}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

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
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t('dashboard.collections_trend')}
              {/* Like-for-like trend context: the two most recent COMPLETE
                  periods (the chip text spells that out). Hidden while the
                  series is still loading so nothing claims an unmeasured
                  number. */}
              {trendDelta && !collections.loading ? (
                <Badge
                  tone={trendDelta.direction === 'up' ? 'brand' : trendDelta.direction === 'down' ? 'danger' : 'neutral'}
                  className="gap-1 tabular"
                >
                  {trendDelta.direction === 'down' ? (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  )}
                  {trendDelta.value} {t('dashboard.delta_completed_periods')}
                </Badge>
              ) : null}
            </CardTitle>
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
