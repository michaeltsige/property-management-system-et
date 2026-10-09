'use client';

import { signupBillingSchema, CURRENCIES } from '@pms/shared';
import { SignupBillingForm } from '@/components/signup-billing';
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
    portfolioMode: 'self_owned' as 'self_owned' | 'managed',
    organizationName: '',
    fullName: '',
    email: '',
    phone: '',
    password: '',
    language: 'en' as LanguageCode,
    calendar: 'gregorian' as CalendarKind,
    currency: 'ETB' as keyof typeof CURRENCIES,
  });
  const [step, setStep] = useState(0);
  const [registered, setRegistered] = useState(false);
  const [accountType, setAccountType] = useState<'individual_landlord' | 'management_company'>(
    'individual_landlord',
  );
  const [billing, setBilling] = useState(() => signupBillingSchema.parse({}));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      const result = signupBillingSchema.safeParse(billing);
      if (!result.success) {
        setError(t('onboarding.invalid_billing'));
        return;
      }
      setError(null);
      setStep(2);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (!registered) {
        await api.register({
          accountType,
          billing,
          portfolioMode: form.portfolioMode,
          organizationName: form.organizationName,
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
          language: form.language,
          calendar: form.calendar,
          currency: form.currency,
        });
        setRegistered(true);
      }
      const result = await api.login({ email: form.email, password: form.password });
      signIn({
        // Identity only: the tokens stayed on the server, inside HttpOnly
        // cookies this code cannot read (ADR-0026).
        user: result.user,
        organization: result.organization,
        role: result.role ?? '',
      });
      router.replace('/onboarding');
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
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{t('auth.register_organization')}</h1>
          <p className="text-xs text-slate-500">{t('app.tagline')}</p>
        </div>

        <Card>
          <CardContent>
            <ol className="mb-5 flex justify-between text-xs" aria-label={t('onboarding.progress')}>
              {['profile', 'billing', 'review'].map((name, i) => (
                <li
                  key={name}
                  aria-current={step === i ? 'step' : undefined}
                  className={step === i ? 'font-semibold text-brand-700' : ''}
                >
                  {i + 1}. {t(`onboarding.${name}` as never)}
                </li>
              ))}
            </ol>
            <form className="space-y-4" onSubmit={onSubmit}>
              <fieldset
                disabled={pending || registered || step !== 0}
                hidden={step !== 0}
                className="space-y-4"
              >
                <div>
                  <Label htmlFor="account-type">{t('onboarding.account_type')}</Label>
                  <Select
                    id="account-type"
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value as typeof accountType)}
                  >
                    <option value="individual_landlord">{t('onboarding.individual')}</option>
                    <option value="management_company">{t('onboarding.company')}</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="portfolioMode">{t('portfolio.mode')}</Label>
                  <Select
                    id="portfolioMode"
                    value={form.portfolioMode}
                    onChange={(e) => update('portfolioMode', e.target.value as typeof form.portfolioMode)}
                  >
                    <option value="self_owned">{t('portfolio.self_owned')}</option>
                    <option value="managed">{t('portfolio.managed')}</option>
                  </Select>
                </div>
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
                      required
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
                  <p className="text-[11px] text-slate-500">
                    At least 10 characters, including at least one letter and one number.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="currency">{t('org.default_currency')}</Label>
                    <Select
                      id="currency"
                      value={form.currency}
                      onChange={(event) => update('currency', event.target.value as typeof form.currency)}
                    >
                      {Object.entries(CURRENCIES).map(([code, definition]) => (
                        <option key={code} value={code}>
                          {code}
                          {definition.symbol ? ` (${definition.symbol})` : ''}
                        </option>
                      ))}
                    </Select>
                    <p className="text-[11px] text-slate-500">{t('org.default_currency_hint')}</p>
                  </div>
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
              </fieldset>
              {step === 1 && <SignupBillingForm value={billing} onChange={setBilling} />}
              {step === 2 && (
                <div className="space-y-2 text-sm">
                  <h2 className="font-semibold">{t('onboarding.review')}</h2>
                  <p>
                    {form.fullName} · {form.email}
                  </p>
                  <p>{form.organizationName}</p>
                  <p>{t(`onboarding.${accountType === 'management_company' ? 'company' : 'individual'}`)}</p>
                  <p>{t(`portfolio.${form.portfolioMode}`)}</p>
                  <p>
                    {t('org.default_calendar')}: {form.calendar}
                  </p>
                  <p>
                    {t('lease.billing_calendar')}: {billing.billingCalendar}
                  </p>
                  <p>
                    {t('onboarding.due_day')}: {billing.dueDay} · {t('onboarding.grace_days')}:{' '}
                    {billing.graceDays}
                  </p>
                  <p>
                    {t('onboarding.fee_rule')}: {t(`onboarding.${billing.lateFeeRule}`)}
                  </p>
                  <p>
                    {billing.acceptedPaymentMethods.join(', ')} · {form.currency}
                  </p>
                  <p>
                    {billing.lateFeeRule === 'fixed'
                      ? `${billing.lateFeeMinor} santim`
                      : billing.lateFeeRule === 'percent'
                        ? `${billing.lateFeeBps / 100}%`
                        : ''}
                  </p>
                  <p>{t('onboarding.review_hint')}</p>
                </div>
              )}
              {registered && <Alert>{t('onboarding.registered_hint')}</Alert>}
              {error ? <Alert tone="danger">{error}</Alert> : null}

              {step > 0 && !registered && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setStep(step - 1)}
                >
                  {t('onboarding.back')}
                </Button>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? t('app.loading') : step < 2 ? t('onboarding.next') : t('common.create')}
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
