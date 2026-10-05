'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { BILLING_FREQUENCIES, LEASE_STATUSES, type BillingFrequency, type LeaseStatus } from '@pms/shared';
import { todayIn, type CalendarKind, type CivilDate } from '@pms/calendar';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { DateField } from '@/components/ethiopian-date-picker';
import { MoneyInput } from '@/components/form-controls';
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
  Th,
} from '@/components/ui';

export default function LeasesPage() {
  const { t, language, calendar } = usePreferences();
  const leases = useAsync(() => api.leases(), []);
  const units = useAsync(() => api.units(), []);
  const tenants = useAsync(() => api.tenants(), []);
  const [open, setOpen] = useState(false);
  const [terminateId, setTerminateId] = useState<string | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const { pending, error, run } = useAction();

  useAutoOpenModal(() => setOpen(true));

  const [form, setForm] = useState<{
    unitId: string;
    tenantId: string;
    billingCalendar: CalendarKind;
    billingFrequency: BillingFrequency;
    status: LeaseStatus;
    dueDayOfMonth: number;
    startDate: CivilDate;
    endDate: CivilDate | null;
  }>({
    unitId: '',
    tenantId: '',
    billingCalendar: calendar,
    billingFrequency: 'monthly',
    status: 'active',
    dueDayOfMonth: 5,
    startDate: todayIn(calendar),
    endDate: null,
  });
  const [rent, setRent] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createLease({
        unitId: form.unitId,
        tenantId: form.tenantId,
        billingCalendar: form.billingCalendar,
        billingFrequency: form.billingFrequency,
        status: form.status,
        dueDayOfMonth: form.dueDayOfMonth,
        startDate: form.startDate,
        endDate: form.endDate,
        rentAmount: { amountMinor: rent ?? 0, currency: 'ETB' },
        depositAmount: deposit === null ? undefined : { amountMinor: deposit, currency: 'ETB' },
        depositType: deposit === null ? 'none' : 'fixed_amount',
      });
      setOpen(false);
      setRent(null);
      setDeposit(null);
      leases.reload();
      units.reload();
    }).catch(() => undefined);
  }

  async function terminate(reason: string) {
    if (!terminateId) return;
    await run(async () => {
      await api.terminateLease(terminateId, {
        terminatedOn: todayIn(calendar),
        reason: reason || undefined,
      });
      setTerminateId(null);
      setTerminateReason('');
      leases.reload();
    }).catch(() => undefined);
  }

  const unoccupied = (units.data?.units ?? []).filter((unit) => unit.status !== 'occupied');

  return (
    <div>
      <PageHeader
        titleKey="nav.leases"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('common.create')}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {leases.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : leases.error ? (
            <div className="p-4">
              <Alert tone="danger">{leases.error}</Alert>
            </div>
          ) : (leases.data?.leases.length ?? 0) === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('lease.title')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('nav.units')}</Th>
                  <Th>{t('nav.tenants')}</Th>
                  <Th>{t('lease.rent_amount')}</Th>
                  <Th>{t('lease.due_day')}</Th>
                  <Th>{t('lease.billing_calendar')}</Th>
                  <Th>{t('lease.start_date')}</Th>
                  <Th>{t('money.balance')}</Th>
                  <Th>{t('lease.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {leases.data?.leases.map((lease) => (
                  <tr key={lease.id}>
                    <Td>
                      <span className="font-medium text-slate-900">{lease.unit.label}</span>
                      <span className="block text-[11px] text-slate-500">{lease.unit.property.name}</span>
                    </Td>
                    <Td>
                      {lease.tenant.fullName}
                      {lease.tenant.phone ? (
                        <span className="block text-[11px] text-slate-500 tabular">{lease.tenant.phone}</span>
                      ) : null}
                    </Td>
                    <Td className="tabular">
                      {formatAmount(lease.rentAmountMinor, lease.currency, language)}
                    </Td>
                    <Td className="tabular">{lease.dueDayOfMonth}</Td>
                    <Td>
                      <Badge tone={lease.billingCalendar === 'ethiopian' ? 'gold' : 'neutral'}>
                        {lease.billingCalendar === 'ethiopian'
                          ? t('calendar.ethiopian')
                          : t('calendar.gregorian')}
                      </Badge>
                    </Td>
                    <Td>{formatDate(lease.startDate, { language, calendar: lease.billingCalendar })}</Td>
                    <Td
                      className={cn('tabular', Number(lease.balanceMinor) > 0 && 'font-medium text-red-600')}
                    >
                      {formatAmount(lease.balanceMinor, lease.currency, language)}
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[lease.status])}>
                        {t(`lease.status.${lease.status}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      {lease.status === 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => setTerminateId(lease.id)}>
                          {t('lease.terminate')}
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('common.create')}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="lease-form" type="submit" disabled={pending || rent === null}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="lease-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="unitId">{t('nav.units')}</Label>
            <Select
              id="unitId"
              required
              value={form.unitId}
              onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}
            >
              <option value="">—</option>
              {unoccupied.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.property?.name ? `${unit.property.name} · ` : ''}
                  {unit.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tenantId">{t('nav.tenants')}</Label>
            <Select
              id="tenantId"
              required
              value={form.tenantId}
              onChange={(event) => setForm((current) => ({ ...current, tenantId: event.target.value }))}
            >
              <option value="">—</option>
              {tenants.data?.tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.fullName}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <MoneyInput label={t('lease.rent_amount')} value={rent} onChange={setRent} required />
          </div>

          <div className="space-y-1">
            <Label htmlFor="billingCalendar">{t('lease.billing_calendar')}</Label>
            <Select
              id="billingCalendar"
              value={form.billingCalendar}
              onChange={(event) =>
                setForm((current) => ({ ...current, billingCalendar: event.target.value as CalendarKind }))
              }
            >
              <option value="ethiopian">{t('calendar.ethiopian')}</option>
              <option value="gregorian">{t('calendar.gregorian')}</option>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="billingFrequency">{t('lease.billing_frequency')}</Label>
            <Select
              id="billingFrequency"
              value={form.billingFrequency}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billingFrequency: event.target.value as BillingFrequency,
                }))
              }
            >
              {BILLING_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {t(`billing.${frequency}` as never)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="dueDayOfMonth">{t('lease.due_day')}</Label>
            <Input
              id="dueDayOfMonth"
              type="number"
              min={1}
              max={30}
              value={form.dueDayOfMonth}
              onChange={(event) =>
                setForm((current) => ({ ...current, dueDayOfMonth: Number(event.target.value) }))
              }
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="status">{t('lease.status')}</Label>
            <Select
              id="status"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as LeaseStatus }))
              }
            >
              {LEASE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`lease.status.${status}` as never)}
                </option>
              ))}
            </Select>
          </div>

          <DateField
            label={t('lease.start_date')}
            value={form.startDate}
            onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
            required
          />
          <DateField
            label={`${t('lease.end_date')} (${t('common.optional')})`}
            value={form.endDate}
            onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
          />

          <div className="sm:col-span-2">
            <MoneyInput
              label={`${t('lease.deposit')} (${t('common.optional')})`}
              value={deposit}
              onChange={setDeposit}
            />
          </div>

          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={terminateId !== null}
        onOpenChange={(value) => (value ? undefined : setTerminateId(null))}
        title={t('lease.terminate')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTerminateId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void terminate(terminateReason)}
            >
              {pending ? t('app.loading') : t('lease.terminate')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="terminate-reason">{t('lease.terminate_reason')}</Label>
          <Input
            id="terminate-reason"
            value={terminateReason}
            onChange={(event) => setTerminateReason(event.target.value)}
          />
          <p className="text-[11px] text-slate-500">{t('lease.terminate_hint')}</p>
        </div>
        {error ? (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        ) : null}
      </Modal>
    </div>
  );
}
