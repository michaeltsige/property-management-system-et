'use client';

/**
 * The Chapa sandbox checkout — what tenants see while an organization runs the
 * Chapa gateway in test mode.
 *
 * Live Chapa sends the payer to checkout.chapa.co and redirects back with
 * `trx_ref`/`status` params; the sandbox simulates exactly that loop on this
 * app: the reference in the URL is the only state, everything else is
 * re-fetched from `GET /portal/payments/:providerRef` (scoped server-side to
 * the signed-in tenant, so an edited URL can only ever show that tenant's own
 * attempts), and confirming re-verifies with the provider before any money is
 * recorded. It is clearly labelled as a sandbox — no real money moves here.
 * When the organization switches the gateway to live mode, tenants are sent to
 * Chapa's own checkout instead and this page only serves as the return URL.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Logo } from '@/components/logo';
import { api, ApiError } from '@/lib/api';
import { formatAmount } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import type { PortalCompletedPayment } from '@/lib/types';

import { Alert, Badge, Button, Card, CardContent, Skeleton } from '@/components/ui';

function ChapaSandboxCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  // Live Chapa redirects back with `trx_ref`; the sandbox uses `tx_ref`.
  const providerRef = params.get('tx_ref') ?? params.get('trx_ref') ?? params.get('ref') ?? '';
  const { session, ready, language, t } = usePreferences();

  useEffect(() => {
    if (ready && !session) router.replace('/portal/login');
  }, [ready, session, router]);

  const intent = useAsync(
    () =>
      ready && session
        ? providerRef
          ? api.portalPaymentIntent(providerRef)
          : Promise.reject(new ApiError(404, 'NOT_FOUND', t('portal.payment_not_found')))
        : Promise.resolve(null),
    [ready, session, providerRef, t],
  );
  const { pending: completing, error: completeError, run } = useAction();
  const [completed, setCompleted] = useState<PortalCompletedPayment | null>(null);

  async function confirm() {
    await run(async () => {
      const result = await api.portalCompletePayment(providerRef);
      setCompleted(result);
    }).catch(() => undefined);
  }

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  const alreadySucceeded = intent.data?.status === 'succeeded';

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Logo size={34} onDark={false} />
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {t('portal.chapa_title')}
            <Badge tone="warning">{t('org.gateway_mode_test')}</Badge>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        <Alert tone="warning">{t('portal.chapa_hint')}</Alert>

        {intent.loading ? (
          <Card>
            <CardContent className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ) : intent.error ? (
          <Alert tone="danger">{intent.error}</Alert>
        ) : intent.data ? (
          <Card>
            <CardContent className="space-y-4">
              {completed || alreadySucceeded ? (
                <>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t('portal.payment_success')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular text-slate-900">
                      {formatAmount(intent.data.amountMinor, intent.data.currency, language)}
                    </p>
                    {completed ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {t('portal.payment_receipt', { receipt: completed.receiptNumber })}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500">{t('portal.payment_success_hint')}</p>
                  <div className="space-y-2">
                    <a
                      href={`/api/v1/portal/payments/${encodeURIComponent(providerRef)}/receipt.pdf`}
                      className="block"
                    >
                      <Button variant="secondary" className="w-full">
                        {t('payment.receipt_download')}
                      </Button>
                    </a>
                    <Link href="/portal">
                      <Button className="w-full">{t('portal.back_to_portal')}</Button>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-slate-500">{t('portal.due_balance')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular text-slate-900">
                      {formatAmount(intent.data.amountMinor, intent.data.currency, language)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {session.organization.name} · {intent.data.providerRef}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['telebirr', 'cbe_birr', 'amole', 'chapa'] as const).map((method) => (
                      <span
                        key={method}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                      >
                        {t(`payment.method.${method}` as never)}
                      </span>
                    ))}
                  </div>
                  {completeError ? <Alert tone="danger">{completeError}</Alert> : null}
                  <div className="space-y-2">
                    <Button className="w-full" onClick={confirm} disabled={completing}>
                      {completing ? t('portal.pay_starting') : t('portal.chapa_confirm')}
                    </Button>
                    <Link href="/portal" className="block">
                      <Button variant="secondary" className="w-full">
                        {t('portal.mock_cancel')}
                      </Button>
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}

export default function ChapaSandboxCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <Skeleton className="h-10 w-64" />
        </div>
      }
    >
      <ChapaSandboxCheckout />
    </Suspense>
  );
}
