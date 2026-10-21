'use client';

import { Add } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';

import { BILLING_FREQUENCIES, DEPOSIT_TYPES, LEASE_STATUSES, type BillingFrequency, type DepositType, type LeaseStatus } from '@pms/shared';
import { todayIn, type CivilDate } from '@pms/calendar';

import { usePropertyContext } from '@/lib/property-context';
import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { useOrgSettings } from '@/lib/org-settings';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { ExportCsvButton } from '@/components/export-csv-button';
import { DateField } from '@/components/date-field';
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
  const { settings: orgSettings, loading: settingsLoading, error: settingsError, billingCalendar } = useOrgSettings();
  const [propertyContext] = usePropertyContext();
  const defaultsApplied = useRef(false);
  const leases = useAsync(() => api.leases(), []);
  const units = useAsync(() => api.units(), []);
  const tenants = useAsync(() => api.tenants(), []);
  const [open, setOpen] = useState(false);
  const [terminateId, setTerminateId] = useState<string | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const { pending, error, run } = useAction();

  useAutoOpenModal(() => setOpen(true));

  const visibleLeases = (leases.data?.leases ?? []).filter(
    (lease) => propertyContext === null || lease.unit.property.id === propertyContext,
  );

  const [form, setForm] = useState<{
    unitId: string;
    tenantId: string;
    billingFrequency: BillingFrequency;
    status: LeaseStatus;
    dueDayOfMonth: number;
    startDate: CivilDate;
    endDate: CivilDate | null;
  }>({
    unitId: '',
    tenantId: '',
    billingFrequency: 'monthly',
    status: 'active',
    dueDayOfMonth: 5,
    startDate: todayIn(calendar),
    endDate: null,
  });
  const [rent, setRent] = useState<number | null>(null);
  const [depositMode, setDepositMode] = useState<DepositType>('months_of_rent');
  const [depositMonths, setDepositMonths] = useState(2);
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  // Optional: the signed lease captured in the same flow, filed against the new
  // lease so the tenant sees it in their portal Documents from day one.
  const [leaseFile, setLeaseFile] = useState<File | null>(null);

  useEffect(() => {
    if (!orgSettings || defaultsApplied.current) return;
    defaultsApplied.current = true;
    // Dates are entered in the organization's billing calendar; the lease
    // itself inherits that calendar on the server, so it is not in the form.
    setForm((current) => ({
      ...current,
      startDate: todayIn(billingCalendar),
      dueDayOfMonth: typeof orgSettings.rentDueDay === 'number' ? orgSettings.rentDueDay : 5,
    }));
  }, [orgSettings, billingCalendar]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const currency = (orgSettings?.currency as string | undefined) ?? 'ETB';
      const created = await api.createLease({
        unitId: form.unitId,
        tenantId: form.tenantId,
        billingFrequency: form.billingFrequency,
        status: form.status,
        dueDayOfMonth: form.dueDayOfMonth,
        gracePeriodDays:
          typeof orgSettings?.gracePeriodDays === 'number' ? orgSettings.gracePeriodDays : 0,
        lateFeePercent:
          orgSettings?.lateFeeEnabled && orgSettings?.lateFeeType === 'percent'
            ? orgSettings.lateFeePercent
            : undefined,
        startDate: form.startDate,
        endDate: form.endDate,
        rentAmount: { amountMinor: rent ?? 0, currency },
        // Months-of-rent deposits count as advance rent server-side: the first
        // months are charged and settled, so the tenant starts "paid".
        depositType: depositMode,
        depositMonths: depositMode === 'months_of_rent' ? depositMonths : undefined,
        depositAmount:
          depositMode === 'fixed' && depositAmount !== null
            ? { amountMinor: depositAmount, currency }
            : undefined,
      });
      if (leaseFile) {
        // The lease exists at this point; a failed upload must not make the
        // landlord re-enter the whole lease. Re-throw with a message, lease stays.
        try {
          const unit = units.data?.units.find((candidate) => candidate.id === form.unitId);
          const dataBase64 = await readAsBase64(leaseFile);
          await api.uploadDocument({
            category: 'lease_agreement',
            title: `${t('documents.lease_file')} — ${unit?.label ?? created.lease.id}`,
            filename: leaseFile.name,
            mimeType: leaseFile.type,
            dataBase64,
            leaseId: created.lease.id,
            tenantId: form.tenantId,
          });
        } catch {
          throw new Error(t('documents.lease_upload_failed'));
        }
      }
      setOpen(false);
      setRent(null);
      setDepositAmount(null);
      setLeaseFile(null);
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
      {settingsError && <Alert tone="danger">{settingsError}</Alert>}
      <PageHeader
        titleKey="nav.leases"
        actions={
          <>
            <ExportCsvButton kind="leases" />
            <Button onClick={() => setOpen(true)}>
              <Add className="h-4 w-4" />
              {t('common.create')}
            </Button>
          </>
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
          ) : visibleLeases.length === 0 ? (
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
                {visibleLeases.map((lease) => (
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
                      className={cn(
                        'tabular',
                        // Owed reads red, credit reads grey: a negative balance is
                        // money the landlord holds, not a debt of the tenant.
                        Number(lease.balanceMinor) > 0 && 'font-medium text-red-600',
                        Number(lease.balanceMinor) < 0 && 'text-slate-400',
                      )}
                      title={
                        Number(lease.balanceMinor) < 0 ? t('money.balance_credit_hint') : undefined
                      }
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
              <option value="">{t('common.select')}</option>
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
              <option value="">{t('common.select')}</option>
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
            <Label>{t('lease.billing_calendar')}</Label>
            <p className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
              {billingCalendar === 'gregorian' ? t('calendar.gregorian') : t('calendar.ethiopian')}
              <span className="ml-1 text-xs text-slate-400">({t('common.organization_default')})</span>
            </p>
            <p className="text-[11px] text-slate-500">{t('lease.billing_calendar_inherited')}</p>
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
            calendar={billingCalendar}
            required
          />
          <DateField
            label={`${t('lease.end_date')} (${t('common.optional')})`}
            value={form.endDate}
            onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
            calendar={billingCalendar}
          />

          <div className="space-y-1">
            <Label htmlFor="depositType">{t('lease.deposit')}</Label>
            <Select
              id="depositType"
              value={depositMode}
              onChange={(event) => setDepositMode(event.target.value as DepositType)}
            >
              {DEPOSIT_TYPES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`lease.deposit_type.${mode}` as never)}
                </option>
              ))}
            </Select>
            {depositMode === 'months_of_rent' ? (
              <p className="text-[11px] text-slate-500">{t('lease.deposit_advance_hint')}</p>
            ) : null}
          </div>

          {depositMode === 'months_of_rent' ? (
            <div className="space-y-1">
              <Label htmlFor="depositMonths">{t('lease.deposit_months')}</Label>
              <Input
                id="depositMonths"
                type="number"
                min={1}
                max={24}
                value={depositMonths}
                onChange={(event) => setDepositMonths(Number(event.target.value))}
              />
            </div>
          ) : null}

          {depositMode === 'fixed' ? (
            <div className="sm:col-span-2">
              <MoneyInput label={t('lease.deposit_fixed_amount')} value={depositAmount} onChange={setDepositAmount} />
            </div>
          ) : null}

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="leaseFile">{`${t('documents.lease_file')} (${t('common.optional')})`}</Label>
            <Input
              id="leaseFile"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setLeaseFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-slate-500">{t('documents.lease_file_hint')}</p>
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
              disabled={pending || settingsLoading || !!settingsError}
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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
