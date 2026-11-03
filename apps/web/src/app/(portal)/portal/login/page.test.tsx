import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import PortalLoginPage from '@/app/(portal)/portal/login/page';
import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: context.replace }) }));
vi.mock('@/lib/preferences', () => ({
  // The door language picker needs the real catalog labels and the setter.
  LANGUAGES: [
    { code: 'en', label: 'English', english: 'English' },
    { code: 'am', label: 'አማርኛ', english: 'Amharic' },
    { code: 'om', label: 'Afaan Oromoo', english: 'Afaan Oromo' },
    { code: 'ti', label: 'ትግርኛ', english: 'Tigrinya' },
  ],
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG, values?: Record<string, string | number>) => {
      const template = EN_CATALOG[key] ?? (key as string);
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
    },
    signIn: context.signIn,
    language: 'en',
    setLanguage: () => undefined,
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { portalRequestCode: vi.fn(), portalVerify: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tenant portal login', () => {
  it('asks for a phone number first, then for the code with a 60s resend countdown', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    expect(screen.getByText(EN_CATALOG['portal.title'])).toBeDefined();
    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));

    expect(api.portalRequestCode).toHaveBeenCalledWith({ phone: '0911234567' });
    expect(await screen.findByText(EN_CATALOG['portal.code_sent'])).toBeDefined();
    // The countdown replaces the vague "you already asked recently" message:
    // the resend button starts disabled and names the seconds.
    const resend = screen.getByRole('button', {
      name: EN_CATALOG['auth.resend_in'].replace('{seconds}', '60'),
    });
    expect((resend as HTMLButtonElement).disabled).toBe(true);
  });

  it('signs the tenant in with the verified code', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    vi.mocked(api.portalVerify).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'portal-t1@tenants.invalid',
        fullName: 'Tenant One',
        language: 'en',
        calendar: 'ethiopian',
      },
      organization: {
        id: 'org-1',
        name: 'Bole Demo',
        slug: 'bole-demo',
        currency: 'ETB',
        calendar: 'ethiopian',
        language: 'en',
      },
      role: 'tenant',
      memberships: [],
      tenant: { id: 'tenant-1', fullName: 'Tenant One' },
    });
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));
    await user.type(await screen.findByLabelText(EN_CATALOG['portal.code']), '123456');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.verify'] }));

    expect(api.portalVerify).toHaveBeenCalledWith({ phone: '0911234567', code: '123456' });
    expect(context.signIn).toHaveBeenCalledWith(expect.objectContaining({ role: 'tenant' }));
    expect(context.replace).toHaveBeenCalledWith('/portal');
  });

  it('says only the code is wrong (never "email or code")', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    vi.mocked(api.portalVerify).mockRejectedValue(
      new ApiError(401, 'UNAUTHENTICATED', 'The code is incorrect'),
    );
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));
    await user.type(await screen.findByLabelText(EN_CATALOG['portal.code']), '000000');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.verify'] }));

    expect(await screen.findByText(EN_CATALOG['auth.code_incorrect'])).toBeDefined();
    expect(context.signIn).not.toHaveBeenCalled();
  });

  it('maps an expired-code answer to the expired message', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    vi.mocked(api.portalVerify).mockRejectedValue(
      new ApiError(401, 'UNAUTHENTICATED', 'This code has expired. Request a new one.'),
    );
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));
    await user.type(await screen.findByLabelText(EN_CATALOG['portal.code']), '999999');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.verify'] }));

    expect(await screen.findByText(EN_CATALOG['auth.code_expired'])).toBeDefined();
  });

  it('treats a mid-cooldown 429 as a countdown, not a message', async () => {
    vi.mocked(api.portalRequestCode).mockRejectedValueOnce(
      new ApiError(429, 'RATE_LIMITED', 'A code was requested recently', {
        retryAfterSeconds: 42,
      }),
    );
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));

    // Straight to the code step with the server's remaining seconds on the clock.
    expect(await screen.findByText(EN_CATALOG['portal.code_sent'])).toBeDefined();
    expect(
      screen.getByRole('button', { name: EN_CATALOG['auth.resend_in'].replace('{seconds}', '42') }),
    ).toBeDefined();
  });
});
