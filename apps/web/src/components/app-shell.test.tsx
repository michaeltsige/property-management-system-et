import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as apiModule from '@/lib/api';

import { AppShell } from '@/components/app-shell';

// The shell now mounts the task panel, global search and property switcher,
// which would otherwise hit the network in every shell test.
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof apiModule>();
  return {
    ...original,
    api: {
      ...original.api,
      charges: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      workOrders: vi.fn(() => Promise.resolve({ items: [], total: 0, openCount: 0, urgentCount: 0 })),
      arrears: vi.fn(() =>
        Promise.resolve({ rows: [], buckets: [], totalMinor: '0', currency: 'ETB', asOf: '' }),
      ),
      properties: vi.fn(() => Promise.resolve({ properties: [] })),
      units: vi.fn(() => Promise.resolve({ units: [] })),
      tenants: vi.fn(() => Promise.resolve({ tenants: [] })),
    },
  };
});
import { PreferencesProvider } from '@/lib/preferences';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const SESSION = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: 'user-1',
    email: 'owner@demo.test',
    fullName: 'Demo Owner',
    language: 'en',
    calendar: 'ethiopian',
  },
  organization: {
    id: 'org-1',
    name: 'Bole Demo Property Management',
    slug: 'bole-demo',
    currency: 'ETB',
    calendar: 'ethiopian',
    language: 'en',
  },
  role: 'owner_admin',
};

function renderShell() {
  return render(
    <PreferencesProvider>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('pms.session.v1', JSON.stringify(SESSION));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')));
});

describe('AppShell', () => {
  it('offers a skip link that targets the main landmark', async () => {
    renderShell();
    await screen.findByText('page content');

    const skip = screen.getByRole('link', { name: /skip to content/i });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('marks the current page for assistive technology', async () => {
    renderShell();
    await screen.findByText('page content');

    // Dashboard appears twice now (sidebar + workspace tab); both mark the page.
    const dashboards = screen.getAllByRole('link', { name: 'Dashboard' });
    expect(dashboards.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(screen.getByRole('link', { name: 'Properties' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the navigation reachable on a phone through a drawer', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText('page content');

    // Closed by default: no drawer in the accessibility tree at all.
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Tenants' })).toHaveLength(1);

    await user.click(menuButton);

    // The drawer carries the full navigation, its own labelled controls and a
    // way to close it.
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('link', { name: 'Tenants' })).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(drawer).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Language')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('names every icon-only control', async () => {
    renderShell();
    await screen.findByText('page content');

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows the organization it is serving', async () => {
    renderShell();
    await screen.findByText('page content');

    const sidebar = screen.getAllByText('Bole Demo Property Management')[0];
    expect(sidebar).toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByText('Bole Demo Property Management')).toBeNull();
  });
});

it('uses Amharic script for the top-bar month when language is Amharic', async () => {
  const { todayIn, monthName } = await import('@pms/calendar');
  window.localStorage.setItem(
    'pms.session.v1',
    JSON.stringify({ ...SESSION, user: { ...SESSION.user, language: 'am' } }),
  );
  renderShell();
  await screen.findByText('page content');
  const today = todayIn('ethiopian');
  expect(screen.getByText(`${monthName(today, 'am')} ${today.year}`)).toBeInTheDocument();
  expect(screen.queryByText(`${monthName(today, 'en')} ${today.year}`)).not.toBeInTheDocument();
});
