'use client';

/**
 * The Chapa checkout return / sandbox page.
 *
 * Two arrival paths share this URL:
 *
 * 1. **Sandbox simulation** (no real Chapa key set): the redirect URL from the
 *    API carries `tx_ref`; the page shows amount + a "Confirm payment" button.
 *    Clicking it calls `/complete`, which runs the in-process mock verify.
 * 2. **Real Chapa return** (CHASECK_TEST-... or live key set): the tenant has
 *    already paid on Chapa's hosted checkout; Chapa redirects back with
 *    `trx_ref` (and `status`, `ref_id` etc.). The page detects `trx_ref` and
 *    auto-calls `/complete` — the server still re-verifies with Chapa's
 *    `/transaction/verify/{tx_ref}` (Chapa's docs: verify is the source of
 *    truth, the webhook is only a trigger), so this is safe even if Chapa's
 *    redirect is tampered with.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

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
  // Real Chapa redirects back with `trx_ref`; the sandbox uses `tx_ref`.
  const providerRef = params.get('tx_ref') ?? params.get('trx_ref') ?? params.get('ref') ?? '';
  // Real Chapa return signals auto-complete; the sandbox sim signals manual confirm.
  // (Use `get` instead of `has` so test mocks that only stub `get` keep working.)
  const isRealChapaReturn = params.get('trx_ref') !== null;
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
  // Guard against double-completing in StrictMode and on hot reloads.
  const autoFiredRef = useRef(false);

  async function confirm() {
    await run(async () => {
      const result = await api.portalCompletePayment(providerRef);
      setCompleted(result);
    }).catch(() => undefined);
  }

  // Real-Chapa return: the tenant has already paid. Auto-verify+complete on
  // first arrival once the intent is loaded and still pending. (If the intent
  // is already succeeded, the receipt branch handles it without another call.)
  useEffect(() => {
    if (!isRealChapaReturn || autoFiredRef.current) return;
    if (!intent.data || intent.data.status === 'succeeded') return;
    autoFiredRef.current = true;
    void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealChapaReturn, intent.data]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  const alreadySucceeded = intent.data?.status === 'succeeded';
  // When the tenant comes back from real Chapa, we auto-fire /complete (above);
  // hide the manual "Confirm payment" branch during that window so the user
  // doesn't see a button that's about to disappear.
  const autoCompleting = isRealChapaReturn && !completed && !alreadySucceeded && completing;

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Logo size={34} onDark={false} />
          <p className="flex items-center gap-2 text-sm font-semibold text-strong">
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
                    <p className="text-sm font-semibold text-strong">{t('portal.payment_success')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular text-strong">
                      {formatAmount(intent.data.amountMinor, intent.data.currency, language)}
                    </p>
                    {completed ? (
                      <p className="mt-1 text-xs text-muted">
                        {t('portal.payment_receipt', { receipt: completed.receiptNumber })}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted">{t('portal.payment_success_hint')}</p>
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
              ) : autoCompleting ? (
                <div className="space-y-3 py-2 text-center">
                  <Skeleton className="mx-auto h-8 w-40" />
                  <p className="text-xs text-muted">{t('portal.pay_starting')}</p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted">{t('portal.due_balance')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular text-strong">
                      {formatAmount(intent.data.amountMinor, intent.data.currency, language)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {session.organization.name} · {intent.data.providerRef}
                    </p>
                  </div>
                  {isRealChapaReturn ? null : (
                    <div className="flex flex-wrap gap-1.5">
                      {(['telebirr', 'cbe_birr', 'amole', 'chapa'] as const).map((method) => (
                        <span
                          key={method}
                          className="rounded-full border border-line bg-wash px-2.5 py-1 text-xs font-medium text-soft"
                        >
                          {t(`payment.method.${method}` as never)}
                        </span>
                      ))}
                    </div>
                  )}
                  {completeError ? <Alert tone="danger">{completeError}</Alert> : null}
                  {/* Real Chapa return: no manual button — the page auto-completes.
                      Sandbox sim: show the explicit "Confirm payment" button. */}
                  {isRealChapaReturn ? null : (
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
                  )}
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
