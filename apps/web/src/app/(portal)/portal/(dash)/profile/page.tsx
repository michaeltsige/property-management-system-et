'use client';

/**
 * The tenant's profile: who the organization has on file for them, plus the
 * one thing a tenant can change themselves — the portal language. Profile
 * fields are read-only: corrections go through the landlord (a tenant cannot
 * edit their own record without the owner's oversight).
 */

import { useState } from 'react';

import { useAsync, useAction } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/preferences';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  Skeleton,
} from '@/components/ui';

export default function PortalProfilePage() {
  const { session, ready, t, language, setLanguage } = usePreferences();
  const isTenant = session?.role === 'tenant';
  const { pending, error, run } = useAction();
  const [savedLanguage, setSavedLanguage] = useState<string | null>(null);

  const me = useAsync(() => (isTenant && ready ? api.portalMe() : Promise.resolve(null)), [isTenant, ready]);

  if (!ready || !isTenant) return null;

  const tenantLanguage = me.data?.tenant.language ?? language;

  async function changeLanguage(next: string) {
    await run(async () => {
      await api.updateTenantLanguage(next);
      // The preference layer re-renders the whole portal in the new language
      // and persists it in the session cache; the API persisted the record.
      setLanguage(next as typeof language);
      setSavedLanguage(next);
      me.reload();
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-strong">{t('portal.profile_title')}</h1>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {savedLanguage ? <Alert tone="success">{t('portal.language_saved')}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.profile_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {me.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : me.error ? (
            <div className="space-y-3">
              <Alert tone="danger">
                {t('portal.load_failed')} {me.error}
              </Alert>
              <Button variant="secondary" onClick={() => me.reload()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : me.data ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">{t('tenant.full_name')}</dt>
                <dd className="mt-0.5 font-medium text-strong">{me.data.tenant.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('portal.phone')}</dt>
                <dd className="tabular mt-0.5 font-medium text-strong">
                  {me.data.tenant.phone ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('portal.signed_in_as')}</dt>
                <dd className="mt-0.5 font-medium text-strong">{session.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('property.name')}</dt>
                <dd className="mt-0.5 font-medium text-strong">{session.organization.name}</dd>
              </div>
            </dl>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('preferences.language')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <Label htmlFor="portal-language">{t('preferences.language')}</Label>
          <Select
            id="portal-language"
            className="max-w-64"
            value={tenantLanguage}
            disabled={pending}
            onChange={(event) => void changeLanguage(event.target.value)}
          >
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label} · {option.english}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">{t('portal.language_hint')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
