'use client';

/**
 * The tenant's rent account: every charge with what has been paid against it —
 * the lines behind the due balance on the overview. A three-number strip
 * (billed / paid / amount due — the same StatCard pattern the staff side
 * leads with) sits above the table so the account reads at a glance before
 * the line items.
 */

import { formatAmount, formatDate, formatPeriodKey, statusTone } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { api } from '@/lib/api';
import { statementTotals } from '@/lib/portal';
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

export default function PortalStatementPage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const me = useAsync(() => (isTenant && ready ? api.portalMe() : Promise.resolve(null)), [isTenant, ready]);
  const charges = useAsync(
    () => (isTenant && ready ? api.portalCharges() : Promise.resolve(null)),
    [isTenant, ready],
  );

  if (!ready || !isTenant) return null;

  const currency = session.organization.currency;
  const totals = statementTotals(charges.data?.items ?? []);
  const dueMinor = me.data ? Number(me.data.dueMinor) : null;
  const creditMinor = me.data ? Number(me.data.creditMinor ?? '0') : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-strong">{t('portal.statement_title')}</h1>

      {/* The account at a glance — same stat-card language as the staff
          dashboard, fed by this tenant's own numbers only. "Amount due" comes
          from the server so it always agrees with the overview's balance. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t('portal.billed')}
          value={formatAmount(String(totals.billedMinor), currency, language)}
          loading={charges.loading}
        />
        <StatCard
          label={t('portal.paid')}
          value={formatAmount(String(totals.paidMinor), currency, language)}
          loading={charges.loading}
        />
        <StatCard
          label={t('portal.due_balance')}
          value={dueMinor === null ? '—' : formatAmount(me.data!.dueMinor, currency, language)}
          tone={dueMinor !== null && dueMinor > 0 ? 'warning' : 'brand'}
          loading={me.loading}
          hint={
            creditMinor > 0
              ? `${t('portal.credit_on_account')}: ${formatAmount(String(creditMinor), currency, language)}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.statement_title')}</CardTitle>
          <p className="text-xs text-muted">{t('portal.statement_hint')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {charges.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : charges.error ? (
            <div className="space-y-3 p-4">
              <Alert tone="danger">
                {t('portal.load_failed')} {charges.error}
              </Alert>
              <Button variant="secondary" onClick={() => charges.reload()}>
                {t('common.retry')}
              </Button>
            </div>
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
                      <span className="block truncate font-medium text-strong">
                        {charge.description ?? charge.type}
                      </span>
                    </Td>
                    <Td className="text-soft">
                      {/* A period is an org-billing-calendar concept (month 13 exists in the
                        Ethiopian calendar), so it renders in the organization's
                        calendar, not the viewer's display preference. */}
                      {charge.periodKey
                        ? formatPeriodKey(charge.periodKey, session.organization.calendar, language)
                        : '—'}
                    </Td>
                    <Td>{formatDate(charge.dueDate, { language, calendar })}</Td>
                    <Td className="tabular font-medium text-strong">
                      {formatAmount(charge.amountMinor, charge.currency, language)}
                    </Td>
                    <Td className="tabular text-soft">
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
