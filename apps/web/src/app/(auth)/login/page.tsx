'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

import { Logo } from '@/components/logo';
import { Alert, Button, Card, CardContent, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, t } = usePreferences();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      {/* Addis Ababa at golden hour; the flat dark overlay keeps text readable
          (WCAG) without decorative gradients. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/login-hero.jpg')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-ink-950/60" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo size={52} className="mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-white">{t('app.name')}</h1>
          <p className="mt-1 text-xs text-white/70">{t('app.tagline')}</p>
        </div>

        <Card className="shadow-xl">
          <CardContent className="py-2">
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
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-white/70">
          <Link href="/register" className="font-medium text-white underline-offset-2 hover:underline">
            {t('auth.register_organization')}
          </Link>
        </p>
      </div>
    </div>
  );
}
