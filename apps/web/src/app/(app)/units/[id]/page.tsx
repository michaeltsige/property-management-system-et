'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { roleHasPermission, type Role } from '@pms/shared';
import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { cn } from '@/lib/utils';
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
 * Unit workspace: everything a landlord asks about one rentable space on one
 * screen — facts, the lease(s), and maintenance history. Data comes from the
 * existing org-scoped list endpoints, so this page adds no API surface.
 */
export default function UnitDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { t, language, session } = usePreferences();
  const canUnits = roleHasPermission(session?.role as Role, 'units.read');

  const units = useAsync(() => (canUnits ? api.units() : Promise.resolve(null)), [canUnits]);
  const leases = useAsync(() => (canUnits ? api.leases() : Promise.resolve(null)), [canUnits]);
  const workOrders = useAsync(
    () =>
      canUnits && roleHasPermission(session?.role as Role, 'maintenance.read')
        ? api.workOrders('?pageSize=100')
        : Promise.resolve(null),
    [canUnits, session?.role],
  );

  if (!canUnits) return <Alert>{t('common.no_results')}</Alert>;
  if (units.loading || leases.loading) return <Skeleton className="h-64 w-full" />;
  if (units.error) return <Alert tone="danger">{units.error}</Alert>;

  const unit = units.data?.units.find((candidate) => candidate.id === id);
  if (!unit) {
    return (
      <div>
        <PageHeader titleKey="unit.detail" description="" />
        <EmptyState title={t('unit.not_found')} />
        <Button asChild className="mt-3">
          <Link href="/units">{t('unit.back_to_units')}</Link>
        </Button>
      </div>
    );
  }

  const unitLeases = (leases.data?.leases ?? []).filter((lease) => lease.unit.id === unit.id);
  const unitJobs = (workOrders.data?.items ?? []).filter((job) => job.unit?.id === unit.id);

  return (
    <div>
      <PageHeader
        titleKey="unit.detail"
        description={`${unit.label} · ${unit.property?.name ?? ''}${unit.building ? ` · ${unit.building.name}` : ''}`}
        actions={
          <Button variant="secondary" asChild>
            <Link href="/units">{t('unit.back_to_units')}</Link>
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-medium text-slate-500">{t('unit.status')}</p>
            <Badge className={cn(statusTone[unit.status])}>{t(`unit.status.${unit.status}` as never)}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium text-slate-500">{t('unit.market_rent')}</p>
            <p className="text-lg font-semibold text-slate-900">
              {unit.marketRentMinor === null
                ? '—'
                : formatAmount(unit.marketRentMinor, unit.currency, language)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium text-slate-500">{t('unit.bedrooms')}</p>
            <p className="text-lg font-semibold text-slate-900">{unit.bedrooms ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium text-slate-500">{t('unit.area_sqm')}</p>
            <p className="text-lg font-semibold text-slate-900">{unit.areaSqm ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('nav.leases')}</CardTitle>
          </CardHeader>
          <CardContent>
            {unitLeases.length === 0 ? (
              <EmptyState title={t('unit.no_leases')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('nav.tenants')}</Th>
                    <Th>{t('lease.rent_amount')}</Th>
                    <Th>{t('lease.start_date')}</Th>
                    <Th>{t('lease.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {unitLeases.map((lease) => (
                    <tr key={lease.id}>
                      <Td className="font-medium text-slate-900">{lease.tenant.fullName}</Td>
                      <Td>{formatAmount(lease.rentAmountMinor, lease.currency, language)}</Td>
                      <Td>{formatDate(lease.startDate, { language, calendar: lease.billingCalendar })}</Td>
                      <Td>
                        <Badge className={cn(statusTone[lease.status])}>
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

        <Card>
          <CardHeader>
            <CardTitle>{t('nav.maintenance')}</CardTitle>
          </CardHeader>
          <CardContent>
            {workOrders.error ? (
              <Alert tone="danger">{workOrders.error}</Alert>
            ) : unitJobs.length === 0 ? (
              <EmptyState title={t('unit.no_work_orders')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('maintenance.title')}</Th>
                    <Th>{t('maintenance.priority')}</Th>
                    <Th>{t('unit.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {unitJobs.map((job) => (
                    <tr key={job.id}>
                      <Td className="font-medium text-slate-900">{job.title}</Td>
                      <Td>{t(`work_order.priority.${job.priority}` as never)}</Td>
                      <Td>
                        <Badge className={cn(statusTone[job.status])}>
                          {t(`work_order.status.${job.status}` as never)}
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
    </div>
  );
}
