'use client';

import { Add, Building3, Edit2 } from '@/components/icons';
import { useState } from 'react';

import { ETHIOPIAN_REGIONS, PROPERTY_TYPES, roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { useAction, useAsync, useAutoOpenModal } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { usePropertyContext } from '@/lib/property-context';
import type { Property } from '@/lib/types';

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
  FieldError,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

const EMPTY_FORM = {
  ownerId: '',
  name: '',
  type: 'apartment_block' as (typeof PROPERTY_TYPES)[number],
  totalFloors: '',
  regionCode: 'AA',
  cityOrZone: '',
  subCity: '',
  woreda: '',
  kebele: '',
  houseNumber: '',
  landmark: '',
  notes: '',
};

const EMPTY_BULK_FORM = {
  pattern: 'Villa {n}',
  start: 1,
  count: 5,
  padding: 1,
  type: 'apartment_block' as (typeof PROPERTY_TYPES)[number],
  totalFloors: '',
  regionCode: 'AA',
  subCity: '',
  woreda: '',
  kebele: '',
  houseNumber: '',
  landmark: '',
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
  // The sidebar property scope reframes this list too: one property selected
  // shows just that property (display filter, never an authorization change).
  const [propertyContext] = usePropertyContext();
  const visibleProperties = (properties.data?.properties ?? []).filter(
    (property) => propertyContext === null || property.id === propertyContext,
  );
  const selectedProperty = properties.data?.properties.find((p) => p.id === detailsId);
  const [open, setOpen] = useState(false);
  useAutoOpenModal(() => setOpen(true));
  const [form, setForm] = useState(EMPTY_FORM);
  const { pending, error, fieldErrors, run } = useAction();

  // Success feedback (no toast system — the page-level Alert is the pattern the
  // units page uses for its bulk actions).
  const [updatedNotice, setUpdatedNotice] = useState(false);
  const [bulkCreated, setBulkCreated] = useState<number | null>(null);

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
        totalFloors: form.totalFloors === '' ? undefined : Number(form.totalFloors),
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

  // --- edit ------------------------------------------------------------------
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const { pending: editPending, error: editError, fieldErrors: editFieldErrors, run: runEdit } = useAction();

  function openEdit(property: Property) {
    setEditing(property);
    setEditForm({
      ownerId: property.ownerId ?? '',
      name: property.name,
      type: (property.type || 'apartment_block') as (typeof EMPTY_FORM)['type'],
      totalFloors: property.totalFloors === null ? '' : String(property.totalFloors),
      regionCode: property.regionCode ?? 'AA',
      cityOrZone: property.cityOrZone ?? '',
      subCity: property.subCity ?? '',
      woreda: property.woreda ?? '',
      kebele: property.kebele ?? '',
      houseNumber: property.houseNumber ?? '',
      landmark: property.landmark ?? '',
      notes: property.notes ?? '',
    });
    setEditOpen(true);
  }

  function updateEdit<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setEditForm((current) => ({ ...current, [key]: value }));
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await runEdit(async () => {
      // Unlike creation, address fields go out as plain strings: the API's
      // partial update keeps existing values for omitted keys, so an emptied
      // field must still arrive (as '') for clearing to work.
      await api.updateProperty(editing.id, {
        ownerId: managed ? editForm.ownerId || undefined : undefined,
        name: editForm.name,
        type: editForm.type,
        totalFloors: editForm.totalFloors === '' ? undefined : Number(editForm.totalFloors),
        address: {
          regionCode: editForm.regionCode,
          cityOrZone: editForm.cityOrZone,
          subCity: editForm.subCity,
          woreda: editForm.woreda,
          kebele: editForm.kebele,
          houseNumber: editForm.houseNumber,
          landmark: editForm.landmark,
        },
        notes: editForm.notes,
      });
      setEditing(null);
      setEditOpen(false);
      setUpdatedNotice(true);
      properties.reload();
    }).catch(() => undefined);
  }

  // --- bulk-create -------------------------------------------------------------
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState(EMPTY_BULK_FORM);
  const { pending: bulkPending, error: bulkError, run: runBulk } = useAction();

  function updateBulk<K extends keyof typeof EMPTY_BULK_FORM>(
    key: K,
    value: (typeof EMPTY_BULK_FORM)[K],
  ) {
    setBulkForm((current) => ({ ...current, [key]: value }));
  }

  // Mirrors bulkPropertySchema: exactly one {n}, 1–50 properties, padding 1–4.
  const bulkPatternValid =
    (bulkForm.pattern.trim().match(/\{n\}/g) ?? []).length === 1 && bulkForm.pattern.trim().length >= 3;
  const bulkValid =
    bulkPatternValid &&
    Number.isFinite(bulkForm.start) &&
    Number.isFinite(bulkForm.count) &&
    Number.isFinite(bulkForm.padding) &&
    bulkForm.start >= 0 &&
    bulkForm.count >= 1 &&
    bulkForm.count <= 50 &&
    bulkForm.padding >= 1 &&
    bulkForm.padding <= 4 &&
    bulkForm.start + bulkForm.count - 1 <= 999999;

  const bulkPreview = Array.from({ length: Math.min(3, bulkForm.count) }, (_, i) =>
    bulkForm.pattern.replace(
      '{n}',
      String(bulkForm.start + i).padStart(Math.max(1, bulkForm.padding), '0'),
    ),
  );

  async function submitBulk(event: React.FormEvent) {
    event.preventDefault();
    await runBulk(async () => {
      const result = await api.bulkProperties({
        naming: {
          pattern: bulkForm.pattern.trim(),
          start: bulkForm.start,
          count: bulkForm.count,
          padding: bulkForm.padding,
        },
        type: bulkForm.type,
        address: {
          regionCode: bulkForm.regionCode,
          subCity: bulkForm.subCity || undefined,
          woreda: bulkForm.woreda || undefined,
          kebele: bulkForm.kebele || undefined,
          houseNumber: bulkForm.houseNumber || undefined,
          landmark: bulkForm.landmark || undefined,
        },
        totalFloors: bulkForm.totalFloors === '' ? undefined : Number(bulkForm.totalFloors),
      });
      setBulkOpen(false);
      setBulkForm(EMPTY_BULK_FORM);
      setBulkCreated(result.count);
      properties.reload();
    }).catch(() => undefined);
  }

  const regionName = (code: string | null) => {
    const found = ETHIOPIAN_REGIONS.find((region) => region.code === code);
    if (!found) return code || '—';
    return language === 'am' ? found.nameAm : found.name;
  };

  return (
    <div>
      <PageHeader
        titleKey="nav.properties"
        actions={
          <>
            <Button variant="secondary" disabled={!canWrite} onClick={() => setBulkOpen(true)}>
              {t('property.bulk_create')}
            </Button>
            <Button
              disabled={!canWrite || (canReadOwners && (owners.loading || !!owners.error))}
              onClick={() => setOpen(true)}
            >
              <Add className="h-4 w-4" />
              {t('common.create')}
            </Button>
          </>
        }
      />

      {owners.error && <Alert tone="danger">{owners.error}</Alert>}
      {updatedNotice && <Alert tone="success">{t('property.updated')}</Alert>}
      {bulkCreated !== null && (
        <Alert tone="success">{`${bulkCreated} · ${t('nav.properties')}`}</Alert>
      )}
      {managed && (
        <section className="mb-5 space-y-3" aria-label={t('portfolio.owners')}>
          <h2 className="text-lg font-semibold">{t('portfolio.owners')}</h2>
          {!owners.data?.owners.length && <p>{t('portfolio.no_owners')}</p>}
          {owners.data?.owners.map((owner) => (
            <details key={owner.id} className="rounded-md border bg-surface p-3">
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
            <details className="rounded-md border bg-surface p-3">
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
          ) : visibleProperties.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('property.name')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-[180px]">{t('property.name')}</Th>
                  {managed && (
                    <Th className="min-w-[110px] whitespace-nowrap">{t('portfolio.owner')}</Th>
                  )}
                  <Th className="min-w-[140px] whitespace-nowrap">{t('portfolio.blocks')}</Th>
                  <Th className="min-w-[110px] whitespace-nowrap">{t('property.type')}</Th>
                  <Th className="min-w-[110px] whitespace-nowrap">{t('property.region')}</Th>
                  <Th className="min-w-[110px] whitespace-nowrap">{t('property.sub_city')}</Th>
                  <Th className="min-w-[110px] whitespace-nowrap">{t('property.house_number')}</Th>
                  <Th className="min-w-[100px] whitespace-nowrap">{t('unit.status')}</Th>
                  <Th className="whitespace-nowrap">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {visibleProperties.map((property) => (
                  <tr key={property.id}>
                    <Td className="font-medium text-strong">{property.name}</Td>
                    {managed && <Td>{property.owner?.name ?? '—'}</Td>}
                    <Td className="whitespace-nowrap">
                      <Button variant="outline" onClick={() => setDetailsId(property.id)}>
                        <Building3 className="h-4 w-4" />
                        {t('portfolio.blocks')} ({property.buildings?.length ?? 0})
                      </Button>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {property.type ? property.type.replace(/_/g, ' ') : '—'}
                    </Td>
                    <Td className="whitespace-nowrap">{regionName(property.regionCode)}</Td>
                    <Td className="whitespace-nowrap">{property.subCity || '—'}</Td>
                    <Td className="whitespace-nowrap">
                      {property.houseNumber || property.landmark || '—'}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={property.status === 'active' ? 'brand' : 'neutral'}>
                        {t(`property.status.${property.status}` as never)}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('property.edit')}
                          title={t('property.edit')}
                          onClick={() => openEdit(property)}
                        >
                          <Edit2 size={16} className="text-body" />
                          {t('common.edit')}
                        </Button>
                      )}
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
          <div className="space-y-3">
            {!selectedProperty.buildings?.length && (
              <div className="rounded-md border border-dashed border-line bg-wash px-4 py-6 text-center">
                <p className="text-sm text-body">{t('portfolio.no_blocks')}</p>
                {canWrite && (
                  <p className="mt-1 text-xs text-muted">{t('portfolio.add_block_below_hint')}</p>
                )}
              </div>
            )}
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
          </div>
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
              <Label htmlFor="ownerId" required>
                {t('portfolio.owner')}
              </Label>
              <Select
                id="ownerId"
                required
                invalid={Boolean(fieldErrors.ownerId)}
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
              <FieldError>{fieldErrors.ownerId}</FieldError>
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="name" required>
              {t('property.name')}
            </Label>
            <Input
              id="name"
              required
              invalid={Boolean(fieldErrors.name)}
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
            />
            <FieldError>{fieldErrors.name}</FieldError>
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
            <Label htmlFor="totalFloors">{t('property.total_floors')}</Label>
            <Input
              id="totalFloors"
              type="number"
              min={0}
              max={200}
              invalid={Boolean(fieldErrors.totalFloors)}
              value={form.totalFloors}
              onChange={(event) => update('totalFloors', event.target.value)}
            />
            <FieldError>{fieldErrors.totalFloors}</FieldError>
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

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t('property.edit')}
        description={editing?.name}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="property-edit-form" type="submit" disabled={editPending || !canWrite}>
              {editPending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="property-edit-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitEdit}>
          {managed && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="edit-ownerId">{t('portfolio.owner')}</Label>
              <Select
                id="edit-ownerId"
                value={editForm.ownerId}
                onChange={(e) => updateEdit('ownerId', e.target.value)}
              >
                <option value="">{t('portfolio.choose_owner')}</option>
                {owners.data?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </Select>
              <FieldError>{editFieldErrors.ownerId}</FieldError>
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edit-name" required>
              {t('property.name')}
            </Label>
            <Input
              id="edit-name"
              required
              invalid={Boolean(editFieldErrors.name)}
              value={editForm.name}
              onChange={(event) => updateEdit('name', event.target.value)}
            />
            <FieldError>{editFieldErrors.name}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-type">{t('property.type')}</Label>
            <Select
              id="edit-type"
              value={editForm.type}
              onChange={(event) => updateEdit('type', event.target.value as typeof editForm.type)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-totalFloors">{t('property.total_floors')}</Label>
            <Input
              id="edit-totalFloors"
              type="number"
              min={0}
              max={200}
              invalid={Boolean(editFieldErrors.totalFloors)}
              value={editForm.totalFloors}
              onChange={(event) => updateEdit('totalFloors', event.target.value)}
            />
            <p className="text-[11px] text-muted">{t('property.total_floors_hint')}</p>
            <FieldError>{editFieldErrors.totalFloors}</FieldError>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-region">{t('property.region')}</Label>
            <Select
              id="edit-region"
              value={editForm.regionCode}
              onChange={(event) => updateEdit('regionCode', event.target.value)}
            >
              {ETHIOPIAN_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {language === 'am' ? region.nameAm : region.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-subCity">{t('property.sub_city')}</Label>
            <Input
              id="edit-subCity"
              value={editForm.subCity}
              onChange={(event) => updateEdit('subCity', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-woreda">{t('property.woreda')}</Label>
            <Input
              id="edit-woreda"
              value={editForm.woreda}
              onChange={(event) => updateEdit('woreda', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-kebele">{t('property.kebele')}</Label>
            <Input
              id="edit-kebele"
              value={editForm.kebele}
              onChange={(event) => updateEdit('kebele', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-houseNumber">{t('property.house_number')}</Label>
            <Input
              id="edit-houseNumber"
              value={editForm.houseNumber}
              onChange={(event) => updateEdit('houseNumber', event.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edit-landmark">{t('property.address_landmark')}</Label>
            <Input
              id="edit-landmark"
              value={editForm.landmark}
              onChange={(event) => updateEdit('landmark', event.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edit-notes">{t('maintenance.notes')}</Label>
            <Textarea
              id="edit-notes"
              maxLength={2000}
              value={editForm.notes}
              onChange={(event) => updateEdit('notes', event.target.value)}
            />
          </div>

          {editError ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{editError}</Alert>
            </div>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={t('property.bulk_create')}
        description={t('property.bulk_hint')}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="property-bulk-form" type="submit" disabled={bulkPending || !bulkValid}>
              {bulkPending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="property-bulk-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitBulk}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="bulk-property-pattern" required>
              {t('bulk.pattern')}
            </Label>
            <Input
              id="bulk-property-pattern"
              required
              maxLength={120}
              invalid={!bulkPatternValid}
              value={bulkForm.pattern}
              onChange={(event) => updateBulk('pattern', event.target.value)}
            />
            <p className="text-[11px] text-muted">{t('property.bulk_hint')}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <div className="space-y-1">
              <Label htmlFor="bulk-property-start">{t('bulk.start')}</Label>
              <Input
                id="bulk-property-start"
                type="number"
                min={0}
                max={999999}
                required
                value={bulkForm.start}
                onChange={(event) => updateBulk('start', event.target.valueAsNumber)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-property-count">{t('bulk.count')}</Label>
              <Input
                id="bulk-property-count"
                type="number"
                min={1}
                max={50}
                required
                value={bulkForm.count}
                onChange={(event) => updateBulk('count', event.target.valueAsNumber)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-property-padding">{t('bulk.padding')}</Label>
              <Input
                id="bulk-property-padding"
                type="number"
                min={1}
                max={4}
                required
                value={bulkForm.padding}
                onChange={(event) => updateBulk('padding', event.target.valueAsNumber)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bulk-property-type">{t('property.type')}</Label>
            <Select
              id="bulk-property-type"
              value={bulkForm.type}
              onChange={(event) => updateBulk('type', event.target.value as typeof bulkForm.type)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bulk-property-floors">{`${t('property.total_floors')} (${t('common.optional')})`}</Label>
            <Input
              id="bulk-property-floors"
              type="number"
              min={0}
              max={200}
              value={bulkForm.totalFloors}
              onChange={(event) => updateBulk('totalFloors', event.target.value)}
            />
            <p className="text-[11px] text-muted">{t('property.total_floors_hint')}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bulk-property-region">{t('property.region')}</Label>
            <Select
              id="bulk-property-region"
              value={bulkForm.regionCode}
              onChange={(event) => updateBulk('regionCode', event.target.value)}
            >
              {ETHIOPIAN_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {language === 'am' ? region.nameAm : region.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="bulk-property-subCity">{t('property.sub_city')}</Label>
            <Input
              id="bulk-property-subCity"
              value={bulkForm.subCity}
              onChange={(event) => updateBulk('subCity', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-property-woreda">{t('property.woreda')}</Label>
            <Input
              id="bulk-property-woreda"
              value={bulkForm.woreda}
              onChange={(event) => updateBulk('woreda', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-property-kebele">{t('property.kebele')}</Label>
            <Input
              id="bulk-property-kebele"
              value={bulkForm.kebele}
              onChange={(event) => updateBulk('kebele', event.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="bulk-property-houseNumber">{t('property.house_number')}</Label>
            <Input
              id="bulk-property-houseNumber"
              value={bulkForm.houseNumber}
              onChange={(event) => updateBulk('houseNumber', event.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="bulk-property-landmark">{t('property.address_landmark')}</Label>
            <Input
              id="bulk-property-landmark"
              value={bulkForm.landmark}
              onChange={(event) => updateBulk('landmark', event.target.value)}
            />
          </div>

          <p className="break-words text-sm sm:col-span-2" aria-live="polite">
            {t('bulk.preview')}:{' '}
            {bulkValid
              ? `${bulkPreview.join(', ')}${bulkForm.count > bulkPreview.length ? ' …' : ''}`
              : t('bulk.invalid')}
          </p>

          {bulkError ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{bulkError}</Alert>
            </div>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
