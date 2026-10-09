import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_CATALOG } from '@pms/i18n';
import { OwnerEditor, BlockEditor, feeToBps } from './hierarchy-controls';
import PropertiesPage from '@/app/(app)/properties/page';
import UnitsPage from '@/app/(app)/units/page';
import RegisterPage from '@/app/(auth)/register/page';
import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';

const context = vi.hoisted(() => ({ role: 'owner_admin', signIn: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/components/app-shell', () => ({
  PageHeader: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    t: (key: keyof typeof EN_CATALOG) => EN_CATALOG[key] ?? key,
    language: 'en',
    session: { role: context.role },
    signIn: context.signIn,
  }),
  LANGUAGES: [{ code: 'en', label: 'English' }],
  CALENDARS: [{ code: 'ethiopian', label: 'Ethiopian' }],
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    api: {
      bulkUnits: vi.fn(),
      importCsv: vi.fn(),
      owners: vi.fn(),
      properties: vi.fn(),
      units: vi.fn(),
      createOwner: vi.fn(),
      updateOwner: vi.fn(),
      createBuilding: vi.fn(),
      updateBuilding: vi.fn(),
      createProperty: vi.fn(),
      createUnit: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      finishOnboarding: vi.fn(),
      settings: vi.fn(),
    },
  };
});
const owner = { id: 'o1', name: 'Demo landlord', phone: null, email: null, managementFeeBps: 750 };
const property = {
  id: 'p1',
  name: 'Demo property',
  ownerId: 'o1',
  owner,
  type: 'apartment_block',
  status: 'active',
  buildings: [{ id: 'b1', propertyId: 'p1', name: 'North' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  context.role = 'owner_admin';
  vi.mocked(api.owners).mockResolvedValue({ owners: [owner], portfolioMode: 'managed' });
  vi.mocked(api.properties).mockResolvedValue({ properties: [property] as never });
  vi.mocked(api.units).mockResolvedValue({ units: [] });
});

describe('hierarchy controls', () => {
  it('converts percent text exactly and rejects out-of-range, fractional bps and exponent input', () => {
    expect(feeToBps('7.50')).toBe(750);
    expect(feeToBps('0.01')).toBe(1);
    expect(feeToBps('100')).toBe(10000);
    expect(feeToBps('')).toBeNull();
    for (const input of ['-1', '100.01', '1.001', '1e2']) expect(() => feeToBps(input)).toThrow();
  });
  it('creates a landlord using basis points and displays API failures without losing input', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    vi.mocked(api.createOwner)
      .mockRejectedValueOnce(new Error('Name rejected'))
      .mockResolvedValueOnce({ owner });
    render(<OwnerEditor onSaved={saved} />);
    await user.type(screen.getByLabelText('Landlord name'), 'Demo landlord');
    await user.type(screen.getByLabelText('Management fee (%)'), '7.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Name rejected/)).toBeInTheDocument();
    expect(screen.getByLabelText('Landlord name')).toHaveValue('Demo landlord');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.createOwner).toHaveBeenLastCalledWith({
      name: 'Demo landlord',
      managementFeeBps: 750,
      phone: null,
      email: null,
    });
  });
  it('edits a landlord and clears an optional fee', async () => {
    const user = userEvent.setup();
    render(<OwnerEditor owner={owner} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Management fee (%)')).toHaveValue('7.50');
    await user.clear(screen.getByLabelText('Management fee (%)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateOwner).toHaveBeenCalledWith('o1', expect.objectContaining({ managementFeeBps: null })),
    );
  });
  it('creates and renames blocks using the property-scoped API', async () => {
    const user = userEvent.setup();
    const view = render(<BlockEditor propertyId="p1" onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Block name'), 'South');
    await user.click(screen.getByRole('button', { name: 'Add block' }));
    await waitFor(() => expect(api.createBuilding).toHaveBeenCalledWith({ propertyId: 'p1', name: 'South' }));
    view.unmount();
    render(<BlockEditor propertyId="p1" block={property.buildings[0]} onSaved={vi.fn()} />);
    await user.clear(screen.getByLabelText('Block name'));
    await user.type(screen.getByLabelText('Block name'), 'East');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateBuilding).toHaveBeenCalledWith('b1', { name: 'East' }));
  });
  it('hides the landlord level for self-owned portfolios', async () => {
    vi.mocked(api.owners).mockResolvedValue({ owners: [owner], portfolioMode: 'self_owned' });
    render(<PropertiesPage />);
    await screen.findByText('Demo property');
    expect(screen.queryByText('Landlords')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo landlord')).not.toBeInTheDocument();
  });
  it('requires landlord selection for a managed property and submits the selected id', async () => {
    const user = userEvent.setup();
    render(<PropertiesPage />);
    await screen.findByRole('heading', { name: 'Landlords' });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByLabelText('Landlord')).toBeRequired();
    await user.click(modal.getByLabelText('Landlord'));
    await user.click(await screen.findByRole('option', { name: 'Demo landlord' }));
    await user.type(modal.getByLabelText(EN_CATALOG['property.name']), 'New property');
    await user.click(modal.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.createProperty).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'o1' })),
    );
  });
  it('does not offer write actions to accountants', async () => {
    context.role = 'accountant';
    render(<PropertiesPage />);
    await screen.findByText('Demo property');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.queryByText('Add landlord')).not.toBeInTheDocument();
  });
  it('resets the selected block when the unit property changes', async () => {
    vi.mocked(api.properties).mockResolvedValue({
      properties: [property, { ...property, id: 'p2', name: 'Other', buildings: [] }] as never,
    });
    const user = userEvent.setup();
    render(<UnitsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const modal = within(screen.getByRole('dialog'));
    await user.click(modal.getByLabelText('Properties'));
    await user.click(await screen.findByRole('option', { name: 'Demo property' }));
    await user.click(modal.getByLabelText('Building / block'));
    await user.click(await screen.findByRole('option', { name: 'North' }));
    await user.click(modal.getByLabelText('Properties'));
    await user.click(await screen.findByRole('option', { name: 'Other' }));
    expect(modal.getByLabelText('Building / block')).toHaveTextContent('No block');
    expect(modal.queryByRole('option', { name: 'North' })).not.toBeInTheDocument();
  });
  it('shows self-owned by default at signup and submits the chosen managed mode', async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue({ user: {}, organization: {}, role: 'owner_admin' } as never);
    render(<RegisterPage />);
    expect(screen.getByLabelText('How will you use the account?')).toHaveTextContent('I own these properties');
    await user.click(screen.getByLabelText('How will you use the account?'));
    await user.click(await screen.findByRole('option', { name: 'I manage properties for other owners' }));
    await user.type(screen.getByLabelText(EN_CATALOG['org.name']), 'Demo company');
    await user.type(screen.getByLabelText('Full name'), 'Demo Admin');
    await user.type(screen.getByLabelText('Email'), 'demo@example.test');
    await user.type(screen.getByLabelText('Password'), 'DemoPass123');
    await user.type(screen.getByLabelText('Phone'), '0911234567');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ portfolioMode: 'managed' })),
    );
  });
});

it('previews and submits bounded bulk labels', async () => {
  const { BulkUnitForm } = await import('./bulk-unit-form');
  const bulk = vi.spyOn(api, 'bulkUnits').mockResolvedValue({ units: [], count: 10 });
  const saved = vi.fn();
  const user = userEvent.setup();
  render(<BulkUnitForm properties={[property] as never} onSaved={saved} />);
  expect(screen.getByText(/A-001, A-002/)).toBeInTheDocument();
  await user.click(screen.getByLabelText('Properties'));
  await user.click(await screen.findByRole('option', { name: 'Demo property' }));
  await user.click(screen.getByRole('button', { name: 'Bulk-create units' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(10));
  expect(bulk).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: 'p1',
      naming: { pattern: 'A-{n}', start: 1, count: 10, padding: 3 },
    }),
  );
});

it('requires validation before CSV commit and resets it when text changes', async () => {
  const { CsvImportForm } = await import('./csv-import');
  const user = userEvent.setup();
  vi.mocked(api.importCsv).mockResolvedValue({ valid: true, count: 1, imported: 0, errors: [] });
  render(<CsvImportForm kind="tenants" properties={[]} onImported={vi.fn()} />);
  const commit = screen.getByRole('button', { name: 'Import validated rows' });
  expect(commit).toBeDisabled();
  await user.type(
    screen.getByLabelText('CSV text'),
    'fullName,phone,email,language,emergencyContactName,emergencyContactPhone\nDemo,,,,,',
  );
  await user.click(screen.getByRole('button', { name: 'Validate' }));
  await waitFor(() => expect(commit).toBeEnabled());
  await user.type(screen.getByLabelText('CSV text'), 'x');
  expect(commit).toBeDisabled();
});

it('shows row-level CSV errors and leaves import disabled', async () => {
  const { CsvImportForm } = await import('./csv-import');
  const user = userEvent.setup();
  vi.mocked(api.importCsv).mockResolvedValue({
    valid: false,
    count: 1,
    imported: 0,
    errors: [{ row: 2, field: 'phone', message: 'Invalid or missing value' }],
  });
  render(<CsvImportForm kind="tenants" properties={[]} onImported={vi.fn()} />);
  await user.type(screen.getByLabelText('CSV text'), 'invalid');
  await user.click(screen.getByRole('button', { name: 'Validate' }));
  expect(await screen.findByText('Invalid or missing value')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Import validated rows' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Download error report' })).toBeEnabled();
});

it('keeps profile values across signup steps and prevents submission with no payment methods', async () => {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText(EN_CATALOG['org.name']), 'Demo Org');
  await user.type(screen.getByLabelText('Full name'), 'Demo Admin');
  await user.type(screen.getByLabelText('Email'), 'demo@example.test');
  await user.type(screen.getByLabelText('Phone'), '0911234567');
  await user.type(screen.getByLabelText('Password'), 'DemoPass123');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  for (const checkbox of screen.getAllByRole('checkbox')) {
    if ((checkbox as HTMLInputElement).checked) await user.click(checkbox);
  }
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText(EN_CATALOG['onboarding.invalid_billing'])).toBeInTheDocument();
  expect(api.register).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Full name')).toHaveValue('Demo Admin');
});

it('offers optional first-property setup and a durable skip action', async () => {
  const { default: OnboardingPage } = await import('@/app/(app)/onboarding/page');
  vi.mocked(api.settings).mockResolvedValue({ settings: { onboardingStatus: 'portfolio_pending' } });
  const user = userEvent.setup();
  render(<OnboardingPage />);
  await screen.findByLabelText('Property name');
  await user.click(screen.getByRole('button', { name: 'Skip for now' }));
  await waitFor(() => expect(api.finishOnboarding).toHaveBeenCalledWith({ action: 'skip' }));
});
