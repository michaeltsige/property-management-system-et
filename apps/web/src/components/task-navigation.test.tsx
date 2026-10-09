import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import { roleHasPermission } from '@pms/shared';
import { TaskPanel } from './task-panel';
import { GlobalSearch } from './global-search';
import { PropertySwitcher } from './property-switcher';
import UnitsPage from '@/app/(app)/units/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { getPropertyContext, setPropertyContext, usePropertyContext } from '@/lib/property-context';

const context = vi.hoisted(() => ({ role: 'owner_admin' }));
const navPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navPush, replace: vi.fn() }),
  usePathname: () => '/units',
}));
vi.mock('@/components/app-shell', () => ({
  PageHeader: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    language: 'en',
    session: { role: context.role },
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    api: {
      charges: vi.fn(),
      workOrders: vi.fn(),
      arrears: vi.fn(),
      properties: vi.fn(),
      units: vi.fn(),
      tenants: vi.fn(),
      createUnit: vi.fn(),
      bulkUnits: vi.fn(),
      importCsv: vi.fn(),
    },
  };
});
const properties = {
  properties: [
    { id: 'p1', name: 'Alpha', ownerId: null, type: 'apartment_block', status: 'active', buildings: [] },
    { id: 'p2', name: 'Beta', ownerId: null, type: 'apartment_block', status: 'active', buildings: [] },
  ],
};
const unit = (id: string, propertyId: string, label: string) => ({
  id,
  propertyId,
  label,
  floor: null,
  bedrooms: null,
  bathrooms: null,
  areaSqm: null,
  marketRentMinor: null,
  currency: 'ETB',
  status: 'vacant',
});
beforeEach(() => {
  vi.clearAllMocks();
  context.role = 'owner_admin';
  navPush.mockClear();
  window.localStorage.clear();
  vi.mocked(api.properties).mockResolvedValue(properties as never);
});

describe('task panel', () => {
  it('shows counts only for data the role can read', async () => {
    vi.mocked(api.charges).mockResolvedValue({ items: [], total: 3 } as never);
    vi.mocked(api.workOrders).mockResolvedValue({
      items: [],
      total: 5,
      openCount: 2,
      urgentCount: 1,
    } as never);
    vi.mocked(api.arrears).mockResolvedValue({
      rows: [{}, {}],
      buckets: [],
      totalMinor: '0',
      currency: 'ETB',
      asOf: '',
    } as never);
    render(<TaskPanel />);
    const overdueRow = (await screen.findByText(EN_CATALOG['tasks.overdue_charges'])).closest('li');
    const workRow = screen.getByText(EN_CATALOG['tasks.open_work_orders']).closest('li');
    const arrearsRow = screen.getByText(EN_CATALOG['tasks.arrears_review']).closest('li');
    expect(within(overdueRow!).getByText('3')).toBeInTheDocument();
    expect(within(workRow!).getByText('2')).toBeInTheDocument();
    expect(within(arrearsRow!).getByText('2')).toBeInTheDocument();
    expect(api.charges).toHaveBeenCalledWith('?status=overdue&pageSize=1');
  });
  it('never asks for money data without charges.read', () => {
    context.role = 'maintenance';
    vi.mocked(api.workOrders).mockResolvedValue({
      items: [],
      total: 1,
      openCount: 1,
      urgentCount: 0,
    } as never);
    render(<TaskPanel />);
    expect(api.charges).not.toHaveBeenCalled();
    expect(api.arrears).not.toHaveBeenCalled();
    expect(roleHasPermission('maintenance', 'charges.read')).toBe(false);
  });
});

describe('global search', () => {
  it('filters units and tenants and navigates on Enter', async () => {
    vi.mocked(api.units).mockResolvedValue({
      units: [unit('u1', 'p1', 'A-101'), unit('u2', 'p2', 'B-202')],
    } as never);
    vi.mocked(api.tenants).mockResolvedValue({
      tenants: [{ id: 't1', fullName: 'Abebe Kebede', phone: '+251911000000', email: null, language: 'am' }],
    } as never);
    const push = vi.fn();
    vi.doMock('next/navigation', () => ({
      useRouter: () => ({ push, replace: vi.fn() }),
      usePathname: () => '/dashboard',
    }));
    const user = userEvent.setup();
    render(<GlobalSearch />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'abebe');
    const option = await screen.findByRole('option', { name: /Abebe Kebede/ });
    await user.click(option);
    expect(navPush).toHaveBeenCalledWith('/tenants?search=Abebe%20Kebede');
  });
  it('shows an empty state for unmatched text', async () => {
    vi.mocked(api.units).mockResolvedValue({ units: [] } as never);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [] } as never);
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText(EN_CATALOG['search.no_results'])).toBeInTheDocument();
  });
});

describe('property switcher and scoped lists', () => {
  it('persists the selection and scopes the units list', async () => {
    vi.mocked(api.units).mockResolvedValue({
      units: [unit('u1', 'p1', 'A-101'), unit('u2', 'p2', 'B-202')],
    } as never);
    const user = userEvent.setup();
    function Probe() {
      const [value] = usePropertyContext();
      return <output data-testid="probe">{value ?? 'none'}</output>;
    }
    render(
      <>
        <PropertySwitcher id="ctx" />
        <Probe />
        <UnitsPage />
      </>,
    );
    await screen.findByText('A-101');
    expect(screen.getByText('B-202')).toBeInTheDocument();
    await user.click(screen.getByLabelText(EN_CATALOG['property.context']));
    await user.click(await screen.findByRole('option', { name: 'Alpha' }));
    expect(getPropertyContext()).toBe('p1');
    expect(screen.getByTestId('probe')).toHaveTextContent('p1');
    expect(screen.getByText('A-101')).toBeInTheDocument();
    expect(screen.queryByText('B-202')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(EN_CATALOG['property.context']));
    await user.click(await screen.findByRole('option', { name: 'All properties' }));
    expect(screen.getByText('B-202')).toBeInTheDocument();
    expect(window.localStorage.getItem('pms.property-context.v1')).toBeNull();
  });
  it('clears a stored property that no longer exists instead of hiding every row', async () => {
    setPropertyContext('missing');
    vi.mocked(api.units).mockResolvedValue({ units: [unit('u1', 'p1', 'A-101')] } as never);
    render(
      <>
        <PropertySwitcher id="ctx" />
        <UnitsPage />
      </>,
    );
    await waitFor(() => expect(getPropertyContext()).toBeNull());
    expect(await screen.findByText('A-101')).toBeInTheDocument();
  });
});
