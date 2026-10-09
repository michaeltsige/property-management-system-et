'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { ETHIOPIAN_REGIONS, PROPERTY_TYPES, roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { OwnerEditor, BlockEditor, feeText } from '@/components/hierarchy-controls';
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
  ownerId: '',
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
  const { t, language, session } = usePreferences();
  const canWrite = roleHasPermission(session?.role as Role, 'properties.write');
  const canReadOwners = roleHasPermission(session?.role as Role, 'owners.read');
  const canWriteOwners = roleHasPermission(session?.role as Role, 'owners.write');
  const owners = useAsync(() => (canReadOwners ? api.owners() : Promise.resolve(null)), [canReadOwners]);
  const managed = owners.data?.portfolioMode === 'managed';
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const properties = useAsync(() => api.properties(), []);
  const selectedProperty = properties.data?.properties.find((p) => p.id === detailsId);
  const [open, setOpen] = useState(false);
  useAutoOpenModal(() => setOpen(true));
  const [form, setForm] = useState(EMPTY_FORM);
  const { pending, error, run } = useAction();

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createProperty({
        ownerId: managed ? form.ownerId : undefined,
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
          <Button
            disabled={!canWrite || (canReadOwners && (owners.loading || !!owners.error))}
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t('common.create')}
          </Button>
        }
      />

      {owners.error && <Alert tone="danger">{owners.error}</Alert>}
      {managed && (
        <section className="mb-5 space-y-3" aria-label={t('portfolio.owners')}>
          <h2 className="text-lg font-semibold">{t('portfolio.owners')}</h2>
          {!owners.data?.owners.length && <p>{t('portfolio.no_owners')}</p>}
          {owners.data?.owners.map((owner) => (
            <details key={owner.id} className="rounded-md border bg-white p-3">
              <summary className="cursor-pointer">
                {owner.name}
                {owner.managementFeeBps !== null ? ` · ${feeText(owner.managementFeeBps)}%` : ''}
              </summary>
              {canWriteOwners && (
                <OwnerEditor
                  owner={owner}
                  onSaved={() => {
                    owners.reload();
                    properties.reload();
                  }}
                />
              )}
            </details>
          ))}
          {canWriteOwners && (
            <details className="rounded-md border bg-white p-3">
              <summary className="cursor-pointer">{t('portfolio.add_owner')}</summary>
              <OwnerEditor onSaved={owners.reload} />
            </details>
          )}
        </section>
      )}
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
                  {managed && <Th>{t('portfolio.owner')}</Th>}
                  <Th>{t('portfolio.blocks')}</Th>
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
                    {managed && <Td>{property.owner?.name ?? '—'}</Td>}
                    <Td>
                      <Button variant="secondary" onClick={() => setDetailsId(property.id)}>
                        {t('portfolio.blocks')} ({property.buildings?.length ?? 0})
                      </Button>
                    </Td>
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
        open={!!selectedProperty}
        onOpenChange={(value) => {
          if (!value) setDetailsId(null);
        }}
        title={`${selectedProperty?.name ?? ''} · ${t('portfolio.blocks')}`}
      >
        {selectedProperty && (
          <>
            {!selectedProperty.buildings?.length && <p>{t('portfolio.no_blocks')}</p>}
            {selectedProperty.buildings?.map((block) =>
              canWrite ? (
                <BlockEditor
                  key={block.id}
                  propertyId={selectedProperty.id}
                  block={block}
                  onSaved={properties.reload}
                />
              ) : (
                <p key={block.id}>{block.name}</p>
              ),
            )}
            {canWrite && <BlockEditor propertyId={selectedProperty.id} onSaved={properties.reload} />}
          </>
        )}
      </Modal>
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
            <Button
              form="property-form"
              type="submit"
              disabled={pending || !canWrite || (canReadOwners && (owners.loading || !!owners.error))}
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="property-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          {managed && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ownerId">{t('portfolio.owner')}</Label>
              <Select
                id="ownerId"
                required
                value={form.ownerId}
                onChange={(e) => update('ownerId', e.target.value)}
              >
                <option value="">{t('portfolio.choose_owner')}</option>
                {owners.data?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
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
                  {language === 'am' ? region.nameAm : region.name}
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
