'use client';

/**
 * Portal "Pay by transfer" section: the tenant uploads a bank slip or cheque
 * photo for the landlord to review. Approving the proof is the landlord's
 * action — until then the proof shows as pending, and a rejection explains why.
 */

import { useRef, useState } from 'react';

import { ALLOWED_UPLOAD_MIME_TYPES, MANUAL_PAYMENT_METHODS } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

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
} from '@/components/ui';
import { MoneyInput } from '@/components/form-controls';

export function PortalPaymentProofs({ currency }: { currency: string }) {
  const { t, language, calendar } = usePreferences();
  const proofs = useAsync(() => api.portalPaymentProofs(), []);
  const [method, setMethod] = useState<string>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [file, setFile] = useState<{ name: string; mimeType: string; dataBase64: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useAction();

  function pickFile(selected: File | null) {
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(selected.type)) {
      setFileError(t('payment.proof_bad_file'));
      setFile(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = String(reader.result ?? '').split(',')[1] ?? '';
      setFile({ name: selected.name, mimeType: selected.type, dataBase64 });
    };
    reader.readAsDataURL(selected);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    await run(async () => {
      await api.uploadPortalPaymentProof({
        amount: { amountMinor: amount ?? 0, currency },
        method,
        reference: reference || undefined,
        notes: notes || undefined,
        filename: file.name,
        mimeType: file.mimeType,
        dataBase64: file.dataBase64,
      });
      setAmount(null);
      setReference('');
      setNotes('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      proofs.reload();
    }).catch(() => undefined);
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
          {t('payment.proof_title')}
        </div>

        <form className="space-y-2 px-4 py-3" onSubmit={submit}>
          <p className="text-xs text-slate-500">{t('payment.proof_hint')}</p>
          <MoneyInput label={t('money.amount')} value={amount} onChange={setAmount} required />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="proof-method">{t('money.method')}</Label>
              <Select id="proof-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {MANUAL_PAYMENT_METHODS.map((option) => (
                  <option key={option} value={option}>
                    {t(`payment.method.${option}` as never)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="proof-reference">{t('payment.reference')}</Label>
              <Input
                id="proof-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder={t('payment.reference_placeholder')}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-file">{t('payment.proof_file')}</Label>
            <Input
              id="proof-file"
              ref={fileInput}
              type="file"
              required
              accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
              onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-notes">{t('maintenance.description')}</Label>
            <Input
              id="proof-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('payment.proof_notes_hint')}
            />
          </div>
          {fileError ? <Alert tone="danger">{fileError}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" disabled={pending || !file || amount === null}>
            {pending ? t('app.loading') : t('payment.proof_upload')}
          </Button>
        </form>

        <div className="border-t border-slate-200">
          {proofs.loading ? null : proofs.error ? (
            <div className="p-4">
              <Alert tone="danger">{proofs.error}</Alert>
            </div>
          ) : (proofs.data?.items.length ?? 0) === 0 ? (
            <div className="p-4">
              <EmptyState title={t('payment.proof_empty')} description="" />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(proofs.data?.items ?? []).map((proof) => (
                <li key={proof.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium tabular text-slate-900">
                      {formatAmount(proof.amountMinor, proof.currency, language)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {t(`payment.method.${proof.method}` as never)}
                      {proof.reference ? ` · ${proof.reference}` : ''}
                      {' · '}
                      {formatDate(proof.createdAt, { language, calendar })}
                    </p>
                    {proof.status === 'rejected' && proof.reviewNotes ? (
                      <p className="mt-1 text-[11px] text-red-700">{proof.reviewNotes}</p>
                    ) : null}
                  </div>
                  <Badge
                    tone={
                      proof.status === 'approved'
                        ? 'brand'
                        : proof.status === 'rejected'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {t(`payment.proof_status.${proof.status}` as never)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
