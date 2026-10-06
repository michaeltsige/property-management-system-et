import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import PortalLoginPage from '@/app/(portal)/portal/login/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: context.replace }) }));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    signIn: context.signIn,
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
  it('asks for a phone number first, then for the code', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    expect(screen.getByText(EN_CATALOG['portal.title'])).toBeDefined();
    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));

    expect(api.portalRequestCode).toHaveBeenCalledWith({ phone: '0911234567' });
    expect(await screen.findByText(EN_CATALOG['portal.code_sent'])).toBeDefined();
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

  it('shows the API error for a wrong code', async () => {
    vi.mocked(api.portalRequestCode).mockResolvedValue({ ok: true });
    vi.mocked(api.portalVerify).mockRejectedValue(new Error('Email or code is incorrect'));
    const user = userEvent.setup();
    render(<PortalLoginPage />);

    await user.type(screen.getByLabelText(EN_CATALOG['portal.phone']), '0911234567');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.send_code'] }));
    await user.type(await screen.findByLabelText(EN_CATALOG['portal.code']), '000000');
    await user.click(screen.getByRole('button', { name: EN_CATALOG['portal.verify'] }));

    expect(await screen.findByText('Email or code is incorrect')).toBeDefined();
    expect(context.signIn).not.toHaveBeenCalled();
  });
});
