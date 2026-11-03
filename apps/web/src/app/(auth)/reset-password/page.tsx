'use client';

/**
 * The second half of password reset: the emailed 6-digit code plus the new
 * password. Success revokes every existing session, so the user signs in with
 * the new password afterwards.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Logo } from '@/components/logo';
import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function ResetPasswordPage() {
  const { t } = usePreferences();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('email');
    if (fromUrl) setEmail(fromUrl);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('auth.reset_password_mismatch'));
      return;
    }
    setPending(true);
    try {
      await api.resetPassword({ email: email.trim(), code: code.trim(), password });
      setDone(true);
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
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{t('auth.reset_title')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('app.tagline')}</p>
        </div>

        <Card className="shadow-float">
          <CardContent className="py-2">
            {done ? (
              <div className="space-y-4 py-2">
                <Alert tone="success">{t('auth.reset_done')}</Alert>
                <Button asChild className="w-full">
                  <Link href="/login">{t('auth.sign_in')}</Link>
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
                <div className="space-y-1">
                  <Label htmlFor="code" required>
                    {t('auth.reset_code')}
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
                <div className="space-y-1">
                  <Label htmlFor="password" required>
                    {t('auth.reset_new_password')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-[11px] text-muted">
                    At least 10 characters, including at least one letter and one number.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirm" required>
                    {t('auth.reset_confirm')}
                  </Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    required
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </div>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? t('app.loading') : t('auth.reset_submit')}
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
