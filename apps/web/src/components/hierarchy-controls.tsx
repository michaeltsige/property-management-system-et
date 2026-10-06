'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import type { Owner, Building } from '@/lib/types';
import { Alert, Button, Input, Label } from '@/components/ui';

/** Decimal percent text to integer basis points, without floating-point arithmetic. */
export function feeToBps(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) throw new Error('invalid fee');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result > 10000) throw new Error('invalid fee');
  return result;
}
export function feeText(bps: number | null): string {
  return bps === null ? '' : `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
}

export function OwnerEditor({ owner, onSaved }: { owner?: Owner; onSaved: () => void }) {
  const { t } = usePreferences();
  const [name, setName] = useState(owner?.name ?? '');
  const [phone, setPhone] = useState(owner?.phone ?? '');
  const [email, setEmail] = useState(owner?.email ?? '');
  const [fee, setFee] = useState(feeText(owner?.managementFeeBps ?? null));
  const { pending, error, run } = useAction();
  const prefix = `owner-${owner?.id ?? 'new'}`;
  return (
    <form
      className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          let managementFeeBps: number | null;
          try {
            managementFeeBps = feeToBps(fee);
          } catch {
            throw new Error(t('portfolio.fee_invalid'));
          }
          const body = { name, phone: phone || null, email: email || null, managementFeeBps };
          if (owner) await api.updateOwner(owner.id, body);
          else await api.createOwner(body);
          if (!owner) {
            setName('');
            setPhone('');
            setEmail('');
            setFee('');
          }
          onSaved();
        }).catch(() => undefined);
      }}
    >
      <div>
        <Label htmlFor={`${prefix}-name`}>{t('portfolio.owner_name')}</Label>
        <Input
          id={`${prefix}-name`}
          value={name}
          required
          minLength={2}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-phone`}>{t('tenant.phone')}</Label>
        <Input id={`${prefix}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-email`}>{t('auth.email')}</Label>
        <Input id={`${prefix}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-fee`}>{t('portfolio.fee')}</Label>
        <Input
          id={`${prefix}-fee`}
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          aria-describedby={`${prefix}-hint`}
        />
        <p id={`${prefix}-hint`} className="text-xs text-slate-500">
          {t('portfolio.fee_hint')}
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? t('app.loading') : t('common.save')}
      </Button>
    </form>
  );
}

export function BlockEditor({
  propertyId,
  block,
  onSaved,
}: {
  propertyId: string;
  block?: Building;
  onSaved: () => void;
}) {
  const { t } = usePreferences();
  const [name, setName] = useState(block?.name ?? '');
  const { pending, error, run } = useAction();
  const id = `block-${block?.id ?? propertyId}`;
  return (
    <form
      className="space-y-2 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (block) await api.updateBuilding(block.id, { name });
          else await api.createBuilding({ propertyId, name });
          if (!block) setName('');
          onSaved();
        }).catch(() => undefined);
      }}
    >
      <Label htmlFor={id}>{t('portfolio.block_name')}</Label>
      <div className="flex gap-2">
        <Input id={id} value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={pending}>
          {block ? t('common.save') : t('portfolio.add_block')}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
