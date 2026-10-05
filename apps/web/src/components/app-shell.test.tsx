import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/app-shell';
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

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
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
    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
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
