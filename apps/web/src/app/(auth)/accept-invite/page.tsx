'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Logo } from '@/components/logo';
import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

/**
 * The invited staff member's door: the one-time token from the invite link
 * plus the password they choose. Redeems POST /auth/accept-invite, which is
 * unauthenticated by design — the token IS the credential (rate limited).
 */
export default function AcceptInvitePage() {
  const { t } = usePreferences();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; organizationName: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) setToken(fromUrl);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('invite.password_mismatch'));
      return;
    }
    setPending(true);
    try {
      const result = await api.acceptInvite({ token: token.trim(), password });
      setDone({ email: result.email, organizationName: result.organization?.name ?? '' });
    } catch (cause) {
      // Validation problems quote the field; a dead token gets the friendly
      // "ask for a new link" message instead of the raw API string.
      if (cause instanceof ApiError && cause.status !== 400) setError(t('invite.invalid'));
      else setError(cause instanceof Error ? cause.message : String(cause));
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
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{t('invite.title')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('invite.subtitle')}</p>
        </div>

        <Card className="shadow-float">
          <CardContent className="py-2">
            {done ? (
              <div className="space-y-3 py-2 sm:space-y-4">
                <Alert tone="success" title={t('invite.done')}>
                  {done.organizationName ? (
                    <p className="text-xs">
                      {done.organizationName} — {done.email}
                    </p>
                  ) : null}
                </Alert>
                <Link href="/login">
                  <Button className="w-full">{t('invite.sign_in')}</Button>
                </Link>
              </div>
            ) : (
              <form className="space-y-3 sm:space-y-4" onSubmit={onSubmit}>
                <div className="space-y-1">
                  <Label htmlFor="token" required>
                    {t('user.invite_link')}
                  </Label>
                  <Input
                    id="token"
                    required
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="password" required>
                    {t('auth.password')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirm" required>
                    {t('invite.confirm_password')}
                  </Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </div>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? t('app.loading') : t('invite.accept')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-white/70">
          <Link href="/login" className="underline-offset-2 hover:underline">
            {t('auth.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  );
}
