'use client';

/**
 * The tenant's profile: who the organization has on file for them. Read-only —
 * corrections go through the landlord (a tenant cannot edit their own record
 * without the owner's oversight).
 */

import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/preferences';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';

export default function PortalProfilePage() {
  const { session, ready, t, language } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const me = useAsync(() => (isTenant && ready ? api.portalMe() : Promise.resolve(null)), [isTenant, ready]);

  if (!ready || !isTenant) return null;

  const tenantLanguage = me.data?.tenant.language ?? language;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{t('portal.profile_title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.profile_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {me.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : me.error ? (
            <p className="text-sm text-red-700">{me.error}</p>
          ) : me.data ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">{t('tenant.full_name')}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{me.data.tenant.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('portal.phone')}</dt>
                <dd className="tabular mt-0.5 font-medium text-slate-900">
                  {me.data.tenant.phone ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('portal.signed_in_as')}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{session.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('preferences.language')}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {LANGUAGES.find((option) => option.code === tenantLanguage)?.label ?? tenantLanguage}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('property.name')}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{session.organization.name}</dd>
              </div>
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
