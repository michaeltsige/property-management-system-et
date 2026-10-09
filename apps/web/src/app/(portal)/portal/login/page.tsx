'use client';

/**
 * Tenant portal sign-in: phone number -> one-time code.
 *
 * There is no password anywhere in this flow. The server answers identically
 * for known and unknown numbers, so the form can never hint whether a phone
 * number rents in a managed building.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Logo } from '@/components/logo';
import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function PortalLoginPage() {
  const router = useRouter();
  const { signIn, t } = usePreferences();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.portalRequestCode({ phone });
      setStep('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api.portalVerify({ phone, code });
      // Identity only; the tokens stayed server-side in HttpOnly cookies.
      signIn({ user: result.user, organization: result.organization, role: result.role });
      router.replace('/portal');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      {/* Same hero treatment as the staff sign-in: one photograph, one flat
          overlay, one card — no decorative chrome. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/login-hero.jpg')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-ink-950/60" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo size={52} className="mx-auto mb-3" />
          <h1 className="text-xl font-semibold tracking-tight text-white">{t('portal.title')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('portal.login_hint')}</p>
        </div>

        <Card className="shadow-xl">
          <CardContent className="py-2">
            {step === 'phone' ? (
              <form className="space-y-4" onSubmit={requestCode}>
                <div className="space-y-1">
                  <Label htmlFor="portal-phone">{t('portal.phone')}</Label>
                  <Input
                    id="portal-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0911234567"
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </div>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? t('app.loading') : t('portal.send_code')}
                </Button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={verify}>
                <Alert tone="info">{t('portal.code_sent')}</Alert>
                <div className="space-y-1">
                  <Label htmlFor="portal-code">{t('portal.code')}</Label>
                  {/* Six digits, centred and letter-spaced: the input should
                      look like the code that just arrived by SMS. */}
                  <Input
                    id="portal-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    className="tabular text-center text-lg tracking-[0.4em]"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
                  {pending ? t('app.loading') : t('portal.verify')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}
                >
                  {t('portal.resend')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
