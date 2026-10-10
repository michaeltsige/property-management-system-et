'use client';

/**
 * Tenant payment history: every payment recorded against this tenant with its
 * receipt, plus the proof-of-payment upload flow for offline methods.
 */

import { formatAmount, formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { PortalPaymentProofs } from '@/components/portal-proofs';
import {
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

  if (!ready || !isTenant) return null;
  const currency = session.organization.currency;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{t('portal.nav.payments')}</h1>

      <Card>
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
            <div className="p-4 text-sm text-red-700">{payments.error}</div>
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
                    <Td className="max-w-40 truncate text-slate-600">
                      {payment.reference ?? payment.receiptNumber ?? '—'}
                    </Td>
                    <Td className="tabular font-medium text-slate-900">
                      {formatAmount(payment.amountMinor, payment.currency ?? currency, language)}
                    </Td>
                    <Td>
                      {payment.receiptNumber ? (
                        <a
                          href={api.portalReceiptUrl(payment.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {t('portal.download')}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PortalPaymentProofs currency={currency} />
    </div>
  );
}
