import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import ChapaSandboxCheckoutPage from '@/app/(portal)/portal/pay/chapa/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({
  replace: vi.fn(),
  get: vi.fn<(name: string) => string | null>(() => 'PMS-6f1c2a90b3'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: context.replace }),
  useSearchParams: () => ({ get: context.get }),
}));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG, vars?: Record<string, string>) => {
      const text = EN_CATALOG[key] ?? key;
      return vars
        ? text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`)
        : text;
    },
    session: {
      role: 'tenant',
      user: { id: 'user-1', fullName: 'Tenant One', email: 't@t.invalid', language: 'en', calendar: 'ethiopian' },
      organization: {
        id: 'org-1',
        name: 'Bole Demo',
        slug: 'bole-demo',
        currency: 'ETB',
        calendar: 'ethiopian',
        language: 'en',
      },
    },
    ready: true,
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, portalPaymentIntent: vi.fn(), portalCompletePayment: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Realistic mock: the sandbox sim lands with `tx_ref` (and never `trx_ref`);
  // a real Chapa return lands with `trx_ref` (and never `tx_ref`). Returning
  // the same value for every param would make `isRealChapaReturn` misfire.
  context.get.mockImplementation((name: string) =>
    name === 'tx_ref' ? 'PMS-6f1c2a90b3' : null,
  );
});

describe('chapa sandbox checkout page', () => {
  it('shows the sandbox attempt and completes it through the API', async () => {
    vi.mocked(api.portalPaymentIntent).mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'chapa',
      providerRef: 'PMS-6f1c2a90b3',
      amountMinor: '1500000',
      currency: 'ETB',
      status: 'pending',
    });
    vi.mocked(api.portalCompletePayment).mockResolvedValue({
      paymentId: 'pay-1',
      receiptNumber: 'RCT-2019-000002',
      amountMinor: '1500000',
      currency: 'ETB',
      allocatedMinor: '1500000',
      unallocatedMinor: '0',
      allocations: [],
      status: 'succeeded',
    });
    const user = userEvent.setup();
    render(<ChapaSandboxCheckoutPage />);

    expect(await screen.findByText(EN_CATALOG['portal.chapa_hint'])).toBeDefined();
    expect(screen.getByText(EN_CATALOG['org.gateway_mode_test'])).toBeDefined();

    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.chapa_confirm'] }));

    expect(api.portalCompletePayment).toHaveBeenCalledWith('PMS-6f1c2a90b3');
    expect(await screen.findByText('Receipt RCT-2019-000002')).toBeDefined();
    expect(screen.getByRole('link', { name: EN_CATALOG['portal.back_to_portal'] })).toBeDefined();
  });

  it('also accepts the trx_ref param live Chapa appends on the return redirect', async () => {
    context.get.mockImplementation((name: string) => (name === 'trx_ref' ? 'PMS-9b8a7c6d5e' : null));
    vi.mocked(api.portalPaymentIntent).mockResolvedValue({
      paymentId: 'pay-2',
      provider: 'chapa',
      providerRef: 'PMS-9b8a7c6d5e',
      amountMinor: '1500000',
      currency: 'ETB',
      status: 'succeeded',
    });
    render(<ChapaSandboxCheckoutPage />);

    expect(await screen.findByText(EN_CATALOG['portal.payment_success'])).toBeDefined();
    expect(api.portalPaymentIntent).toHaveBeenCalledWith('PMS-9b8a7c6d5e');
  });

  it('shows a missing reference as an error instead of a checkout', async () => {
    context.get.mockReturnValue(null);
    render(<ChapaSandboxCheckoutPage />);

    // The client-side rejection is translated like every other user-facing string.
    expect(await screen.findByText(EN_CATALOG['portal.payment_not_found'])).toBeDefined();
  });
});
