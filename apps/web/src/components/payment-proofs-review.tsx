'use client';

/**
 * Staff review queue for tenant-submitted proofs of payment. Approving records
 * the payment server-side (single transaction — a proof cannot be approved
 * twice); rejecting asks for a reason the tenant will see.
 */

import { useState } from 'react';

import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import {
  Alert,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { Modal } from '@/components/modal';

export function PaymentProofsReview({ onChanged }: { onChanged?: () => void }) {
  const { t, language, calendar } = usePreferences();
  const proofs = useAsync(() => api.paymentProofs('?status=pending&pageSize=50'), []);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { pending, error, message, setMessage, run } = useAction();

  async function approve(proofId: string) {
    await run(async () => {
      const result = await api.approvePaymentProof(proofId);
      setMessage(t('payment.proof_approved', { receipt: result.payment.receiptNumber }));
      proofs.reload();
      onChanged?.();
    }).catch(() => undefined);
  }

  async function reject() {
    if (!rejectTarget) return;
    await run(async () => {
      await api.rejectPaymentProof(rejectTarget, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
      setMessage(t('payment.proof_rejected'));
      proofs.reload();
    }).catch(() => undefined);
  }

  async function download(documentId: string, filename: string) {
    const response = await fetch(`/api/v1/documents/${documentId}/download`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const rows = proofs.data?.items ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
          {t('payment.proof_review_title')}
        </div>

        {message ? (
          <div className="p-4">
            <Alert tone="success">{message}</Alert>
          </div>
        ) : null}
        {error ? (
          <div className="p-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        {proofs.loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('payment.proof_empty')} description={t('payment.proof_hint')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('nav.tenants')}</Th>
                <Th>{t('money.amount')}</Th>
                <Th>{t('money.method')}</Th>
                <Th>{t('payment.reference')}</Th>
                <Th>{t('payment.proof_submitted_at')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((proof) => (
                <tr key={proof.id}>
                  <Td className="font-medium text-slate-900">{proof.tenant?.fullName ?? '—'}</Td>
                  <Td className="tabular">
                    {formatAmount(proof.amountMinor, proof.currency, language)}
                  </Td>
                  <Td>{t(`payment.method.${proof.method}` as never)}</Td>
                  <Td>{proof.reference ?? '—'}</Td>
                  <Td>{formatDate(proof.createdAt, { language, calendar })}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void download(proof.documentId, proof.document?.filename ?? 'proof')}
                      >
                        {t('payment.proof_download')}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setRejectTarget(proof.id)}>
                        {t('payment.proof_reject')}
                      </Button>
                      <Button size="sm" disabled={pending} onClick={() => void approve(proof.id)}>
                        {t('payment.proof_approve')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>

      <Modal
        open={rejectTarget !== null}
        onOpenChange={(value) => (value ? undefined : setRejectTarget(null))}
        title={t('payment.proof_reject')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || rejectReason.trim().length < 3}
              onClick={() => void reject()}
            >
              {pending ? t('app.loading') : t('payment.proof_reject')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="reject-reason">{t('payment.proof_reject_reason')}</Label>
          <Input
            id="reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
        </div>
      </Modal>
    </Card>
  );
}
