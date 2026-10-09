import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import { PortalPaymentProofs } from '@/components/portal-proofs';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    language: 'en',
    calendar: 'ethiopian',
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    api: { ...original.api, uploadPortalPaymentProof: vi.fn(), portalPaymentProofs: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.portalPaymentProofs).mockResolvedValue({ items: [] });
});

const pngFile = new File(['proof-bytes'], 'slip.png', { type: 'image/png' });

describe('portal payment proofs section', () => {
  it('uploads a slip with amount, method and reference', async () => {
    vi.mocked(api.uploadPortalPaymentProof).mockResolvedValue({
      proof: {
        id: 'proof-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        leaseId: null,
        documentId: 'doc-1',
        amountMinor: '1500000',
        currency: 'ETB',
        method: 'bank_transfer',
        reference: null,
        notes: null,
        status: 'pending',
        reviewedAt: null,
        reviewNotes: null,
        paymentId: null,
        createdAt: new Date().toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<PortalPaymentProofs currency="ETB" />);

    // Amount: MoneyInput renders the label as "Amount *"; type a plain integer.
    const amountInput = screen.getByLabelText(/Amount/);
    await user.type(amountInput, '15000');
    await user.click(screen.getByLabelText(EN_CATALOG['money.method']));
    await user.click(await screen.findByRole('option', { name: 'Bank transfer' }));
    await user.type(screen.getByLabelText(EN_CATALOG['payment.reference']), 'CBE-99881');
    await user.upload(screen.getByLabelText(EN_CATALOG['payment.proof_file']), pngFile);

    // The submit button stays disabled until the FileReader produces the base64.
    const submit = screen.getByRole('button', { name: EN_CATALOG['payment.proof_upload'] });
    await vi.waitFor(() => expect(submit).toBeEnabled());
    // jsdom does not always wire submit-button clicks to the form; submitting
    // the form directly exercises the same handler the browser would run.
    fireEvent.submit(submit.closest('form')!);

    expect(api.uploadPortalPaymentProof).toHaveBeenCalledTimes(1);
    const body = vi.mocked(api.uploadPortalPaymentProof).mock.calls[0]![0] as {
      amount: { amountMinor: number; currency: string };
      method: string;
      reference: string;
      filename: string;
      mimeType: string;
      dataBase64: string;
    };
    expect(body.amount).toEqual({ amountMinor: 1_500_000, currency: 'ETB' });
    expect(body.method).toBe('bank_transfer');
    expect(body.reference).toBe('CBE-99881');
    expect(body.filename).toBe('slip.png');
    expect(body.mimeType).toBe('image/png');
    expect(body.dataBase64.length).toBeGreaterThan(0);
  });

  it('shows the submitted proofs with their review status', async () => {
    vi.mocked(api.portalPaymentProofs).mockResolvedValue({
      items: [
        {
          id: 'proof-1',
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          leaseId: null,
          documentId: 'doc-1',
          amountMinor: '1500000',
          currency: 'ETB',
          method: 'bank_transfer',
          reference: 'CBE-99881',
          notes: null,
          status: 'approved',
          reviewedAt: new Date().toISOString(),
          reviewNotes: null,
          paymentId: 'pay-1',
          createdAt: '2026-10-08T09:00:00.000Z',
        },
      ],
    });
    render(<PortalPaymentProofs currency="ETB" />);

    expect(await screen.findByText(EN_CATALOG['payment.proof_status.approved'])).toBeDefined();
    // Scope to the proofs list: the method select's trigger and Radix's hidden
    // form bubble also carry the method label ("Bank transfer").
    const list = screen.getByRole('list');
    // The method label shares a <p> with the reference and date, so match
    // partially instead of exactly.
    expect(within(list).getByText(/Bank transfer/)).toBeDefined();
    expect(screen.getByText(/CBE-99881/)).toBeDefined();
  });
});
