'use client';

/**
 * Staff review queue for tenant-submitted proofs of payment, in three tabs:
 * pending / approved / rejected. Approving records the payment server-side
 * (single transaction — a proof cannot be approved twice) with the amount
 * staff actually received: a tenant who paid half the rent gets a partial
 * approval, and the remainder stays due.
 */

import { useState } from 'react';

import { PAYMENT_PROOF_STATUSES } from '@pms/shared';

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
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { Modal } from '@/components/modal';
import { MoneyInput } from '@/components/form-controls';
import { cn } from '@/lib/utils';

type ProofTab = (typeof PAYMENT_PROOF_STATUSES)[number];

export function PaymentProofsReview({ onChanged }: { onChanged?: () => void }) {
  const { t, language, calendar } = usePreferences();
  const [tab, setTab] = useState<ProofTab>('pending');
  const proofs = useAsync(() => api.paymentProofs(`?status=${tab}&pageSize=50`), [tab]);
  // The pending count is the number staff act on; the other tabs are archives.
  const pendingCount = useAsync(() => api.paymentProofs('?status=pending&pageSize=1'), []);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveTarget, setApproveTarget] = useState<string | null>(null);
  const [approveAmount, setApproveAmount] = useState<number | null>(null);
  const [approveNotes, setApproveNotes] = useState('');
  const { pending, error, message, setMessage, run } = useAction();

  function openApprove(proofId: string) {
    const proof = (proofs.data?.items ?? []).find((item) => item.id === proofId);
    setApproveAmount(proof ? Number(proof.amountMinor) : null);
    setApproveNotes('');
    setApproveTarget(proofId);
  }

  async function approve() {
    if (!approveTarget) return;
    const proof = (proofs.data?.items ?? []).find((item) => item.id === approveTarget);
    if (!proof) return;
    await run(async () => {
      const result = await api.approvePaymentProof(approveTarget, {
        amount: { amountMinor: approveAmount ?? Number(proof.amountMinor), currency: proof.currency },
        notes: approveNotes || undefined,
      });
      setMessage(t('payment.proof_approved', { receipt: result.payment.receiptNumber }));
      setApproveTarget(null);
      proofs.reload();
      pendingCount.reload();
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
      pendingCount.reload();
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
        <div className="border-b border-slate-200 px-4 pt-3">
          <p className="pb-3 text-sm font-medium text-slate-900">{t('payment.proof_review_title')}</p>
          <div role="tablist" aria-label={t('payment.proof_review_title')} className="flex gap-1">
            {PAYMENT_PROOF_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={tab === status}
                onClick={() => setTab(status)}
                className={cn(
                  'rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors',
                  tab === status
                    ? 'border-brand-600 font-medium text-brand-800'
                    : 'border-transparent text-slate-500 hover:text-slate-700',
                )}
              >
                {t(`payment.proof_status.${status}` as never)}
                {status === 'pending' && (pendingCount.data?.total ?? 0) > 0 ? (
                  <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white tabular">
                    {pendingCount.data?.total}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
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
                {tab !== 'pending' ? <Th>{t('payment.proof_reviewed_at')}</Th> : <Th />}
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((proof) => {
                const partial =
                  proof.approvedAmountMinor !== null && proof.approvedAmountMinor !== proof.amountMinor;
                return (
                  <tr key={proof.id}>
                    <Td className="font-medium text-slate-900">{proof.tenant?.fullName ?? '—'}</Td>
                    <Td className="tabular">
                      {proof.approvedAmountMinor !== null ? (
                        partial ? (
                          <span title={`${proof.amountMinor} claimed`}>
                            {formatAmount(proof.approvedAmountMinor, proof.currency, language)}
                            <span className="ml-1 text-xs text-slate-400">
                              {t('payment.proof_approved_of_claimed', {
                                claimed: formatAmount(proof.amountMinor, proof.currency, language),
                              })}
                            </span>
                          </span>
                        ) : (
                          formatAmount(proof.approvedAmountMinor, proof.currency, language)
                        )
                      ) : (
                        formatAmount(proof.amountMinor, proof.currency, language)
                      )}
                    </Td>
                    <Td>{t(`payment.method.${proof.method}` as never)}</Td>
                    <Td>{proof.reference ?? '—'}</Td>
                    <Td>{formatDate(proof.createdAt, { language, calendar })}</Td>
                    {tab !== 'pending' ? (
                      <Td>
                        <div className="space-y-0.5">
                          <span>{proof.reviewedAt ? formatDate(proof.reviewedAt, { language, calendar }) : '—'}</span>
                          {proof.reviewNotes ? (
                            <p className="max-w-52 truncate text-xs text-slate-500" title={proof.reviewNotes}>
                              {proof.reviewNotes}
                            </p>
                          ) : null}
                        </div>
                      </Td>
                    ) : (
                      <Td />
                    )}
                    <Td>
                      <div className="flex justify-end gap-1">
                        {tab === 'pending' ? (
                          <>
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
                            <Button size="sm" disabled={pending} onClick={() => openApprove(proof.id)}>
                              {t('payment.proof_approve')}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Badge tone={proof.status === 'approved' ? 'brand' : 'danger'}>
                              {t(`payment.proof_status.${proof.status}` as never)}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void download(proof.documentId, proof.document?.filename ?? 'proof')}
                            >
                              {t('payment.proof_download')}
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardContent>

      {/* Approve with the amount actually received (partial approval supported). */}
      <Modal
        open={approveTarget !== null}
        onOpenChange={(value) => (value ? undefined : setApproveTarget(null))}
        title={t('payment.proof_approve')}
        description={
          approveTarget
            ? `${t('payment.proof_claimed')}: ${
                (() => {
                  const proof = (proofs.data?.items ?? []).find((item) => item.id === approveTarget);
                  return proof ? formatAmount(proof.amountMinor, proof.currency, language) : '—';
                })()
              }`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={pending || approveAmount === null || approveAmount <= 0} onClick={() => void approve()}>
              {pending ? t('app.loading') : t('payment.proof_approve')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <MoneyInput
            label={t('payment.proof_partial_amount')}
            value={approveAmount}
            onChange={setApproveAmount}
          />
          <p className="text-[11px] text-slate-500">{t('payment.proof_partial_hint')}</p>
          <div className="space-y-1">
            <Label htmlFor="approve-notes">{t('payment.proof_approval_notes')}</Label>
            <Input
              id="approve-notes"
              value={approveNotes}
              onChange={(event) => setApproveNotes(event.target.value)}
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>

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
