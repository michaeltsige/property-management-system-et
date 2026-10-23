'use client';

import { roleHasPermission, type Role } from '@pms/shared';
import { CsvImport } from '@/components/csv-import';
import { Add } from '@/components/icons';
import { useMemo, useState } from 'react';

import { api } from '@/lib/api';
import type { Tenant } from '@/lib/types';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { usePropertyContext } from '@/lib/property-context';

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
  FieldError,
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
  // The sidebar property scope: a tenant belongs to a property through their
  // leases (lease → unit → property), so map it once and filter the table.
  const [propertyContext] = usePropertyContext();
  const leases = useAsync(
    () => (propertyContext ? api.leases() : Promise.resolve(null)),
    [propertyContext],
  );
  const tenantsInScope = useMemo(() => {
    if (propertyContext === null) return tenants.data?.tenants ?? [];
    const scopedTenantIds = new Set(
      (leases.data?.leases ?? [])
        .filter((lease) => lease.unit.property.id === propertyContext)
        .map((lease) => lease.tenant.id),
    );
    return (tenants.data?.tenants ?? []).filter((tenant) => scopedTenantIds.has(tenant.id));
  }, [propertyContext, leases.data, tenants.data]);
  const [open, setOpen] = useState(false);
  useAutoOpenModal(() => setOpen(true));
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    employer: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    idType: '',
    idNumber: '',
  });
  // Optional: the scanned/photographed ID that matches the typed number. Never
  // required here — a landlord can add it later from Documents.
  const [idFile, setIdFile] = useState<File | null>(null);
  // Portal enrollment in the same flow: the tenant signs in with this phone
  // number and an SMS code, so it only makes sense when a phone was entered.
  const [portalNow, setPortalNow] = useState(true);
  const { pending, error, fieldErrors, run } = useAction();
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
      const created = await api.createTenant({
        fullName: form.fullName,
        phone: form.phone || undefined,
        email: form.email || undefined,
        employer: form.employer || undefined,
        emergencyContactName: form.emergencyContactName || undefined,
        emergencyContactPhone: form.emergencyContactPhone || undefined,
        // The number is encrypted at rest by the API; only the last four digits
        // are ever returned to a browser.
        idDocuments:
          form.idType && form.idNumber ? [{ type: form.idType, number: form.idNumber }] : undefined,
      });
      if (idFile) {
        // The profile exists at this point; a failed upload must not make the
        // landlord re-type everything. Re-throw with a message, tenant stays.
        try {
          const dataBase64 = await readAsBase64(idFile);
          await api.uploadDocument({
            category: 'id_document',
            title: `${form.fullName} ID`,
            filename: idFile.name,
            mimeType: idFile.type,
            dataBase64,
            tenantId: created.tenant.id,
          });
        } catch {
          throw new Error(t('documents.id_upload_failed'));
        }
      }
      if (portalNow && (form.phone || form.email)) {
        // Same one-flow promise: the account exists when the landlord is done.
        // Enrollment itself is idempotent; a failure keeps the tenant and is
        // recoverable from the Tenants list.
        try {
          await api.enableTenantPortal(created.tenant.id);
        } catch {
          throw new Error(t('tenant.portal_enable_failed'));
        }
      }
      setForm({
        fullName: '',
        phone: '',
        email: '',
        employer: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        idType: '',
        idNumber: '',
      });
      setIdFile(null);
      setPortalNow(true);
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
              className="h-9 w-full sm:w-40"
            />
            <Button leadingIcon={<Add className="h-4 w-4" />} onClick={() => setOpen(true)}>
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
          ) : tenantsInScope.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('tenant.full_name')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('tenant.full_name')}</Th>
                  <Th>{t('tenant.phone')}</Th>
                  <Th>{t('tenant.employer')}</Th>
                  <Th>{t('tenant.emergency_contact')}</Th>
                  {canManagePortal ? <Th>{t('tenant.portal')}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {tenantsInScope.map((tenant) => (
                  <tr key={tenant.id}>
                    <Td className="font-medium text-strong">{tenant.fullName}</Td>
                    <Td className="tabular">{tenant.phone ?? '—'}</Td>
                    <Td>{tenant.employer ?? '—'}</Td>
                    <Td>
                      {tenant.emergencyContactName ?? '—'}
                      {tenant.emergencyContactPhone ? (
                        <span className="block text-[11px] text-muted">
                          {tenant.emergencyContactPhone}
                        </span>
                      ) : null}
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
          <p className="text-xs text-muted sm:col-span-2">{t('form.required_note')}</p>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="fullName" required>
              {t('tenant.full_name')}
            </Label>
            <Input
              id="fullName"
              required
              invalid={Boolean(fieldErrors.fullName)}
              value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
            />
            <FieldError>{fieldErrors.fullName}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="phone">{t('tenant.phone')}</Label>
            <Input
              id="phone"
              placeholder="0911234567"
              invalid={Boolean(fieldErrors.phone)}
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
            <FieldError>{fieldErrors.phone}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              invalid={Boolean(fieldErrors.email)}
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
            <FieldError>{fieldErrors.email}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="employer">{t('tenant.employer')}</Label>
            <Input
              id="employer"
              value={form.employer}
              onChange={(event) => setForm((current) => ({ ...current, employer: event.target.value }))}
            />
          </div>

          {/* The emergency pair sits under its own heading so the second phone
              is never mistaken for a second work/personal number. */}
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold text-soft">{t('tenant.emergency_contact')}</p>
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
            <Label htmlFor="emergencyContactPhone">{t('tenant.emergency_phone')}</Label>
            <Input
              id="emergencyContactPhone"
              placeholder="0911234567"
              invalid={Boolean(fieldErrors.emergencyContactPhone)}
              value={form.emergencyContactPhone}
              onChange={(event) =>
                setForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))
              }
            />
            <FieldError>{fieldErrors.emergencyContactPhone}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="idType">{t('tenant.id_type')}</Label>
            <Select
              id="idType"
              value={form.idType}
              onChange={(event) => setForm((current) => ({ ...current, idType: event.target.value }))}
            >
              <option value="">{t('common.select')}</option>
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

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="idFile">{`${t('documents.id_file')} (${t('common.optional')})`}</Label>
            <Input
              id="idFile"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setIdFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-muted">{t('documents.id_file_hint')}</p>
          </div>

          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-soft">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line"
                checked={portalNow}
                onChange={(event) => setPortalNow(event.target.checked)}
              />
              <span>
                <span className="font-medium text-strong">{t('tenant.portal_now')}</span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {t('tenant.portal_now_hint')}
                </span>
              </span>
            </label>
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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
