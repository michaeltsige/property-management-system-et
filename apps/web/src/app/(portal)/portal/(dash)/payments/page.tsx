'use client';

/**
 * Tenant payment history: every payment recorded against this tenant with its
 * receipt, plus the proof-of-payment upload flow for offline methods.
 */

import { formatAmount, formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { PortalPaymentProofs } from '@/components/portal-proofs';
import {
  Alert,
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

export default function PortalPaymentsPage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const payments = useAsync(
    () => (isTenant && ready ? api.portalPayments() : Promise.resolve(null)),
    [isTenant, ready],
  );
  const { pending: checking, error: checkError, run: runCheck } = useAction();

  /**
   * Re-verify the pending attempt with the provider and complete it — the
   * completion path when the provider could not redirect the tenant back
   * (Chapa rejects plain-http origins, so dev checkouts get no auto-return).
   */
  async function checkPendingPayment(providerRef: string) {
    await runCheck(async () => {
      await api.portalCompletePayment(providerRef);
      payments.reload();
    }).catch(() => undefined);
  }

  if (!ready || !isTenant) return null;
  const currency = session.organization.currency;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-strong">{t('portal.nav.payments')}</h1>

      {/* A started-but-unconfirmed attempt stays visible until it completes. */}
      {payments.data?.pending ? (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-strong">{t('portal.payment_pending_title')}</p>
            <p className="text-xs text-muted">
              {formatAmount(payments.data.pending.amountMinor, payments.data.pending.currency, language)} ·{' '}
              {t('portal.payment_pending_hint', { provider: payments.data.pending.provider })}
            </p>
            <Button
              variant="secondary"
              onClick={() => checkPendingPayment(payments.data!.pending!.providerRef)}
              disabled={checking}
              className="w-full sm:w-auto"
            >
              {t('portal.payment_check')}
            </Button>
            {checkError ? <Alert tone="danger">{checkError}</Alert> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Desktop: history on the left, the transfer-proof upload on the right —
          the two things a tenant comes to this page for, without a second trip.
          Phones stack them in the same order as before. */}
      <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('portal.payments_title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payments.loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : payments.error ? (
              <div className="space-y-3 p-4">
                <Alert tone="danger">
                  {t('portal.load_failed')} {payments.error}
                </Alert>
                <Button variant="secondary" onClick={() => payments.reload()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : (payments.data?.items.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title={t('portal.payments_empty')} description="" />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('portal.paid_on')}</Th>
                    <Th>{t('payment.method_label')}</Th>
                    <Th>{t('portal.reference')}</Th>
                    <Th>{t('portal.amount')}</Th>
                    <Th>{t('portal.receipt')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {(payments.data?.items ?? []).map((payment) => (
                    <tr key={payment.id}>
                      <Td>{formatDate(payment.paidAt, { language, calendar })}</Td>
                      <Td>{t(`payment.method.${payment.method}` as never)}</Td>
                      <Td className="max-w-40 truncate text-soft">
                        {payment.reference ?? payment.receiptNumber ?? '—'}
                      </Td>
                      <Td className="tabular font-medium text-strong">
                        {formatAmount(payment.amountMinor, payment.currency ?? currency, language)}
                      </Td>
                      <Td>
                        {payment.receiptNumber ? (
                          <a
                            href={api.portalReceiptUrl(payment.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline"
                          >
                            {t('portal.download')}
                          </a>
                        ) : (
                          <span className="text-xs text-faint">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <PortalPaymentProofs currency={currency} />
        </div>
      </div>
    </div>
  );
}
