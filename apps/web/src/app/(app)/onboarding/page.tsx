'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleHasPermission, unitLabels, type Role } from '@pms/shared';
import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { Alert, Button, Card, CardContent, Input, Label, Skeleton } from '@/components/ui';

export default function OnboardingPage() {
  const router = useRouter();
  const { t, session } = usePreferences();
  const canManage = roleHasPermission(session?.role as Role, 'org.settings.manage');
  const owners = useAsync(() => (canManage ? api.owners() : Promise.resolve(null)), [canManage]);
  const settings = useAsync(() => (canManage ? api.settings() : Promise.resolve(null)), [canManage]);
  const [name, setName] = useState('');
  const [ownerName, setOwner] = useState('');
  const [pattern, setPattern] = useState('A-{n}');
  const [count, setCount] = useState(0);
  const { pending, error, run } = useAction();
  let labels: string[] = [];
  try {
    if (count > 0) labels = unitLabels({ pattern, start: 1, count, padding: 3 });
  } catch {
    /* form validation */
  }
  const invalidUnits = count < 0 || count > 200 || !Number.isInteger(count) || (count > 0 && !labels.length);
  const finish = (skip: boolean) =>
    void run(async () => {
      await api.finishOnboarding(
        skip
          ? { action: 'skip' }
          : {
              action: 'create',
              property: { name, type: 'apartment_block' },
              ownerName: owners.data?.portfolioMode === 'managed' ? ownerName : undefined,
              units: count > 0 ? { pattern, start: 1, count, padding: 3 } : undefined,
            },
      );
      router.replace('/dashboard');
    }).catch(() => undefined);
  if (!canManage) return <Alert>{t('onboarding.admin_only')}</Alert>;
  if (owners.loading || settings.loading) return <Skeleton className="h-32 w-full" />;
  if (owners.error || settings.error) return <Alert tone="danger">{owners.error || settings.error}</Alert>;
  if (settings.data?.settings.onboardingStatus !== 'portfolio_pending')
    return (
      <div>
        <p>{t('onboarding.finished')}</p>
        <Button onClick={() => router.replace('/dashboard')}>{t('nav.dashboard')}</Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">{t('onboarding.first_property')}</h1>
      <Card>
        <CardContent>
          <p className="mb-4 text-sm text-slate-600">{t('onboarding.property_hint')}</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalidUnits) finish(false);
            }}
          >
            <Label htmlFor="first-name">{t('property.name')}</Label>
            <Input
              id="first-name"
              minLength={2}
              maxLength={160}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {owners.data?.portfolioMode === 'managed' && (
              <>
                <Label htmlFor="first-owner">{t('portfolio.owner_name')}</Label>
                <Input
                  id="first-owner"
                  required
                  minLength={2}
                  maxLength={160}
                  value={ownerName}
                  onChange={(e) => setOwner(e.target.value)}
                />
              </>
            )}
            <Label htmlFor="first-count">{t('bulk.count')}</Label>
            <Input
              id="first-count"
              type="number"
              min={0}
              max={200}
              required
              value={count}
              onChange={(e) => setCount(e.target.valueAsNumber)}
            />
            {count > 0 && (
              <>
                <Label htmlFor="first-pattern">{t('bulk.pattern')}</Label>
                <Input
                  id="first-pattern"
                  value={pattern}
                  maxLength={50}
                  onChange={(e) => setPattern(e.target.value)}
                />
                <p className="text-sm">
                  {t('bulk.preview')}: {labels.slice(0, 5).join(', ')}
                </p>
              </>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex gap-3">
              <Button type="submit" disabled={pending || invalidUnits}>
                {t('onboarding.finish')}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => finish(true)}>
                {t('onboarding.skip')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
