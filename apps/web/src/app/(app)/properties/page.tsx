'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { ETHIOPIAN_REGIONS, PROPERTY_TYPES } from '@pms/shared';

import { api } from '@/lib/api';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
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

const EMPTY_FORM = {
  name: '',
  type: 'apartment_block' as (typeof PROPERTY_TYPES)[number],
  regionCode: 'AA',
  cityOrZone: '',
  subCity: '',
  woreda: '',
  kebele: '',
  houseNumber: '',
  landmark: '',
  notes: '',
};

export default function PropertiesPage() {
  const { t, language } = usePreferences();
  const properties = useAsync(() => api.properties(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const { pending, error, run } = useAction();

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createProperty({
        name: form.name,
        type: form.type,
        address: {
          regionCode: form.regionCode,
          cityOrZone: form.cityOrZone || undefined,
          subCity: form.subCity || undefined,
          woreda: form.woreda || undefined,
          kebele: form.kebele || undefined,
          houseNumber: form.houseNumber || undefined,
          landmark: form.landmark || undefined,
        },
        notes: form.notes || undefined,
      });
      setForm(EMPTY_FORM);
      setOpen(false);
      properties.reload();
    }).catch(() => undefined);
  }

  const regionName = (code: string | null) => {
    const found = ETHIOPIAN_REGIONS.find((region) => region.code === code);
    if (!found) return code ?? '—';
    return language === 'am' ? found.nameAm : found.name;
  };

  return (
    <div>
      <PageHeader
        titleKey="nav.properties"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('common.create')}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {properties.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : properties.error ? (
            <div className="p-4">
              <Alert tone="danger">{properties.error}</Alert>
            </div>
          ) : (properties.data?.properties.length ?? 0) === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('property.name')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('property.name')}</Th>
                  <Th>{t('property.type')}</Th>
                  <Th>{t('property.region')}</Th>
                  <Th>{t('property.sub_city')}</Th>
                  <Th>{t('property.house_number')}</Th>
                  <Th>{t('unit.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {properties.data?.properties.map((property) => (
                  <tr key={property.id}>
                    <Td className="font-medium text-slate-900">{property.name}</Td>
                    <Td>{property.type.replace(/_/g, ' ')}</Td>
                    <Td>{regionName(property.regionCode)}</Td>
                    <Td>{property.subCity ?? '—'}</Td>
                    <Td>{property.houseNumber ?? property.landmark ?? '—'}</Td>
                    <Td>
                      <Badge tone={property.status === 'active' ? 'brand' : 'neutral'}>
                        {property.status}
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
        description={t('property.name')}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="property-form" type="submit" disabled={pending}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="property-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="name">{t('property.name')}</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="type">{t('property.type')}</Label>
            <Select
              id="type"
              value={form.type}
              onChange={(event) => update('type', event.target.value as typeof form.type)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="region">{t('property.region')}</Label>
            <Select
              id="region"
              value={form.regionCode}
              onChange={(event) => update('regionCode', event.target.value)}
            >
              {ETHIOPIAN_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name} / {region.nameAm}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="subCity">{t('property.sub_city')}</Label>
            <Input
              id="subCity"
              value={form.subCity}
              onChange={(event) => update('subCity', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="woreda">{t('property.woreda')}</Label>
            <Input
              id="woreda"
              value={form.woreda}
              onChange={(event) => update('woreda', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kebele">{t('property.kebele')}</Label>
            <Input
              id="kebele"
              value={form.kebele}
              onChange={(event) => update('kebele', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="houseNumber">{t('property.house_number')}</Label>
            <Input
              id="houseNumber"
              value={form.houseNumber}
              onChange={(event) => update('houseNumber', event.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="landmark">{t('property.address_landmark')}</Label>
            <Input
              id="landmark"
              value={form.landmark}
              onChange={(event) => update('landmark', event.target.value)}
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
