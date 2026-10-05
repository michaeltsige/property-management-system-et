'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api';
import { CALENDARS, LANGUAGES, usePreferences } from '@/lib/preferences';
import type { CalendarKind, LanguageCode } from '@pms/calendar';

import { Alert, Button, Card, CardContent, Input, Label, Select } from '@/components/ui';

/**
 * Self-service registration: one form creates the organization, the owner user
 * and the first membership (the API does all three in a single transaction).
 */
export default function RegisterPage() {
  const router = useRouter();
  const { signIn, t } = usePreferences();
  const [form, setForm] = useState({
    organizationName: '',
    fullName: '',
    email: '',
    phone: '',
    password: '',
    language: 'en' as LanguageCode,
    calendar: 'ethiopian' as CalendarKind,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.register({
        organizationName: form.organizationName,
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        language: form.language,
        calendar: form.calendar,
        currency: 'ETB',
      });
      const result = await api.login({ email: form.email, password: form.password });
      signIn({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        user: result.user,
        organization: result.organization,
        role: result.role,
      });
      router.replace('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{t('auth.register_organization')}</h1>
          <p className="text-xs text-slate-500">{t('app.tagline')}</p>
        </div>

        <Card>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1">
                <Label htmlFor="organizationName">{t('org.name')}</Label>
                <Input
                  id="organizationName"
                  required
                  minLength={2}
                  value={form.organizationName}
                  onChange={(event) => update('organizationName', event.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fullName">{t('tenant.full_name')}</Label>
                  <Input
                    id="fullName"
                    required
                    value={form.fullName}
                    onChange={(event) => update('fullName', event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="phone">{t('tenant.phone')}</Label>
                  <Input
                    id="phone"
                    placeholder="+251911234567"
                    value={form.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                />
                <p className="text-[11px] text-slate-500">At least 10 characters.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="language">{t('org.default_language')}</Label>
                  <Select
                    id="language"
                    value={form.language}
                    onChange={(event) => update('language', event.target.value as LanguageCode)}
                  >
                    {LANGUAGES.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="calendar">{t('org.default_calendar')}</Label>
                  <Select
                    id="calendar"
                    value={form.calendar}
                    onChange={(event) => update('calendar', event.target.value as CalendarKind)}
                  >
                    {CALENDARS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.english}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {error ? <Alert tone="danger">{error}</Alert> : null}

              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? t('app.loading') : t('common.create')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-slate-500">
          <Link href="/login" className="text-brand-700 underline-offset-2 hover:underline">
            {t('auth.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  );
}
