'use client';

/**
 * Tenant maintenance: report an issue in the home and follow its progress.
 * Requests are filed against the tenant's active lease server-side.
 */

import { formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { useState } from 'react';

import { api } from '@/lib/api';
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
  Skeleton,
  Textarea,
} from '@/components/ui';

export default function PortalMaintenancePage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const [version, setVersion] = useState(0);
  const requests = useAsync(
    () => (isTenant && ready ? api.portalMaintenanceRequests() : Promise.resolve(null)),
    [isTenant, ready, version],
  );

  const [form, setForm] = useState({ title: '', description: '' });
  const [sent, setSent] = useState(false);
  const { pending: submitting, error, run } = useAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createPortalMaintenanceRequest({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
      });
      setForm({ title: '', description: '' });
      setSent(true);
      setVersion((current) => current + 1);
    }).catch(() => undefined);
  }

  if (!ready || !isTenant) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {t('portal.maintenance_title')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.maintenance_title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {requests.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : requests.error ? (
            <div className="p-4">
              <Alert tone="danger">{requests.error}</Alert>
            </div>
          ) : (requests.data?.items.length ?? 0) === 0 ? (
            <div className="p-4">
              <EmptyState title={t('portal.maintenance_empty')} description={t('portal.maintenance_hint')} />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(requests.data?.items ?? []).map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    <Badge className={cn(statusTone[item.status])}>
                      {t(`work_order.status.${item.status}` as never)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {item.ticketNumber ?? ''}
                    {item.ticketNumber ? ' · ' : ''}
                    {formatDate(item.reportedAt, { language, calendar })}
                  </p>
                  {item.description ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.description}</p>
                  ) : null}
                  {(item.notes ?? []).length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {(item.notes ?? []).map((note) => (
                        <li key={note.id} className="rounded-md bg-slate-50 px-2 py-1.5">
                          <p className="whitespace-pre-wrap text-xs text-slate-700">{note.body}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {note.authorName} · {formatDate(note.createdAt, { language, calendar })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <form className="space-y-2" onSubmit={submit}>
            <p className="text-xs text-slate-500">{t('portal.maintenance_hint')}</p>
            <div className="space-y-1">
              <Label htmlFor="request-title">{t('maintenance.title')}</Label>
              <Input
                id="request-title"
                required
                minLength={5}
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="request-description">{t('maintenance.description')}</Label>
              <Textarea
                id="request-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {sent ? <Alert tone="success">{t('portal.maintenance_submitted')}</Alert> : null}
            <Button type="submit" disabled={submitting || form.title.trim().length < 5}>
              {submitting ? t('app.loading') : t('portal.new_maintenance_request')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
