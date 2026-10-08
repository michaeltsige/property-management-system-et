import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import { PaymentGatewaySettings } from '@/components/payment-gateway-settings';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import type { PaymentGatewayStatus } from '@pms/shared';

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
    api: {
      ...original.api,
      paymentGateway: vi.fn(),
      updatePaymentGateway: vi.fn(),
      resetPaymentGateway: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const platformMock: PaymentGatewayStatus = {
  provider: 'mock',
  source: 'platform',
  mode: null,
  configured: true,
  missing: [],
  credentials: {},
};

const savedChapa: PaymentGatewayStatus = {
  provider: 'chapa',
  source: 'organization',
  mode: 'test',
  configured: true,
  missing: [],
  credentials: {
    secretKey: { configured: true, hint: '••••b77b' },
    webhookSecret: { configured: true, hint: '••••bb22' },
  },
};

describe('payment gateway settings card', () => {
  it('shows the demo note on the platform default and saves typed credentials only', async () => {
    vi.mocked(api.paymentGateway).mockResolvedValue({ gateway: platformMock });
    vi.mocked(api.updatePaymentGateway).mockResolvedValue({ gateway: savedChapa });
    const user = userEvent.setup();
    render(<PaymentGatewaySettings />);

    // The demo path is explicit: simulated checkout, no real money.
    expect(await screen.findByText(EN_CATALOG['org.gateway_demo_note'])).toBeTruthy();
    expect(screen.getByText(EN_CATALOG['org.gateway_platform_source'])).toBeTruthy();

    // Switch to Chapa: its credential fields appear (labels from the catalog).
    await user.selectOptions(screen.getByLabelText(EN_CATALOG['org.gateway_provider']), 'chapa');
    await user.type(screen.getByLabelText(EN_CATALOG['org.gateway_field_secret_key']), 'sk_test_123');
    await user.type(screen.getByLabelText(EN_CATALOG['org.gateway_field_webhook_secret']), 'whsec_9');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['common.save'] }));

    expect(api.updatePaymentGateway).toHaveBeenCalledWith({
      provider: 'chapa',
      mode: 'test',
      credentials: { secretKey: 'sk_test_123', webhookSecret: 'whsec_9' },
    });
  });

  it('shows saved values as hints and omits untouched fields when saving', async () => {
    vi.mocked(api.paymentGateway).mockResolvedValue({ gateway: savedChapa });
    vi.mocked(api.updatePaymentGateway).mockResolvedValue({ gateway: savedChapa });
    const user = userEvent.setup();
    render(<PaymentGatewaySettings />);

    const secretInput = (await screen.findByLabelText(
      EN_CATALOG['org.gateway_field_secret_key'],
    )) as HTMLInputElement;
    expect(secretInput.placeholder).toBe('••••b77b');

    // Saving without retyping anything keeps every stored credential.
    await user.click(screen.getByRole('button', { name: EN_CATALOG['common.save'] }));
    expect(api.updatePaymentGateway).toHaveBeenCalledWith({
      provider: 'chapa',
      mode: 'test',
      credentials: {},
    });
  });

  it('resets an organization configuration back to the platform default', async () => {
    vi.mocked(api.paymentGateway).mockResolvedValue({ gateway: savedChapa });
    vi.mocked(api.resetPaymentGateway).mockResolvedValue({ gateway: platformMock });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<PaymentGatewaySettings />);

    await user.click(await screen.findByRole('button', { name: EN_CATALOG['org.gateway_reset'] }));
    expect(api.resetPaymentGateway).toHaveBeenCalledTimes(1);
  });
});
