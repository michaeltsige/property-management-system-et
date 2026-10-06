import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import UnitDetailPage from '@/app/(app)/units/[id]/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({ role: 'owner_admin', id: 'u1' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: context.id }) }));
vi.mock('@/components/app-shell', () => ({
  PageHeader: ({ description }: { description: string }) => <header>{description}</header>,
}));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    language: 'en',
    calendar: 'ethiopian',
    session: { role: context.role },
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { units: vi.fn(), leases: vi.fn(), workOrders: vi.fn() } };
});
const unit = {
  id: 'u1',
  propertyId: 'p1',
  label: 'A-101',
  floor: 1,
  bedrooms: 2,
  bathrooms: 1,
  areaSqm: 65,
  marketRentMinor: '2500000',
  currency: 'ETB',
  status: 'occupied',
  property: { id: 'p1', name: 'Alpha' },
  building: { id: 'b1', propertyId: 'p1', name: 'North' },
};
beforeEach(() => {
  vi.clearAllMocks();
  context.role = 'owner_admin';
  context.id = 'u1';
  vi.mocked(api.units).mockResolvedValue({ units: [unit] } as never);
  vi.mocked(api.leases).mockResolvedValue({
    leases: [
      {
        id: 'l1',
        status: 'active',
        billingCalendar: 'ethiopian',
        billingFrequency: 'monthly',
        startDate: '2026-01-01',
        endDate: null,
        rentAmountMinor: '2500000',
        currency: 'ETB',
        dueDayOfMonth: 5,
        balanceMinor: '0',
        unit: { id: 'u1', label: 'A-101', property: { id: 'p1', name: 'Alpha' } },
        tenant: { id: 't1', fullName: 'Demo Tenant', phone: null },
      },
    ],
  } as never);
  vi.mocked(api.workOrders).mockResolvedValue({
    items: [
      {
        id: 'w1',
        title: 'Leaking tap',
        priority: 'normal',
        status: 'open',
        unit: { id: 'u1', label: 'A-101' },
      },
    ],
    total: 1,
    openCount: 1,
    urgentCount: 0,
  } as never);
});
describe('unit detail', () => {
  it('shows facts, the lease and maintenance for one unit', async () => {
    render(<UnitDetailPage />);
    expect(await screen.findByText('A-101 · Alpha · North')).toBeInTheDocument();
    expect(screen.getByText('Demo Tenant')).toBeInTheDocument();
    expect(screen.getByText('Leaking tap')).toBeInTheDocument();
    expect(screen.getByText(EN_CATALOG['unit.status.occupied'])).toBeInTheDocument();
  });
  it('shows a recovery path for an unknown unit', async () => {
    context.id = 'missing';
    render(<UnitDetailPage />);
    expect(await screen.findByText(EN_CATALOG['unit.not_found'])).toBeInTheDocument();
  });
  it('asks for no data without units.read', async () => {
    context.role = 'tenant';
    render(<UnitDetailPage />);
    expect(await screen.findByText(EN_CATALOG['common.no_results'])).toBeInTheDocument();
    expect(api.units).not.toHaveBeenCalled();
  });
});
