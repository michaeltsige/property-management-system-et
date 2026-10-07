'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { UNIT_STATUSES, roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { usePropertyContext } from '@/lib/property-context';
import { CsvImport } from '@/components/csv-import';
import { BulkUnitForm } from '@/components/bulk-unit-form';
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
  const { t, language, session } = usePreferences();
  const canWrite = roleHasPermission(session?.role as Role, 'units.write');
  const units = useAsync(() => api.units(), []);
  const properties = useAsync(() => api.properties(), []);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    buildingId: '',
    propertyId: '',
    label: '',
    floor: '',
    bedrooms: '',
    bathrooms: '',
    status: 'vacant' as (typeof UNIT_STATUSES)[number],
  });
  const [marketRent, setMarketRent] = useState<number | null>(null);
  const { pending, error, run } = useAction();

  // Rent-by-type: one click reprices every unit of an apartment type.
  const [rentTypeOpen, setRentTypeOpen] = useState(false);
  const [rentTypeForm, setRentTypeForm] = useState({ propertyId: '', typeLabel: '' });
  const [rentTypeValue, setRentTypeValue] = useState<number | null>(null);
  const [rentTypeResult, setRentTypeResult] = useState<number | null>(null);

  const typesInProperty = useMemo(() => {
    const set = new Set<string>();
    for (const unit of units.data?.units ?? []) {
      if (unit.propertyId === rentTypeForm.propertyId && unit.typeLabel) set.add(unit.typeLabel);
    }
    return Array.from(set).sort();
  }, [units.data, rentTypeForm.propertyId]);

  async function submitRentByType(event: React.FormEvent) {
    event.preventDefault();
    if (rentTypeValue === null) return;
    await run(async () => {
      const result = await api.setRentByType({
        propertyId: rentTypeForm.propertyId,
        typeLabel: rentTypeForm.typeLabel,
        marketRent: { amountMinor: rentTypeValue, currency: 'ETB' },
      });
      setRentTypeResult(result.updated);
      setRentTypeOpen(false);
      setRentTypeForm({ propertyId: '', typeLabel: '' });
      setRentTypeValue(null);
      units.reload();
    }).catch(() => undefined);
  }

  const [propertyContext] = usePropertyContext();
  const propertyName = useMemo(() => {
    const map = new Map((properties.data?.properties ?? []).map((property) => [property.id, property.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [properties.data]);

  const visible = (units.data?.units ?? []).filter(
    (unit) =>
      (propertyContext === null || unit.propertyId === propertyContext) &&
      (search.trim() === '' ||
        unit.label.toLowerCase().includes(search.toLowerCase()) ||
        propertyName(unit.propertyId).toLowerCase().includes(search.toLowerCase())),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createUnit({
        buildingId: form.buildingId || null,
        propertyId: form.propertyId,
        label: form.label,
        floor: form.floor === '' ? undefined : Number(form.floor),
        bedrooms: form.bedrooms === '' ? undefined : Number(form.bedrooms),
        bathrooms: form.bathrooms === '' ? undefined : Number(form.bathrooms),
        status: form.status,
        marketRent: marketRent === null ? undefined : { amountMinor: marketRent, currency: 'ETB' },
      });
      setOpen(false);
      setForm({
        buildingId: '',
        propertyId: '',
        label: '',
        floor: '',
        bedrooms: '',
        bathrooms: '',
        status: 'vacant',
      });
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
            {canWrite && (
              <CsvImport
                kind="units"
                properties={properties.data?.properties ?? []}
                onImported={units.reload}
              />
            )}
            {canWrite && (
              <Button
                variant="secondary"
                onClick={() => setBulkOpen(true)}
                disabled={!properties.data?.properties.length}
              >
                {t('bulk.create')}
              </Button>
            )}
            {canWrite && (
              <Button variant="secondary" onClick={() => setRentTypeOpen(true)}>
                {t('units.set_rent_by_type')}
              </Button>
            )}
            <Input
              placeholder={t('common.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-40"
            />
            <Button
              onClick={() => setOpen(true)}
              disabled={!canWrite || (properties.data?.properties.length ?? 0) === 0}
            >
              <Plus className="h-4 w-4" />
              {t('common.create')}
            </Button>
          </>
        }
      />

      {bulkCount !== null && <Alert>{t('bulk.created', { count: bulkCount })}</Alert>}
      {rentTypeResult !== null && (
        <Alert tone="success">{t('units.rent_updated', { count: rentTypeResult })}</Alert>
      )}
      {canWrite && (
        <Modal open={bulkOpen} onOpenChange={setBulkOpen} title={t('bulk.create')}>
          <BulkUnitForm
            properties={properties.data?.properties ?? []}
            onSaved={(count) => {
              setBulkOpen(false);
              setBulkCount(count);
              units.reload();
            }}
          />
        </Modal>
      )}
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
                  <Th>{t('units.type')}</Th>
                  <Th>{t('nav.properties')}</Th>
                  <Th>{t('portfolio.block')}</Th>
                  <Th>{t('unit.bedrooms')}</Th>
                  <Th>{t('unit.area_sqm')}</Th>
                  <Th>{t('unit.market_rent')}</Th>
                  <Th>{t('unit.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((unit) => (
                  <tr key={unit.id}>
                    <Td className="font-medium text-slate-900">
                      <Link href={`/units/${unit.id}`} className="text-brand-700 hover:underline">
                        {unit.label}
                      </Link>
                    </Td>
                    <Td>{unit.typeLabel ?? '—'}</Td>
                    <Td>{unit.property?.name ?? propertyName(unit.propertyId)}</Td>
                    <Td>{unit.building?.name ?? t('portfolio.no_block')}</Td>
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
            <Button form="unit-form" type="submit" disabled={pending || !canWrite}>
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
              onChange={(event) =>
                setForm((current) => ({ ...current, propertyId: event.target.value, buildingId: '' }))
              }
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
            <Label htmlFor="buildingId">{t('portfolio.block')}</Label>
            <Select
              id="buildingId"
              value={form.buildingId}
              onChange={(e) => setForm((f) => ({ ...f, buildingId: e.target.value }))}
            >
              <option value="">{t('portfolio.no_block')}</option>
              {properties.data?.properties
                .find((p) => p.id === form.propertyId)
                ?.buildings?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
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

      <Modal
        open={rentTypeOpen}
        onOpenChange={(value) => {
          setRentTypeOpen(value);
          if (!value) {
            setRentTypeForm({ propertyId: '', typeLabel: '' });
            setRentTypeValue(null);
          }
        }}
        title={t('units.set_rent_by_type')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRentTypeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              form="rent-by-type-form"
              type="submit"
              disabled={
                pending || !rentTypeForm.propertyId || !rentTypeForm.typeLabel || rentTypeValue === null
              }
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="rent-by-type-form" className="grid gap-3" onSubmit={submitRentByType}>
          <div className="space-y-1">
            <Label htmlFor="rentTypeProperty">{t('nav.properties')}</Label>
            <Select
              id="rentTypeProperty"
              required
              value={rentTypeForm.propertyId}
              onChange={(event) => setRentTypeForm({ propertyId: event.target.value, typeLabel: '' })}
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
            <Label htmlFor="rentTypeLabel">{t('units.type')}</Label>
            <Select
              id="rentTypeLabel"
              required
              value={rentTypeForm.typeLabel}
              disabled={!rentTypeForm.propertyId}
              onChange={(event) =>
                setRentTypeForm((current) => ({ ...current, typeLabel: event.target.value }))
              }
            >
              <option value="">—</option>
              {typesInProperty.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            {rentTypeForm.propertyId && typesInProperty.length === 0 ? (
              <p className="text-xs text-slate-500">{t('units.no_types')}</p>
            ) : null}
          </div>

          <MoneyInput
            label={t('unit.market_rent')}
            value={rentTypeValue}
            onChange={setRentTypeValue}
            required
          />
          <p className="text-xs text-slate-500">{t('units.rent_by_type_hint')}</p>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
      </Modal>
    </div>
  );
}
