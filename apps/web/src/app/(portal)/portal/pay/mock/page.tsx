'use client';

/**
 * The mock provider's "hosted checkout" page.
 *
 * A real Telebirr/Chapa flow sends the payer to the provider's own site and the
 * provider redirects back. The mock adapter has no external site, so this page
 * stands in for one: it shows the pending attempt, confirms it through the API
 * (which re-verifies with the provider before recording any money) and shows the
 * receipt. It is clearly labelled as simulated — no real money can move here.
 *
 * The reference in the URL is the only state: everything else is re-fetched from
 * `GET /portal/payments/:providerRef`, scoped server-side to the signed-in
 * tenant, so an edited URL can only ever show that tenant's own attempts.
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

import { Alert, Button, Card, CardContent, Skeleton } from '@/components/ui';

function MockCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  const providerRef = params.get('ref') ?? '';
  const { session, ready, language, t } = usePreferences();

  useEffect(() => {
    if (ready && !session) router.replace('/portal/login');
  }, [ready, session, router]);

  const intent = useAsync(
    () =>
      ready && session
        ? providerRef
          ? api.portalPaymentIntent(providerRef)
          : Promise.reject(new ApiError(404, 'NOT_FOUND', 'Payment not found'))
        : Promise.resolve(null),
    [ready, session, providerRef],
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  const alreadySucceeded = intent.data?.status === 'succeeded';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Logo size={30} />
          <p className="text-sm font-semibold text-slate-900">{t('portal.mock_title')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        <Alert tone="warning">{t('portal.mock_hint')}</Alert>

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
                  <Link href="/portal">
                    <Button className="w-full">{t('portal.back_to_portal')}</Button>
                  </Link>
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
                  {completeError ? <Alert tone="danger">{completeError}</Alert> : null}
                  <div className="space-y-2">
                    <Button className="w-full" onClick={confirm} disabled={completing}>
                      {t('portal.mock_confirm')}
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

export default function MockCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <Skeleton className="h-10 w-64" />
        </div>
      }
    >
      <MockCheckout />
    </Suspense>
  );
}
