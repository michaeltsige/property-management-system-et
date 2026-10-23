'use client';

import { PlayCircle } from '@/components/icons';
import { useState } from 'react';

import { useCalendarPeriod } from '@/lib/use-calendar-period';

import { api } from '@/lib/api';
import type { Charge } from '@/lib/types';
import { formatAmount, formatDate, formatPeriodKey, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { usePropertyContext } from '@/lib/property-context';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { ExportCsvButton } from '@/components/export-csv-button';
import { PeriodPicker } from '@/components/form-controls';
import { Modal } from '@/components/modal';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

/**
 * Rent charges: the rent roll as a list, with the two actions that touch a
 * ledger — generating the period's charges (idempotent) and waiving a charge.
 */
export default function ChargesPage() {
  const { t, language, calendar } = usePreferences();
  const [periodKey, setPeriodKey] = useCalendarPeriod(calendar);
  const [status, setStatus] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('status') ?? ''),
  );
  const [waiveTarget, setWaiveTarget] = useState<{ id: string; description: string } | null>(null);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const { pending, error, message, setMessage, run } = useAction();

  const query = `?periodKey=${periodKey}&calendar=${calendar}${status ? `&status=${status}` : ''}&pageSize=100`;
  const charges = useAsync(() => api.charges(query), [query]);
  // Every charge now arrives with its tenant and unit → property attached, so
  // the sidebar property scope and the search box filter locally, no extra
  // leases round-trip.
  const [propertyContext] = usePropertyContext();
  const haystack = (charge: Charge) =>
    `${charge.tenant?.fullName ?? ''} ${charge.lease?.unit.label ?? ''} ${charge.lease?.unit.property.name ?? ''}`.toLowerCase();
  const rows = (charges.data?.items ?? []).filter(
    (charge) =>
      (propertyContext === null || charge.lease?.unit.property.id === propertyContext) &&
      (search.trim() === '' || haystack(charge).includes(search.toLowerCase())),
  );

  async function generate() {
    await run(async () => {
      const result = await api.generateCharges({
        periodKeys: [periodKey],
        calendar,
        skipNotYetStarted: true,
      });
      setMessage(
        `${periodKey}: ${result.created} created, ${result.skippedExisting} already existed, ${result.skippedOutOfRange} outside the lease term.`,
      );
      charges.reload();
    }).catch(() => undefined);
  }

  async function waive() {
    if (!waiveTarget) return;
    await run(async () => {
      await api.waiveCharge(waiveTarget.id, reason);
      setWaiveTarget(null);
      setReason('');
      charges.reload();
    }).catch(() => undefined);
  }

  return (
    <div>
      <PageHeader
        titleKey="nav.charges"
        description={formatPeriodKey(periodKey, calendar, language)}
        actions={
          <>
            <PeriodPicker
              periodKey={periodKey}
              onChange={setPeriodKey}
              calendar={calendar}
              label={t('reports.period')}
            />
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-full sm:w-36"
              aria-label={t('unit.status')}
            >
              <option value="">{t('common.filters')}</option>
              <option value="open">{t('charge.status.open')}</option>
              <option value="partial">{t('charge.status.partial')}</option>
              <option value="paid">{t('charge.status.paid')}</option>
              <option value="waived">{t('charge.status.waived')}</option>
            </Select>
            <Input
              placeholder={t('charges.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full sm:w-44"
            />
            <Button leadingIcon={<PlayCircle className="h-4 w-4" />} onClick={() => void generate()} disabled={pending}>
              {pending ? t('app.loading') : t('money.rent_due')}
            </Button>
            <ExportCsvButton
              kind="charges"
              query={`periodKey=${periodKey}&calendar=${calendar}${status ? `&status=${status}` : ''}`}
            />
          </>
        }
      />

      {message ? (
        <Alert tone="success" className="mb-3">
          {message}
        </Alert>
      ) : null}
      {charges.error ? (
        <Alert tone="danger" className="mb-3">
          {charges.error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {charges.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('common.no_results')}
              description={`${t('money.rent_due')} — ${formatPeriodKey(periodKey, calendar, language)}`}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('reports.period')}</Th>
                  <Th>{t('charges.tenant')}</Th>
                  <Th>{t('charges.unit')}</Th>
                  <Th>{t('units.type')}</Th>
                  <Th>{t('money.amount')}</Th>
                  <Th>{t('money.paid')}</Th>
                  <Th>{t('money.outstanding')}</Th>
                  <Th>{t('lease.due_day')}</Th>
                  <Th>{t('charge.status.paid')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((charge) => {
                  const outstanding = Number(charge.amountMinor) - Number(charge.paidMinor);
                  return (
                    <tr key={charge.id}>
                      <Td>
                        {formatPeriodKey(charge.periodKey, charge.periodCalendar, language)}
                        <span className="block text-[11px] text-muted">{charge.description}</span>
                      </Td>
                      <Td className="font-medium text-strong">
                        {charge.tenant?.fullName ?? '—'}
                      </Td>
                      <Td>
                        {charge.lease ? (
                          <>
                            {charge.lease.unit.label}
                            <span className="block text-[11px] text-muted">
                              {charge.lease.unit.property.name}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{t(`charge.type.${charge.type}` as never)}</Td>
                      <Td className="tabular">
                        {formatAmount(charge.amountMinor, charge.currency, language)}
                      </Td>
                      <Td className="tabular">{formatAmount(charge.paidMinor, charge.currency, language)}</Td>
                      <Td className={cn('tabular', outstanding > 0 && 'font-medium text-red-600 dark:text-red-400')}>
                        {formatAmount(String(outstanding), charge.currency, language)}
                      </Td>
                      <Td>{formatDate(charge.dueDate, { language, calendar })}</Td>
                      <Td>
                        <Badge className={cn(statusTone[charge.status])}>
                          {t(`charge.status.${charge.status}` as never)}
                        </Badge>
                      </Td>
                      <Td>
                        {charge.status === 'open' || charge.status === 'partial' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setWaiveTarget({ id: charge.id, description: charge.description })}
                          >
                            {t('charge.status.waived')}
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={waiveTarget !== null}
        onOpenChange={(open) => (open ? undefined : setWaiveTarget(null))}
        title={`${t('charge.status.waived')} — ${waiveTarget?.description ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWaiveTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() => void waive()}
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="waive-reason">{t('common.actions')}</Label>
          <Textarea
            id="waive-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this charge being waived?"
          />
          <p className="text-[11px] text-muted">
            The charge stays in the ledger; a negative entry cancels the amount owed and the reason is kept.
          </p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
