import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import MockCheckoutPage from '@/app/(portal)/portal/pay/mock/page';
import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({
  replace: vi.fn(),
  get: vi.fn<(name: string) => string | null>(() => 'MOCK-ref-1234'),
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
});

describe('mock checkout page', () => {
  it('shows the pending attempt and confirms it through the API', async () => {
    vi.mocked(api.portalPaymentIntent).mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'mock',
      providerRef: 'MOCK-ref-1234',
      amountMinor: '3000000',
      currency: 'ETB',
      status: 'pending',
    });
    vi.mocked(api.portalCompletePayment).mockResolvedValue({
      paymentId: 'pay-1',
      receiptNumber: 'RCT-2019-000001',
      amountMinor: '3000000',
      currency: 'ETB',
      allocatedMinor: '3000000',
      unallocatedMinor: '0',
      allocations: [],
      status: 'succeeded',
    });
    const user = userEvent.setup();
    render(<MockCheckoutPage />);

    expect(await screen.findByText(EN_CATALOG['portal.mock_hint'])).toBeDefined();
    expect(screen.getByText(EN_CATALOG['portal.mock_confirm'])).toBeDefined();

    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.mock_confirm'] }));

    expect(api.portalCompletePayment).toHaveBeenCalledWith('MOCK-ref-1234');
    expect(await screen.findByText('Receipt RCT-2019-000001')).toBeDefined();
    expect(screen.getByRole('link', { name: EN_CATALOG['portal.back_to_portal'] })).toBeDefined();
  });

  it('shows the API error when the completion is refused', async () => {
    vi.mocked(api.portalPaymentIntent).mockResolvedValue({
      paymentId: 'pay-1',
      provider: 'mock',
      providerRef: 'MOCK-ref-1234',
      amountMinor: '3000000',
      currency: 'ETB',
      status: 'pending',
    });
    vi.mocked(api.portalCompletePayment).mockRejectedValue(
      new ApiError(422, 'BUSINESS_RULE', 'The provider has not confirmed this payment yet'),
    );
    const user = userEvent.setup();
    render(<MockCheckoutPage />);

    await user.click(await screen.findByRole('button', { name: EN_CATALOG['portal.mock_confirm'] }));

    expect(await screen.findByText('The provider has not confirmed this payment yet')).toBeDefined();
  });

  it('shows a missing reference as an error instead of a checkout', async () => {
    context.get.mockReturnValue(null);
    vi.mocked(api.portalPaymentIntent).mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', 'Payment not found'),
    );
    render(<MockCheckoutPage />);

    expect(await screen.findByText('Payment not found')).toBeDefined();
  });
});
