'use client';

/**
 * The forgot-password door (staff accounts only — tenants sign in with an OTP
 * and have no password). Asks for the account email; the API emails a 6-digit
 * code. The response is identical for unknown addresses, so this screen can
 * never be used to find out who has an account.
 */

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Logo } from '@/components/logo';
import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function ForgotPasswordPage() {
  const { t } = usePreferences();
  const [email, setEmail] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await api.forgotPassword({ email: email.trim() });
      setSent(true);
      // Development affordance only: with the mock mail provider there is no
      // inbox, so the code is echoed here; production never sees it.
      if (result.devResetCode) setDevCode(result.devResetCode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-y-auto px-4 py-6">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/login-hero.jpg')" }}
      />
      <div aria-hidden="true" className="fixed inset-0 bg-ink-950/60" />
      <div className="relative w-full max-w-sm">
        <div className="mb-5 text-center">
          <Logo size={72} onDark className="mx-auto mb-2" />
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{t('auth.forgot_title')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('app.tagline')}</p>
        </div>

        <Card className="shadow-float">
          <CardContent className="py-2">
            {sent ? (
              <div className="space-y-4 py-2">
                <Alert tone="success">{t('auth.forgot_sent')}</Alert>
                {devCode ? <Alert tone="info">{t('auth.dev_code', { code: devCode })}</Alert> : null}
                <Button asChild className="w-full">
                  <Link href={`/reset-password?email=${encodeURIComponent(email.trim())}`}>
                    {t('auth.reset_title')}
                  </Link>
                </Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-1">
                  <Label htmlFor="email" required>
                    {t('auth.email')}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <p className="text-xs text-muted">{t('auth.forgot_hint')}</p>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? t('app.loading') : t('auth.forgot_submit')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-white/80">
          <Link href="/login" className="underline-offset-2 hover:underline">
            {t('auth.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  );
}
