'use client';

import { useState } from 'react';

import { MANUAL_PAYMENT_METHODS, PAYMENT_METHODS } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import { ExportCsvButton } from '@/components/export-csv-button';
import { MoneyInput } from '@/components/form-controls';
import { Modal } from '@/components/modal';
import { PaymentProofsReview } from '@/components/payment-proofs-review';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Icon, Input, Label, Select, Skeleton, Table, Td, Th } from '@/components/ui';

/**
 * Payments. Recording cash, a bank transfer or a cheque is the first-class flow;
 * Telebirr/Chapa payments arrive through their provider adapters and appear here
 * once confirmed. Corrections are reversals, never edits.
 */
export default function PaymentsPage() {
  const { t, language, calendar } = usePreferences();
  const [method, setMethod] = useState('');
  const payments = useAsync(
    () => api.payments(`?pageSize=100${method ? `&method=${method}` : ''}`),
    [method],
  );
  const leases = useAsync(() => api.leases(), []);
  const [open, setOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [form, setForm] = useState({
    leaseId: '',
    method: 'cash' as (typeof MANUAL_PAYMENT_METHODS)[number],
    reference: '',
    paidAt: new Date().toISOString().slice(0, 10),
  });
  const [amount, setAmount] = useState<number | null>(null);
  const { pending, error, message, setMessage, run } = useAction();

  useAutoOpenModal(() => setOpen(true));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const lease = leases.data?.leases.find((l) => l.id === form.leaseId);
      const currency = (lease?.currency as string | undefined) ?? 'ETB';
      const result = await api.recordPayment({
        leaseId: form.leaseId,
        amount: { amountMinor: amount ?? 0, currency },
        method: form.method,
        paidAt: new Date(`${form.paidAt}T12:00:00.000Z`).toISOString(),
        reference: form.reference || undefined,
      });
      setOpen(false);
      setAmount(null);
      setForm({ leaseId: '', method: 'cash', reference: '', paidAt: new Date().toISOString().slice(0, 10) });
      setMessage(t('payment.recorded', { receipt: result.receiptNumber }));
      payments.reload();
      leases.reload();
    }).catch(() => undefined);
  }

  async function reverse() {
    if (!reverseTarget) return;
    await run(async () => {
      await api.reversePayment(reverseTarget, reverseReason);
      setReverseTarget(null);
      setReverseReason('');
      setMessage(t('payment.reverse'));
      payments.reload();
    }).catch(() => undefined);
  }

  async function downloadReceipt(paymentId: string) {
    const response = await fetch(`/api/v1/payments/${paymentId}/receipt.pdf`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'receipt.pdf';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const rows = payments.data?.items ?? [];

  return (
    <div>
      <PageHeader
        titleKey="nav.payments"
        actions={
          <>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="h-9 w-40"
              aria-label={t('payment.filter_method')}
            >
              <option value="">{t('common.filters')}</option>
              {/* Every method money can arrive by — the demo gateway and the
                  providers that come online later included. */}
              {PAYMENT_METHODS.filter((option) => option !== 'other').map((option) => (
                <option key={option} value={option}>
                  {t(`payment.method.${option}` as never)}
                </option>
              ))}
              <option value="other">{t('payment.method.other' as never)}</option>
            </Select>
            <ExportCsvButton kind="payments" />
            <Button onClick={() => setOpen(true)}>
              <Icon name="plus" className="h-4 w-4" />
              {t('money.record_payment')}
            </Button>
          </>
        }
      />

      {message ? (
        <Alert tone="success" className="mb-3">
          {message}
        </Alert>
      ) : null}

      <div className="mb-4">
        <PaymentProofsReview onChanged={() => payments.reload()} />
      </div>

      <Card>
        <CardContent className="p-0">
          {payments.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : payments.error ? (
            <div className="p-4">
              <Alert tone="danger">{payments.error}</Alert>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('money.record_payment')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('money.receipt_number')}</Th>
                  <Th>{t('money.method')}</Th>
                  <Th>{t('money.amount')}</Th>
                  <Th>{t('reports.period')}</Th>
                  <Th>{t('unit.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => (
                  <tr key={payment.id}>
                    <Td className="font-medium tabular text-slate-900">{payment.receiptNumber ?? '—'}</Td>
                    <Td>{t(`payment.method.${payment.method}` as never)}</Td>
                    <Td className="tabular">
                      {formatAmount(payment.amountMinor, payment.currency, language)}
                    </Td>
                    <Td>{formatDate(payment.paidAt, { language, calendar })}</Td>
                    <Td>
                      <Badge
                        tone={
                          payment.status === 'succeeded'
                            ? 'brand'
                            : payment.status === 'reversed'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {t(`payment.status.${payment.status}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        {payment.status === 'succeeded' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void downloadReceipt(payment.id)}
                            >
                              {t('payment.receipt_download')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setReverseTarget(payment.id)}>
                              {t('payment.reverse')}
                            </Button>
                          </>
                        ) : null}
                      </div>
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
        title={t('money.record_payment')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="payment-form" type="submit" disabled={pending || amount === null}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="payment-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="leaseId">{t('nav.leases')}</Label>
            <Select
              id="leaseId"
              required
              value={form.leaseId}
              onChange={(event) => setForm((current) => ({ ...current, leaseId: event.target.value }))}
            >
              <option value="">{t('common.select')}</option>
              {(leases.data?.leases ?? [])
                .filter((lease) => lease.status === 'active')
                .map((lease) => (
                  <option key={lease.id} value={lease.id}>
                    {lease.unit.property.name} · {lease.unit.label} — {lease.tenant.fullName}
                  </option>
                ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <MoneyInput label={t('money.amount')} value={amount} onChange={setAmount} required />
          </div>

          <div className="space-y-1">
            <Label htmlFor="method">{t('money.method')}</Label>
            <Select
              id="method"
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value as typeof form.method }))
              }
            >
              {MANUAL_PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {t(`payment.method.${option}` as never)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="paidAt">{t('payment.paid_on')}</Label>
            <Input
              id="paidAt"
              type="date"
              value={form.paidAt}
              onChange={(event) => setForm((current) => ({ ...current, paidAt: event.target.value }))}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="reference">{t('payment.reference')}</Label>
            <Input
              id="reference"
              value={form.reference}
              onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
              placeholder={t('payment.reference_placeholder')}
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
        open={reverseTarget !== null}
        onOpenChange={(value) => (value ? undefined : setReverseTarget(null))}
        title={t('payment.reverse')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReverseTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => void reverse()}>
              {pending ? t('app.loading') : t('payment.reverse')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="reverse-reason">{t('payment.reverse_reason')}</Label>
          <Input
            id="reverse-reason"
            value={reverseReason}
            onChange={(event) => setReverseReason(event.target.value)}
          />
          <p className="text-[11px] text-slate-500">{t('payment.reverse_hint')}</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
