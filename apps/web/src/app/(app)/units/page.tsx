'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { UNIT_STATUSES } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { MoneyInput } from '@/components/form-controls';
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

export default function UnitsPage() {
  const { t, language } = usePreferences();
  const units = useAsync(() => api.units(), []);
  const properties = useAsync(() => api.properties(), []);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    propertyId: '',
    label: '',
    floor: '',
    bedrooms: '',
    bathrooms: '',
    status: 'vacant' as (typeof UNIT_STATUSES)[number],
  });
  const [marketRent, setMarketRent] = useState<number | null>(null);
  const { pending, error, run } = useAction();

  const propertyName = useMemo(() => {
    const map = new Map((properties.data?.properties ?? []).map((property) => [property.id, property.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [properties.data]);

  const visible = (units.data?.units ?? []).filter(
    (unit) =>
      search.trim() === '' ||
      unit.label.toLowerCase().includes(search.toLowerCase()) ||
      propertyName(unit.propertyId).toLowerCase().includes(search.toLowerCase()),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createUnit({
        propertyId: form.propertyId,
        label: form.label,
        floor: form.floor === '' ? undefined : Number(form.floor),
        bedrooms: form.bedrooms === '' ? undefined : Number(form.bedrooms),
        bathrooms: form.bathrooms === '' ? undefined : Number(form.bathrooms),
        status: form.status,
        marketRent: marketRent === null ? undefined : { amountMinor: marketRent, currency: 'ETB' },
      });
      setOpen(false);
      setForm({ propertyId: '', label: '', floor: '', bedrooms: '', bathrooms: '', status: 'vacant' });
      setMarketRent(null);
      units.reload();
    }).catch(() => undefined);
  }

  return (
    <div>
      <PageHeader
        titleKey="nav.units"
        actions={
          <>
            <Input
              placeholder={t('common.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-40"
            />
            <Button onClick={() => setOpen(true)} disabled={(properties.data?.properties.length ?? 0) === 0}>
              <Plus className="h-4 w-4" />
              {t('common.create')}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          {units.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : units.error ? (
            <div className="p-4">
              <Alert tone="danger">{units.error}</Alert>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('unit.label')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('unit.label')}</Th>
                  <Th>{t('nav.properties')}</Th>
                  <Th>{t('unit.bedrooms')}</Th>
                  <Th>{t('unit.area_sqm')}</Th>
                  <Th>{t('unit.market_rent')}</Th>
                  <Th>{t('unit.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((unit) => (
                  <tr key={unit.id}>
                    <Td className="font-medium text-slate-900">{unit.label}</Td>
                    <Td>{unit.property?.name ?? propertyName(unit.propertyId)}</Td>
                    <Td>
                      {unit.bedrooms ?? '—'} / {unit.bathrooms ?? '—'}
                    </Td>
                    <Td>{unit.areaSqm ?? '—'}</Td>
                    <Td className="tabular">
                      {unit.marketRentMinor
                        ? formatAmount(unit.marketRentMinor, unit.currency, language)
                        : '—'}
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[unit.status])}>
                        {t(`unit.status.${unit.status}` as never)}
                      </Badge>
                    </Td>
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
            <Button form="unit-form" type="submit" disabled={pending}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="unit-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="propertyId">{t('nav.properties')}</Label>
            <Select
              id="propertyId"
              required
              value={form.propertyId}
              onChange={(event) => setForm((current) => ({ ...current, propertyId: event.target.value }))}
            >
              <option value="">—</option>
              {properties.data?.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="label">{t('unit.label')}</Label>
            <Input
              id="label"
              required
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="status">{t('unit.status')}</Label>
            <Select
              id="status"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as typeof form.status }))
              }
            >
              {UNIT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`unit.status.${status}` as never)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bedrooms">{t('unit.bedrooms')}</Label>
            <Input
              id="bedrooms"
              type="number"
              min={0}
              value={form.bedrooms}
              onChange={(event) => setForm((current) => ({ ...current, bedrooms: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="floor">{t('common.optional')}</Label>
            <Input
              id="floor"
              type="number"
              value={form.floor}
              onChange={(event) => setForm((current) => ({ ...current, floor: event.target.value }))}
            />
          </div>

          <div className="sm:col-span-2">
            <MoneyInput label={t('unit.market_rent')} value={marketRent} onChange={setMarketRent} />
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
