'use client';

import { roleHasPermission, type Role } from '@pms/shared';
import { CsvImport } from '@/components/csv-import';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { api } from '@/lib/api';
import type { Tenant } from '@/lib/types';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { LANGUAGES, usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import { ExportCsvButton } from '@/components/export-csv-button';
import { Modal } from '@/components/modal';
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

export default function TenantsPage() {
  const { t, session } = usePreferences();
  const [search, setSearch] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('search') ?? ''),
  );
  const tenants = useAsync(() => api.tenants(search || undefined), [search]);
  const idTypes = useAsync(() => api.idTypes(), []);
  const [open, setOpen] = useState(false);
  useAutoOpenModal(() => setOpen(true));
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    employer: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    language: 'am',
    idType: '',
    idNumber: '',
  });
  const { pending, error, run } = useAction();
  const canManagePortal = roleHasPermission(session?.role as Role, 'tenants.write');
  const [portalPendingId, setPortalPendingId] = useState<string | null>(null);

  async function togglePortal(tenant: Tenant) {
    setPortalPendingId(tenant.id);
    try {
      if (tenant.portalEnabledAt) await api.disableTenantPortal(tenant.id);
      else await api.enableTenantPortal(tenant.id);
      tenants.reload();
    } finally {
      setPortalPendingId(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createTenant({
        fullName: form.fullName,
        phone: form.phone || undefined,
        email: form.email || undefined,
        employer: form.employer || undefined,
        emergencyContactName: form.emergencyContactName || undefined,
        emergencyContactPhone: form.emergencyContactPhone || undefined,
        language: form.language,
        // The number is encrypted at rest by the API; only the last four digits
        // are ever returned to a browser.
        idDocuments:
          form.idType && form.idNumber ? [{ type: form.idType, number: form.idNumber }] : undefined,
      });
      setForm({
        fullName: '',
        phone: '',
        email: '',
        employer: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        language: 'am',
        idType: '',
        idNumber: '',
      });
      setOpen(false);
      tenants.reload();
    }).catch(() => undefined);
  }

  return (
    <div>
      <PageHeader
        titleKey="nav.tenants"
        actions={
          <>
            {roleHasPermission(session?.role as Role, 'tenants.write') && (
              <CsvImport kind="tenants" onImported={tenants.reload} />
            )}
            <ExportCsvButton kind="tenants" />
            <Input
              placeholder={t('common.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-40"
            />
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('common.create')}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          {tenants.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : tenants.error ? (
            <div className="p-4">
              <Alert tone="danger">{tenants.error}</Alert>
            </div>
          ) : (tenants.data?.tenants.length ?? 0) === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('tenant.full_name')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('tenant.full_name')}</Th>
                  <Th>{t('tenant.phone')}</Th>
                  <Th>{t('tenant.employer')}</Th>
                  <Th>{t('tenant.emergency_contact')}</Th>
                  <Th>{t('preferences.language')}</Th>
                  {canManagePortal ? <Th>{t('tenant.portal')}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {tenants.data?.tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <Td className="font-medium text-slate-900">{tenant.fullName}</Td>
                    <Td className="tabular">{tenant.phone ?? '—'}</Td>
                    <Td>{tenant.employer ?? '—'}</Td>
                    <Td>
                      {tenant.emergencyContactName ?? '—'}
                      {tenant.emergencyContactPhone ? (
                        <span className="block text-[11px] text-slate-500">
                          {tenant.emergencyContactPhone}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge>
                        {LANGUAGES.find((option) => option.code === tenant.language)?.label ??
                          tenant.language}
                      </Badge>
                    </Td>
                    {canManagePortal ? (
                      <Td>
                        <div className="flex items-center gap-2">
                          <Badge tone={tenant.portalEnabledAt ? 'brand' : 'neutral'}>
                            {tenant.portalEnabledAt ? t('common.enabled') : t('common.disabled')}
                          </Badge>
                          <Button
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            disabled={portalPendingId === tenant.id}
                            onClick={() => togglePortal(tenant)}
                          >
                            {portalPendingId === tenant.id
                              ? t('app.loading')
                              : tenant.portalEnabledAt
                                ? t('tenant.portal_disable')
                                : t('tenant.portal_enable')}
                          </Button>
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('common.create')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="tenant-form" type="submit" disabled={pending}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="tenant-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="fullName">{t('tenant.full_name')}</Label>
            <Input
              id="fullName"
              required
              value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="phone">{t('tenant.phone')}</Label>
            <Input
              id="phone"
              placeholder="0911234567"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="employer">{t('tenant.employer')}</Label>
            <Input
              id="employer"
              value={form.employer}
              onChange={(event) => setForm((current) => ({ ...current, employer: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="language">{t('preferences.language')}</Label>
            <Select
              id="language"
              value={form.language}
              onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
            >
              {LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="emergencyContactName">{t('tenant.emergency_contact')}</Label>
            <Input
              id="emergencyContactName"
              value={form.emergencyContactName}
              onChange={(event) =>
                setForm((current) => ({ ...current, emergencyContactName: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="emergencyContactPhone">{t('tenant.phone')}</Label>
            <Input
              id="emergencyContactPhone"
              value={form.emergencyContactPhone}
              onChange={(event) =>
                setForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="idType">{t('tenant.id_type')}</Label>
            <Select
              id="idType"
              value={form.idType}
              onChange={(event) => setForm((current) => ({ ...current, idType: event.target.value }))}
            >
              <option value="">—</option>
              {(idTypes.data?.idTypes ?? []).map((type) => (
                <option key={type.id} value={type.code}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="idNumber">{t('tenant.id_number')}</Label>
            <Input
              id="idNumber"
              value={form.idNumber}
              onChange={(event) => setForm((current) => ({ ...current, idNumber: event.target.value }))}
            />
          </div>

          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
