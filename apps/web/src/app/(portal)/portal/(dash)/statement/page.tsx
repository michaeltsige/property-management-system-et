'use client';

/**
 * The tenant's rent account: every charge with what has been paid against it —
 * the lines behind the due balance on the overview.
 */

import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { api } from '@/lib/api';
import {
  Badge,
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

export default function PortalStatementPage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const charges = useAsync(
    () => (isTenant && ready ? api.portalCharges() : Promise.resolve(null)),
    [isTenant, ready],
  );

  if (!ready || !isTenant) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {t('portal.statement_title')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.statement_title')}</CardTitle>
          <p className="text-xs text-slate-500">{t('portal.statement_hint')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {charges.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : charges.error ? (
            <div className="p-4 text-sm text-red-700">{charges.error}</div>
          ) : (charges.data?.items.length ?? 0) === 0 ? (
            <div className="p-4">
              <EmptyState title={t('portal.statement_empty')} description="" />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('portal.charge')}</Th>
                  <Th>{t('portal.period')}</Th>
                  <Th>{t('portal.due_date')}</Th>
                  <Th>{t('portal.amount')}</Th>
                  <Th>{t('portal.paid')}</Th>
                  <Th>{t('portal.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {(charges.data?.items ?? []).map((charge) => (
                  <tr key={charge.id}>
                    <Td className="max-w-56">
                      <span className="block truncate font-medium text-slate-900">
                        {charge.description ?? charge.type}
                      </span>
                    </Td>
                    <Td className="tabular text-slate-600">{charge.periodKey ?? '—'}</Td>
                    <Td>{formatDate(charge.dueDate, { language, calendar })}</Td>
                    <Td className="tabular font-medium text-slate-900">
                      {formatAmount(charge.amountMinor, charge.currency, language)}
                    </Td>
                    <Td className="tabular text-slate-600">
                      {formatAmount(charge.paidMinor, charge.currency, language)}
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[charge.status] ?? '')}>
                        {t(`charge.status.${charge.status}` as never)}
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
  );
}
