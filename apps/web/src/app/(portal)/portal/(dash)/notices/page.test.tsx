import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import NoticesPage from '@/app/(portal)/portal/(dash)/notices/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/portal/notices',
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
    language: 'en',
    calendar: 'ethiopian',
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, portalNotices: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('portal notices page', () => {
  it('renders close-out notices with flat payloads through the catalog', async () => {
    vi.mocked(api.portalNotices).mockResolvedValue({
      items: [
        {
          id: 'n1',
          templateKey: 'notification.work_order_completed',
          payload: { title: 'Leaking sink', ticketNumber: 'WO-2026-0007' },
          createdAt: '2026-10-20T09:00:00.000Z',
          status: 'sent',
        },
      ],
    });
    render(<NoticesPage />);

    // Interpolated from the stored flat payload, not a raw template key.
    expect(
      await screen.findByText('Maintenance request WO-2026-0007 is completed: Leaking sink'),
    ).toBeDefined();
  });

  it('unwraps the legacy { values } payload staff notifications store', async () => {
    vi.mocked(api.portalNotices).mockResolvedValue({
      items: [
        {
          id: 'n2',
          templateKey: 'notification.rent_due_soon',
          payload: { values: { amount: 'Br 4,500.00', dueDate: '2026-10-05' }, renderedStatus: 'en' },
          createdAt: '2026-10-01T09:00:00.000Z',
          status: 'sent',
        },
      ],
    });
    render(<NoticesPage />);

    expect(
      await screen.findByText('Rent of Br 4,500.00 is due on 2026-10-05'),
    ).toBeDefined();
  });

  it('shows a load failure with a retry instead of a silent empty state', async () => {
    vi.mocked(api.portalNotices).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<NoticesPage />);

    expect(await screen.findByText(/This page could not load\./)).toBeDefined();
    expect(screen.getByRole('button', { name: EN_CATALOG['common.retry'] })).toBeDefined();

    vi.mocked(api.portalNotices).mockResolvedValue({ items: [] });
    await user.click(screen.getByRole('button', { name: EN_CATALOG['common.retry'] }));

    expect(await screen.findByText(EN_CATALOG['portal.notices_empty'])).toBeDefined();
  });
});
