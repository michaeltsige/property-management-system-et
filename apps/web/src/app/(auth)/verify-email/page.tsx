'use client';

/**
 * The verify-email door: after signup (or an unverified login attempt) the user
 * types the 6-digit code the API emailed them. Redeeming it activates the
 * account AND starts the first session — the web server exchanges the code for
 * HttpOnly cookies, exactly like a login, so they land straight in the app.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { signIn, t } = usePreferences();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Development affordance: with the mock mail provider there is no inbox, so
  // the API echoes the code back; production never sees it.
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('email');
    if (fromUrl) setEmail(fromUrl);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await api.verifyEmail({ email: email.trim(), code: code.trim() });
      signIn({
        // Identity only: the tokens stayed on the web server, inside HttpOnly
        // cookies this code cannot read (ADR-0026).
        user: result.user,
        organization: result.organization,
        role: result.role ?? result.memberships[0]?.role ?? '',
      });
      // Fresh signups continue into onboarding; a login-gate redirect lands on
      // the dashboard. `?next=` carries the destination either way.
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      const result = await api.resendVerification({ email: email.trim() });
      if (result.devVerificationCode) setDevCode(result.devVerificationCode);
      setNotice(t('auth.verify_resent'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-strong sm:text-xl">{t('auth.verify_title')}</h1>
        </div>

        <Card>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted">{t('auth.verify_hint', { email: email.trim() || '…' })}</p>
              <div className="space-y-1">
                <Label htmlFor="code" required>
                  {t('auth.verify_code')}
                </Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="123456"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                />
              </div>
              {devCode ? <Alert tone="info">{t('auth.dev_code', { code: devCode })}</Alert> : null}
              {notice ? <Alert tone="success">{notice}</Alert> : null}
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
                {pending ? t('app.loading') : t('auth.verify_submit')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={pending}
                onClick={() => void onResend()}
              >
                {t('auth.verify_resend')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
