import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import { WorkspaceTabs, isTabbedRoute } from '@/components/workspace-tabs';
import { MAX_TABS, closeWorkspaceTab, getWorkspaceTabs, openWorkspaceTab } from './workspace-tabs';

const navPush = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/units',
  useRouter: () => ({ push: navPush }),
}));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    session: { role: 'owner_admin' },
  }),
}));
vi.mock('@/lib/api', () => ({ api: { units: vi.fn(() => Promise.resolve({ units: [] })) } }));

beforeEach(() => {
  window.localStorage.clear();
  navPush.mockClear();
});

describe('workspace tab store', () => {
  it('opens, de-duplicates and bounds the tab list without reordering', () => {
    openWorkspaceTab('/dashboard');
    openWorkspaceTab('/units');
    // Re-opening an existing tab must not move it: order belongs to the user.
    openWorkspaceTab('/dashboard');
    expect(getWorkspaceTabs()).toEqual(['/dashboard', '/units']);
    for (let index = 0; index < MAX_TABS + 3; index += 1) openWorkspaceTab(`/properties?tab=${index}`);
    expect(getWorkspaceTabs().length).toBeLessThanOrEqual(MAX_TABS);
  });
  it('returns the neighbour when closing a middle tab', () => {
    openWorkspaceTab('/dashboard');
    openWorkspaceTab('/units');
    openWorkspaceTab('/leases');
    expect(closeWorkspaceTab('/units')).toBe('/leases');
    expect(closeWorkspaceTab('/nope')).toBeNull();
  });
  it('recognizes only workspace routes', () => {
    expect(isTabbedRoute('/units/abc-123')).toBe(true);
    expect(isTabbedRoute('/login')).toBe(false);
    expect(isTabbedRoute('/units/../../etc')).toBe(false);
  });
});

describe('WorkspaceTabs', () => {
  it('renders labels, marks the active tab and closes tabs', async () => {
    openWorkspaceTab('/dashboard');
    openWorkspaceTab('/units');
    const user = userEvent.setup();
    render(<WorkspaceTabs />);
    const tabs = screen.getByRole('navigation', { name: EN_CATALOG['tabs.label'] });
    expect(within(tabs).getByRole('link', { name: EN_CATALOG['nav.units'] })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(
      within(tabs).getByRole('button', { name: `${EN_CATALOG['tabs.close']} ${EN_CATALOG['nav.units']}` }),
    );
    expect(getWorkspaceTabs()).toEqual(['/dashboard']);
    expect(navPush).toHaveBeenCalledWith('/dashboard');
  });
  it('stays hidden with no tabs', () => {
    render(<WorkspaceTabs />);
    expect(screen.queryByRole('navigation', { name: EN_CATALOG['tabs.label'] })).not.toBeInTheDocument();
  });
});
