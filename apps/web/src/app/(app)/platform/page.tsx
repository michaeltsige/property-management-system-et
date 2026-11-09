'use client';

/**
 * Platform console — the SaaS operator's single screen.
 *
 * Everything here is cross-organization by definition, so it lives outside the
 * normal permission matrix: the API gates each route behind `isPlatformAdmin`
 * (re-read from the database on every request), and this page additionally
 * checks the flag client-side so a non-operator who types the URL lands back
 * on the dashboard instead of staring at a table of 403s.
 *
 * Lifecycle actions are deliberately two-step where the damage is one-way:
 * suspending is a click with a confirm, closing (final) is a separate button
 * that only appears for an already-suspended organization, mirroring the API's
 * state machine.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PLAN_DEFS, PLANS, SUBSCRIPTION_STATUSES } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import { Modal } from '@/components/modal';
import type { PlatformOrg } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';

function orgStatusTone(status: string): string {
  switch (status) {
    case 'active':
      return statusTone.active;
    case 'suspended':
      return statusTone.overdue;
    case 'closed':
      return 'bg-wash-strong text-body';
    default:
      return statusTone.draft;
  }
}

function subscriptionStatusTone(status: string): string {
  switch (status) {
    case 'active':
      return statusTone.active;
    case 'trialing':
      return statusTone.assigned;
    case 'past_due':
      return statusTone.overdue;
    case 'cancelled':
      return statusTone.terminated;
    default:
      return statusTone.draft;
  }
}

export default function PlatformPage() {
  const router = useRouter();
  const { t, language, session, ready } = usePreferences();

  // Staff shell already bounces tenants; this additionally bounces staff who
  // are not platform operators (the API would 403 every call anyway).
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace('/login');
    else if (session.user.isPlatformAdmin !== true) router.replace('/dashboard');
  }, [ready, session, router]);

  const stats = useAsync(() => api.platformStats(), []);
  const orgs = useAsync(() => api.platformOrgs(), []);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<PlatformOrg | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const lifecycle = useAction();

  if (!ready || !session || session.user.isPlatformAdmin !== true) {
    return <div className="p-6 text-sm text-muted">{t('common.loading')}</div>;
  }

  async function setStatus(org: PlatformOrg, status: 'active' | 'suspended' | 'closed', reason?: string) {
    await lifecycle.run(async () => {
      await api.platformSetOrgStatus(org.id, { status, reason });
      setConfirmSuspend(null);
      setSuspendReason('');
      orgs.reload();
      stats.reload();
    });
  }

  const byStatus = stats.data?.organizations.byStatus ?? {};

  return (
    <div className="space-y-5">
      <PageHeader titleKey="platform.title" description={t('platform.description')} />

      {lifecycle.error ? <Alert tone="danger">{lifecycle.error}</Alert> : null}

      {/* Headline numbers: how many customers, on which plans, what they owe us. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <CardContent className="py-4">
            <p className="text-[11px] text-muted">{t('platform.stats.orgs')}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-strong">
              {stats.loading ? '…' : stats.data?.organizations.total ?? 0}
            </p>
            <p className="mt-0.5 text-[11px] text-muted tabular">
              {t('platform.stats.new_30d', { count: String(stats.data?.organizations.newLast30Days ?? 0) })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11px] text-muted">{t('platform.stats.mrr')}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-strong">
              {stats.loading ? '…' : formatAmount(stats.data?.mrrMinor ?? '0', 'ETB', language)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">{t('platform.stats.mrr_hint')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11px] text-muted">{t('platform.stats.units')}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-strong">
              {stats.loading ? '…' : stats.data?.portfolio.units ?? 0}
            </p>
            <p className="mt-0.5 text-[11px] text-muted tabular">
              {t('platform.stats.suspended', { count: String(byStatus.suspended ?? 0) })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11px] text-muted">{t('platform.stats.tenants')}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-strong">
              {stats.loading ? '…' : stats.data?.portfolio.tenants ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[11px] text-muted">{t('platform.stats.active_leases')}</p>
            <p className="mt-1 text-2xl font-semibold tabular text-strong">
              {stats.loading ? '…' : stats.data?.portfolio.activeLeases ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {orgs.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : orgs.error ? (
        <Alert tone="danger">{orgs.error}</Alert>
      ) : orgs.data && orgs.data.organizations.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title={t('common.no_results')} description={t('platform.description')} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t('platform.org.name')}</Th>
                  <Th className="whitespace-nowrap">{t('platform.org.status')}</Th>
                  <Th className="whitespace-nowrap">{t('platform.org.plan')}</Th>
                  <Th className="whitespace-nowrap">{t('platform.org.units')}</Th>
                  <Th className="whitespace-nowrap">{t('nav.tenants')}</Th>
                  <Th className="whitespace-nowrap">{t('org.team')}</Th>
                  <Th className="whitespace-nowrap">{t('platform.org.period_end')}</Th>
                  <Th className="whitespace-nowrap">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {(orgs.data?.organizations ?? []).map((org) => (
                  <tr key={org.id}>
                    <Td className="min-w-0">
                      <span className="block truncate font-medium text-strong">{org.name}</span>
                      <span className="block truncate text-[11px] text-muted">{org.slug}</span>
                    </Td>
                    <Td>
                      <Badge className={orgStatusTone(org.status)}>
                        {t(`platform.org_status.${org.status}` as never)}
                      </Badge>
                    </Td>
                    <Td>
                      {org.subscription ? (
                        <span className="flex flex-col gap-1">
                          <span className="text-sm text-strong">
                            {t(`platform.plan.${org.subscription.plan}` as never)}
                          </span>
                          <Badge className={subscriptionStatusTone(org.subscription.status)}>
                            {t(`platform.sub_status.${org.subscription.status}` as never)}
                          </Badge>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="tabular">
                      {org.counts.units}
                      {org.subscription?.unitLimit != null ? ` / ${org.subscription.unitLimit}` : ''}
                    </Td>
                    <Td className="tabular">{org.counts.tenants}</Td>
                    <Td className="tabular">{org.counts.members}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {org.subscription?.periodEnd
                        ? formatDate(org.subscription.periodEnd, { language, calendar: 'gregorian' })
                        : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setDetailId(org.id)}>
                          {t('platform.action.details')}
                        </Button>
                        {org.status === 'active' ? (
                          <Button variant="outline" size="sm" onClick={() => setConfirmSuspend(org)}>
                            {t('platform.action.suspend')}
                          </Button>
                        ) : org.status === 'suspended' ? (
                          <Button variant="outline" size="sm" onClick={() => void setStatus(org, 'active')}>
                            {t('platform.action.activate')}
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Suspend: confirm + reason, because it kicks every user out at once. */}
      <Modal
        open={confirmSuspend !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSuspend(null);
        }}
        title={t('platform.suspend_title')}
        description={t('platform.suspend_hint', { name: confirmSuspend?.name ?? '' })}
        width="sm:max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSuspend(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={lifecycle.pending}
              onClick={() => {
                if (confirmSuspend) void setStatus(confirmSuspend, 'suspended', suspendReason || undefined);
              }}
            >
              {t('platform.action.suspend')}
            </Button>
          </>
        }
      >
        <Label htmlFor="suspend-reason">{t('platform.suspend_reason')}</Label>
        <Input
          id="suspend-reason"
          value={suspendReason}
          onChange={(e) => setSuspendReason(e.target.value)}
          placeholder={t('platform.suspend_reason_placeholder')}
        />
      </Modal>

      {detailId ? (
        <OrgDetailModal
          organizationId={detailId}
          onClose={() => {
            setDetailId(null);
            orgs.reload();
            stats.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One customer, fully expanded: members, recent money, and the subscription
 * editor. The lifecycle buttons live in the modal footer so the table row
 * stays light.
 */
function OrgDetailModal({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const { t, language } = usePreferences();
  const detail = useAsync(() => api.platformOrg(organizationId), [organizationId]);
  const save = useAction();

  const [form, setForm] = useState<{
    plan: string;
    status: string;
    unitLimit: string;
    price: string;
    periodEnd: string;
    notes: string;
  } | null>(null);

  const org = detail.data?.organization ?? null;
  const subscription = org?.subscription ?? null;

  // Seed the editor from the loaded subscription exactly once.
  useEffect(() => {
    if (!subscription || form) return;
    setForm({
      plan: subscription.plan,
      status: subscription.status,
      unitLimit: subscription.unitLimit == null ? '' : String(subscription.unitLimit),
      price: subscription.priceMonthlyMinor == null ? '' : String(Number(subscription.priceMonthlyMinor) / 100),
      periodEnd: subscription.periodEnd ?? '',
      notes: subscription.notes ?? '',
    });
  }, [subscription, form]);

  const lifecycle = useAction();

  async function setStatus(status: 'active' | 'suspended' | 'closed') {
    if (!org) return;
    await lifecycle.run(async () => {
      await api.platformSetOrgStatus(org.id, { status });
      detail.reload();
    });
  }

  async function saveSubscription() {
    if (!form) return;
    await save.run(async () => {
      await api.platformUpdateSubscription(organizationId, {
        plan: form.plan,
        status: form.status,
        unitLimit: form.unitLimit === '' ? null : Number(form.unitLimit),
        priceMonthlyMinor: form.price === '' ? null : Math.round(Number(form.price) * 100),
        periodEnd: form.periodEnd === '' ? null : form.periodEnd,
        notes: form.notes === '' ? null : form.notes,
      });
      detail.reload();
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={org?.name ?? '…'}
      description={org ? `${org.slug} · ${t(`platform.org_status.${org.status}` as never)}` : undefined}
      width="sm:max-w-2xl"
      footer={
        org ? (
          <>
            {org.status === 'active' ? (
              <Button variant="destructive" disabled={lifecycle.pending} onClick={() => void setStatus('suspended')}>
                {t('platform.action.suspend')}
              </Button>
            ) : org.status === 'suspended' ? (
              <>
                <Button variant="outline" disabled={lifecycle.pending} onClick={() => void setStatus('closed')}>
                  {t('platform.action.close')}
                </Button>
                <Button disabled={lifecycle.pending} onClick={() => void setStatus('active')}>
                  {t('platform.action.activate')}
                </Button>
              </>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        ) : null
      }
    >
      {detail.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : detail.error ? (
        <Alert tone="danger">{detail.error}</Alert>
      ) : org ? (
        <div className="space-y-5">
          {lifecycle.error ? <Alert tone="danger">{lifecycle.error}</Alert> : null}

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-muted">{t('platform.org.units')}</p>
              <p className="tabular font-medium text-strong">{org.counts.units}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted">{t('nav.tenants')}</p>
              <p className="tabular font-medium text-strong">{org.counts.tenants}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted">{t('nav.leases')}</p>
              <p className="tabular font-medium text-strong">{org.counts.leases}</p>
            </div>
          </div>

          {/* Subscription editor: billing is offline for now, so this form IS the bill. */}
          <div className="space-y-3 rounded-lg border border-line p-3">
            <p className="text-sm font-medium text-strong">{t('platform.subscription.title')}</p>
            {form ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="sub-plan">{t('platform.subscription.plan')}</Label>
                    <Select
                      id="sub-plan"
                      value={form.plan}
                      onChange={(e) => {
                        const plan = e.target.value;
                        const limit = PLAN_DEFS[plan as keyof typeof PLAN_DEFS]?.unitLimit;
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                plan,
                                // Switching plans re-suggests the plan's cap; the
                                // operator can still override it by hand.
                                unitLimit: limit == null ? '' : String(limit),
                              }
                            : f,
                        );
                      }}
                    >
                      {PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {t(`platform.plan.${plan}` as never)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="sub-status">{t('platform.subscription.status')}</Label>
                    <Select
                      id="sub-status"
                      value={form.status}
                      onChange={(e) => setForm((f) => (f ? { ...f, status: e.target.value } : f))}
                    >
                      {SUBSCRIPTION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`platform.sub_status.${status}` as never)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="sub-limit">{t('platform.subscription.unit_limit')}</Label>
                    <Input
                      id="sub-limit"
                      inputMode="numeric"
                      value={form.unitLimit}
                      onChange={(e) => setForm((f) => (f ? { ...f, unitLimit: e.target.value } : f))}
                      placeholder={t('platform.subscription.unlimited')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sub-price">{t('platform.subscription.monthly_price')}</Label>
                    <Input
                      id="sub-price"
                      inputMode="decimal"
                      value={form.price}
                      onChange={(e) => setForm((f) => (f ? { ...f, price: e.target.value } : f))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sub-period-end">{t('platform.subscription.period_end')}</Label>
                    <Input
                      id="sub-period-end"
                      type="date"
                      value={form.periodEnd}
                      onChange={(e) => setForm((f) => (f ? { ...f, periodEnd: e.target.value } : f))}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="sub-notes">{t('platform.subscription.notes')}</Label>
                  <Input
                    id="sub-notes"
                    value={form.notes}
                    onChange={(e) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))}
                  />
                </div>
                {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
                <div className="flex justify-end">
                  <Button size="sm" disabled={save.pending} onClick={() => void saveSubscription()}>
                    {t('common.save')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">{t('platform.subscription.none')}</p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-strong">{t('platform.org.members')}</p>
            <ul className="space-y-1">
              {org.members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-strong">{member.fullName}</span>{' '}
                    <span className="text-muted">({member.email})</span>
                  </span>
                  <Badge tone="neutral">{t(`role.${member.role}` as never)}</Badge>
                </li>
              ))}
            </ul>
          </div>

          {org.recentPayments.length > 0 ? (
            <div>
              <p className="mb-1.5 text-sm font-medium text-strong">{t('platform.org.recent_payments')}</p>
              <ul className="space-y-1">
                {org.recentPayments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">{formatDate(payment.paidAt, { language, calendar: 'gregorian' })}</span>
                    <span className="tabular text-strong">
                      {formatAmount(payment.amountMinor, payment.currency, language)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
