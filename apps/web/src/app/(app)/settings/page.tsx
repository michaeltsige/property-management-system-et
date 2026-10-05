'use client';

import { useState } from 'react';

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
  Table,
  Td,
  Th,
} from '@/components/ui';

/**
 * Organization settings.
 *
 * Every rule that a local accountant or lawyer must confirm (late fees, tax
 * rates, retention) is stored as data and is never hardcoded: the defaults ship
 * unverified, and the API keeps the `verified` flag with the rate.
 */
export default function SettingsPage() {
  const { t } = usePreferences();
  const settings = useAsync(() => api.settings(), []);
  const members = useAsync(() => api.members(), []);
  const idTypes = useAsync(() => api.idTypes(), []);
  const [invite, setInvite] = useState({ email: '', fullName: '', role: 'manager' });
  const { pending, error, message, setMessage, run } = useAction();

  const current = (settings.data?.settings ?? {}) as Record<string, unknown>;

  async function save(patch: Record<string, unknown>) {
    await run(async () => {
      await api.updateSettings({ ...current, ...patch });
      setMessage(t('org.saved'));
      settings.reload();
    }).catch(() => undefined);
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.sendNotification({
        templateKey: 'notification.invite_user',
        channel: 'in_app',
        recipientEmail: invite.email,
        values: { email: invite.email, role: invite.role, name: invite.fullName },
      });
      setMessage(t('user.invited', { email: invite.email }));
      setInvite({ email: '', fullName: '', role: 'manager' });
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <PageHeader titleKey="org.settings" />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('org.settings')}</CardTitle>
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
                  <p className="text-[11px] text-slate-500">
                    How often the worker sends overdue SMS reminders to tenants.
                  </p>
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
                  <p className="text-[11px] text-amber-700">
                    Late fees are a local legal question — see “NEEDS HUMAN VERIFICATION” in docs/DECISIONS.md
                    before enabling.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('user.invite')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={sendInvite}>
                <div className="space-y-1">
                  <Label htmlFor="invite-email">{t('auth.email')}</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    value={invite.email}
                    onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invite-name">{t('tenant.full_name')}</Label>
                  <Input
                    id="invite-name"
                    value={invite.fullName}
                    onChange={(event) =>
                      setInvite((current) => ({ ...current, fullName: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invite-role">{t('user.role')}</Label>
                  <Select
                    id="invite-role"
                    value={invite.role}
                    onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value }))}
                  >
                    {['owner_admin', 'manager', 'accountant', 'maintenance', 'tenant'].map((role) => (
                      <option key={role} value={role}>
                        {t(`role.${role}` as never)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={pending}>
                    {pending ? t('app.loading') : t('user.invite')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {t('nav.settings')} · {t('user.role')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {members.loading ? (
                <div className="p-4">
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (members.data?.members.length ?? 0) === 0 ? (
                <EmptyState title={t('common.no_results')} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('tenant.full_name')}</Th>
                      <Th>{t('auth.email')}</Th>
                      <Th>{t('user.role')}</Th>
                      <Th>{t('unit.status')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.data?.members.map((member) => (
                      <tr key={member.id}>
                        <Td className="font-medium text-slate-900">{member.user.fullName}</Td>
                        <Td className="text-xs">{member.user.email}</Td>
                        <Td>{t(`role.${member.role}` as never)}</Td>
                        <Td>
                          <Badge tone={member.status === 'active' ? 'brand' : 'neutral'}>
                            {member.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('tenant.id_type')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(idTypes.data?.idTypes ?? []).map((type) => (
                <Badge key={type.id} tone={type.organizationId ? 'brand' : 'neutral'}>
                  {type.label}
                </Badge>
              ))}
              {(idTypes.data?.idTypes.length ?? 0) === 0 ? (
                <EmptyState title={t('common.no_results')} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
