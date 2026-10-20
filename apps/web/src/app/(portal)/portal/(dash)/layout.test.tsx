import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '@/lib/preferences';

import PortalLayout from './layout';

// Same seeding convention as the staff shell test: a tenant session in the
// preferences cache, navigation mocked so no real routing happens.
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/portal',
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const TENANT_SESSION = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: 'tenant-user-1',
    email: 'tenant@demo.test',
    fullName: 'Demo Tenant',
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
  role: 'tenant',
};

function renderPortal() {
  return render(
    <PreferencesProvider>
      <PortalLayout>
        <p>portal page content</p>
      </PortalLayout>
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('pms.session.v1', JSON.stringify(TENANT_SESSION));
});

describe('PortalLayout', () => {
  it('hosts the page inside the tenant rail shell', () => {
    renderPortal();
    expect(screen.getByText('portal page content')).toBeInTheDocument();
    // The overview entry is current on /portal, and its neighbours are all
    // present — the six things a tenant needs.
    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /payments/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /rent account/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /maintenance/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /notices/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile/i })).toBeInTheDocument();
  });

  it('anchors the page with the staff-style footer: portal, organization, today', () => {
    renderPortal();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Tenant portal');
    expect(footer).toHaveTextContent('Bole Demo Property Management');
    // The date column renders in the tenant's calendar (E.C. for ethiopian).
    expect(footer).toHaveTextContent('E.C.');
  });
});
