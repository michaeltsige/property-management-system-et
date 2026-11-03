'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Logo } from '@/components/logo';
import { DoorLanguagePicker } from '@/components/door-language';
import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, t } = usePreferences();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The API refuses sign-in until the emailed code is redeemed; offer the
  // verify page instead of a dead end (the machine code comes from the API).
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNeedsVerification(false);
    try {
      const result = await api.login({ email, password });
      signIn({
        // Identity only: the tokens stayed on the server, inside HttpOnly
        // cookies this code cannot read (ADR-0026).
        user: result.user,
        organization: result.organization,
        role: result.role ?? result.memberships[0]?.role ?? '',
      });
      router.replace('/dashboard');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
        setError(t('auth.email_not_verified'));
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-y-auto px-4 py-6">
      {/* Addis Ababa at golden hour; the flat dark overlay keeps text readable
          (WCAG) without decorative gradients. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/login-hero.jpg')" }}
      />
      <div aria-hidden="true" className="fixed inset-0 bg-ink-950/60" />
      {/* Door language is a device choice, always one tap away (see door-language.tsx). */}
      <DoorLanguagePicker />
      <div className="relative w-full max-w-sm">
        <div className="mb-5 text-center">
          <Logo size={72} onDark className="mx-auto mb-2" />
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{t('app.name')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('app.tagline')}</p>
        </div>

        <Card className="shadow-float">
          <CardContent className="py-2">
            <form className="space-y-3 sm:space-y-4" onSubmit={onSubmit}>
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
              <div className="space-y-1">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? t('app.loading') : t('auth.sign_in')}
              </Button>
              {needsVerification ? (
                <Button asChild variant="secondary" className="w-full">
                  <Link href={`/verify-email?email=${encodeURIComponent(email.trim())}`}>
                    {t('auth.verify_title')}
                  </Link>
                </Button>
              ) : null}
              <p className="text-center text-xs text-muted">
                <Link
                  href="/forgot-password"
                  className="text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                >
                  {t('auth.forgot_password')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>

        {/* The other doors, as buttons: dim links were invisible against the
            photo background. Register is the outline-on-white treatment; the
            tenant portal gets the gold variant so the two flows read apart. */}
        <div className="mt-4 flex flex-col gap-2 sm:mt-6">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white dark:border-white/60 dark:text-white"
          >
            <Link href="/register">{t('auth.register_organization')}</Link>
          </Button>
          <Button asChild variant="gold" size="lg" className="w-full">
            <Link href="/portal/login">{t('auth.tenant_portal')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
