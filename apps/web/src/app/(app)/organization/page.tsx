'use client';

import { useEffect, useState } from 'react';

import { CURRENCIES } from '@pms/shared';
import type { CalendarKind, LanguageCode } from '@pms/calendar';

import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { CALENDARS, LANGUAGES, usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
} from '@/components/ui';

/**
 * Organization profile: who this landlord is and the defaults every new lease,
 * charge and reminder inherits. All admin/staff configuration lives under the
 * Organization section (this page, Team, Translations).
 *
 * Every rule a local accountant or lawyer must confirm (late fees, retention)
 * is stored as data and is never hardcoded.
 */
export default function OrganizationPage() {
  const { t, session } = usePreferences();
  const settings = useAsync(() => api.settings(), []);
  const idTypes = useAsync(() => api.idTypes(), []);
  const { pending, error, message, setMessage, run } = useAction();

  const current = (settings.data?.settings ?? {}) as Record<string, unknown>;

  const [name, setName] = useState('');
  useEffect(() => {
    if (!name && session?.organization.name) setName(session.organization.name);
  }, [session, name]);

  async function save(patch: Record<string, unknown>) {
    await run(async () => {
      await api.updateSettings({ ...current, ...patch });
      setMessage(t('org.saved'));
      settings.reload();
    }).catch(() => undefined);
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.updateOrganizationProfile({ name: name.trim() });
      setMessage(t('org.saved'));
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <PageHeader titleKey="nav.organization" />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('org.profile')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form className="flex items-end gap-2" onSubmit={saveName}>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="orgName">{t('org.name')}</Label>
                  <Input
                    id="orgName"
                    required
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={pending || name.trim().length < 2}>
                  {pending ? t('app.loading') : t('common.save')}
                </Button>
              </form>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="currency">{t('org.default_currency')}</Label>
                  <Select
                    id="currency"
                    value={String(current.currency ?? 'ETB')}
                    onChange={(event) => void save({ currency: event.target.value })}
                  >
                    {Object.keys(CURRENCIES).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="defaultLanguage">{t('org.default_language')}</Label>
                  <Select
                    id="defaultLanguage"
                    value={String(current.defaultLanguage ?? 'en')}
                    onChange={(event) => void save({ defaultLanguage: event.target.value as LanguageCode })}
                  >
                    {LANGUAGES.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('org.billing_defaults')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {settings.loading ? (
                <>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="defaultCalendar">{t('org.default_calendar')}</Label>
                    <Select
                      id="defaultCalendar"
                      value={String(current.defaultCalendar ?? 'ethiopian')}
                      onChange={(event) => void save({ defaultCalendar: event.target.value as CalendarKind })}
                    >
                      {CALENDARS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.english}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="defaultBillingCalendar">{t('org.billing_calendar')}</Label>
                    <Select
                      id="defaultBillingCalendar"
                      value={String(current.defaultBillingCalendar ?? 'ethiopian')}
                      onChange={(event) =>
                        void save({ defaultBillingCalendar: event.target.value as CalendarKind })
                      }
                    >
                      {CALENDARS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.english}
                        </option>
                      ))}
                    </Select>
                    <p className="text-[11px] text-slate-500">{t('org.billing_calendar_hint')}</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="rentDueDay">{t('org.rent_due_day')}</Label>
                    <Input
                      id="rentDueDay"
                      type="number"
                      min={1}
                      max={30}
                      defaultValue={Number(current.rentDueDay ?? 5)}
                      onBlur={(event) => void save({ rentDueDay: Number(event.target.value) })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="gracePeriodDays">{t('org.grace_period_days')}</Label>
                    <Input
                      id="gracePeriodDays"
                      type="number"
                      min={0}
                      defaultValue={Number(current.gracePeriodDays ?? 0)}
                      onBlur={(event) => void save({ gracePeriodDays: Number(event.target.value) })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="overdueReminderEveryDays">{t('dashboard.arrears')}</Label>
                    <Input
                      id="overdueReminderEveryDays"
                      type="number"
                      min={1}
                      defaultValue={Number(current.overdueReminderEveryDays ?? 7)}
                      onBlur={(event) => void save({ overdueReminderEveryDays: Number(event.target.value) })}
                    />
                    <p className="text-[11px] text-slate-500">{t('org.overdue_reminder_hint')}</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="lateFeeEnabled">{t('org.late_fee_enabled')}</Label>
                    <Select
                      id="lateFeeEnabled"
                      value={current.lateFeeEnabled === true ? 'yes' : 'no'}
                      onChange={(event) => void save({ lateFeeEnabled: event.target.value === 'yes' })}
                    >
                      <option value="no">{t('common.none')}</option>
                      <option value="yes">{t('common.total')}</option>
                    </Select>
                    <p className="text-[11px] text-amber-700">{t('org.late_fee_hint')}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('tenant.id_type')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(idTypes.data?.idTypes ?? []).map((type) => (
              <Badge key={type.id} tone={type.organizationId ? 'brand' : 'neutral'}>
                {type.label}
              </Badge>
            ))}
            {(idTypes.data?.idTypes.length ?? 0) === 0 ? <EmptyState title={t('common.no_results')} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
