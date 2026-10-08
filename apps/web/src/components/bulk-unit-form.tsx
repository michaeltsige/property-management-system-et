'use client';
import { useState } from 'react';
import { unitLabels } from '@pms/shared';
import { api } from '@/lib/api';
import type { Property } from '@/lib/types';
import { useAction } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { MoneyInput } from './form-controls';
import { Alert, Button, Input, Label, Select } from './ui';

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
  const [typeLabel, setTypeLabel] = useState('');
  const [marketRent, setMarketRent] = useState<number | null>(null);
  const { pending, error, run } = useAction();
  let labels: string[] = [];
  try {
    labels = unitLabels({ pattern, start, count, padding });
  } catch {
    /* Invalid preview disables submit. */
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!labels.length) return;
        void run(async () => {
          const currency = (session?.organization?.currency as string | undefined) ?? 'ETB';
          const result = await api.bulkUnits({
            propertyId,
            buildingId: buildingId || null,
            naming: { pattern, start, count, padding },
            typeLabel: typeLabel.trim() || undefined,
            marketRent: marketRent === null ? undefined : { amountMinor: marketRent, currency },
          });
          onSaved(result.count);
        }).catch(() => undefined);
      }}
    >
      <p className="text-sm text-slate-600">{t('bulk.hint')}</p>
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
        <option value="">—</option>
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
          <Label htmlFor="bulk-count">{t('bulk.count')}</Label>
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
        <Label htmlFor="bulk-type">{t('bulk.type_label')}</Label>
        <Input
          id="bulk-type"
          maxLength={60}
          value={typeLabel}
          onChange={(e) => setTypeLabel(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-slate-500">{t('bulk.type_hint')}</p>
      </div>
      <MoneyInput label={t('bulk.market_rent_optional')} value={marketRent} onChange={setMarketRent} />
      <p className="break-words text-sm" aria-live="polite">
        {t('bulk.preview')}:{' '}
        {labels.length
          ? `${labels.slice(0, 5).join(', ')}${labels.length > 5 ? ` … ${labels.at(-1)}` : ''}`
          : t('bulk.invalid')}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={pending || !propertyId || !labels.length}>
        {pending ? t('app.loading') : t('bulk.create')}
      </Button>
    </form>
  );
}
