'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

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
      {/* Addis Ababa at golden hour; the overlay keeps text readable (WCAG). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/login-hero.jpg')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/55" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white shadow-lg">
            ቤ
          </div>
          <h1 className="text-lg font-semibold text-white">{t('app.name')}</h1>
          <p className="text-xs text-white/70">{t('app.tagline')}</p>
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

        <p className="mt-4 text-center text-xs text-slate-500">
          <Link href="/register" className="text-brand-700 underline-offset-2 hover:underline">
            {t('auth.register_organization')}
          </Link>
        </p>
      </div>
    </div>
  );
}
