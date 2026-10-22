'use client';
import { useState } from 'react';
import { unitLabelsWithFloors } from '@pms/shared';
import { api } from '@/lib/api';
import type { Property } from '@/lib/types';
import { useAction } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { MoneyInput } from './form-controls';
import { Alert, Button, Input, Label, Select } from './ui';

/** "1, 2, 3" / "G, 1" is not accepted — floors are integers (basements negative). */
function parseFloors(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',');
  if (parts.length > 60) return null;
  const floors: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part.trim())) return null;
    const value = Number(part.trim());
    if (!Number.isSafeInteger(value) || value < -5 || value > 200) return null;
    floors.push(value);
  }
  return floors;
}

export function BulkUnitForm({
  properties,
  onSaved,
}: {
  properties: Property[];
  onSaved: (count: number) => void;
}) {
  const { t, session } = usePreferences();
  const [propertyId, setProperty] = useState('');
  const [buildingId, setBuilding] = useState('');
  const [pattern, setPattern] = useState('A-{n}');
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(10);
  const [padding, setPadding] = useState(3);
  const [floorsText, setFloorsText] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [marketRent, setMarketRent] = useState<number | null>(null);
  const { pending, error, run } = useAction();
  const floors = parseFloors(floorsText);
  const floorsInvalid = floorsText.trim() !== '' && floors === null;
  let generated: { label: string; floor: number | null }[] = [];
  try {
    if (floors !== null) generated = unitLabelsWithFloors({ pattern, start, count, padding, floors });
    else generated = unitLabelsWithFloors({ pattern, start, count, padding }).map((u) => ({ ...u }));
  } catch {
    /* Invalid preview disables submit. */
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!generated.length) return;
        void run(async () => {
          const currency = (session?.organization?.currency as string | undefined) ?? 'ETB';
          const result = await api.bulkUnits({
            propertyId,
            buildingId: buildingId || null,
            naming: {
              pattern,
              start,
              count,
              padding,
              ...(floors ? { floors } : {}),
            },
            typeLabel: typeLabel.trim() || undefined,
            marketRent: marketRent === null ? undefined : { amountMinor: marketRent, currency },
          });
          onSaved(result.count);
        }).catch(() => undefined);
      }}
    >
      <p className="text-sm text-soft">{t('bulk.hint')}</p>
      <Label htmlFor="bulk-property">{t('nav.properties')}</Label>
      <Select
        id="bulk-property"
        required
        value={propertyId}
        onChange={(e) => {
          setProperty(e.target.value);
          setBuilding('');
        }}
      >
        <option value="">{t('common.select')}</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Label htmlFor="bulk-building">{t('portfolio.block')}</Label>
      <Select id="bulk-building" value={buildingId} onChange={(e) => setBuilding(e.target.value)}>
        <option value="">{t('portfolio.no_block')}</option>
        {properties
          .find((p) => p.id === propertyId)
          ?.buildings?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </Select>
      <Label htmlFor="bulk-pattern">{t('bulk.pattern')}</Label>
      <Input
        id="bulk-pattern"
        required
        maxLength={50}
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="bulk-start">{t('bulk.start')}</Label>
          <Input
            id="bulk-start"
            type="number"
            min={0}
            max={999999}
            required
            value={start}
            onChange={(e) => setStart(e.target.valueAsNumber)}
          />
        </div>
        <div>
          <Label htmlFor="bulk-count">{floors ? t('bulk.count_per_floor') : t('bulk.count')}</Label>
          <Input
            id="bulk-count"
            type="number"
            min={1}
            max={200}
            required
            value={count}
            onChange={(e) => setCount(e.target.valueAsNumber)}
          />
        </div>
        <div>
          <Label htmlFor="bulk-padding">{t('bulk.padding')}</Label>
          <Input
            id="bulk-padding"
            type="number"
            min={1}
            max={6}
            required
            value={padding}
            onChange={(e) => setPadding(e.target.valueAsNumber)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="bulk-floors">{t('bulk.floors')}</Label>
        <Input
          id="bulk-floors"
          inputMode="numeric"
          placeholder="1, 2, 3"
          value={floorsText}
          onChange={(e) => setFloorsText(e.target.value)}
          aria-invalid={floorsInvalid || undefined}
        />
        <p className="mt-1 text-[11px] text-muted">{t('bulk.floors_hint')}</p>
      </div>
      <div>
        <Label htmlFor="bulk-type">{t('bulk.type_label')}</Label>
        <Input
          id="bulk-type"
          maxLength={60}
          value={typeLabel}
          onChange={(e) => setTypeLabel(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-muted">{t('bulk.type_hint')}</p>
      </div>
      <MoneyInput label={t('bulk.market_rent_optional')} value={marketRent} onChange={setMarketRent} />
      <p className="break-words text-sm" aria-live="polite">
        {t('bulk.preview')}:{' '}
        {generated.length
          ? `${generated.slice(0, 5).map((u) => u.label).join(', ')}${generated.length > 5 ? ` … ${generated.at(-1)!.label}` : ''}`
          : t('bulk.invalid')}
      </p>
      {floorsInvalid && <Alert tone="danger">{t('bulk.floors_invalid')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={pending || !propertyId || !generated.length || floorsInvalid}>
        {pending ? t('app.loading') : t('bulk.create')}
      </Button>
    </form>
  );
}
