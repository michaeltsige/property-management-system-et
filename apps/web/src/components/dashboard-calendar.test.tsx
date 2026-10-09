import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CalendarKind, LanguageCode } from '@pms/calendar';
import { createTranslator } from '@pms/i18n';
import DashboardPage from '@/app/(app)/dashboard/page';
import { api } from '@/lib/api';

const prefs = vi.hoisted(() => ({ calendar: 'ethiopian' as CalendarKind, language: 'en' as LanguageCode }));
vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({ ...prefs, t: createTranslator({ language: prefs.language }).t, session: null }),
}));
vi.mock('@/components/app-shell', () => ({
  PageHeader: ({ description }: { description: string }) => <p>{description}</p>,
}));
vi.mock('@/components/charts', () => ({
  CollectionsChart: ({ labels }: { labels: string[] }) => (
    <div data-testid="collections">{labels.join(' | ')}</div>
  ),
  ChargesByStatusChart: () => null,
  OccupancyChart: () => null,
  ArrearsChart: () => null,
}));
vi.mock('@/lib/api', () => ({
  api: { summary: vi.fn(), collections: vi.fn(), occupancy: vi.fn(), arrears: vi.fn(), settings: vi.fn() },
}));
function collection(calendar: CalendarKind) {
  return {
    calendar,
    rows: [
      {
        periodKey: calendar === 'ethiopian' ? '2018-13' : '2026-09',
        totalMinor: '10000',
        paymentCount: 1,
        byMethod: {},
      },
    ],
  } as Awaited<ReturnType<typeof api.collections>>;
}
beforeEach(() => {
  vi.clearAllMocks();
  prefs.calendar = 'ethiopian';
  prefs.language = 'en';
  vi.mocked(api.summary).mockResolvedValue({
    organization: { currency: 'ETB' },
    portfolio: { properties: 1 },
    money: {},
  } as never);
  vi.mocked(api.occupancy).mockResolvedValue({ rows: [] } as never);
  vi.mocked(api.arrears).mockResolvedValue({ buckets: [] } as never);
});
it('renders Pagume in Amharic, then switches calendar while old collections are retained', async () => {
  let resolveGregorian!: (v: Awaited<ReturnType<typeof api.collections>>) => void;
  vi.mocked(api.collections).mockImplementation((query) =>
    query?.includes('gregorian')
      ? new Promise((resolve) => {
          resolveGregorian = resolve;
        })
      : Promise.resolve(collection('ethiopian')),
  );
  const view = render(<DashboardPage />);
  expect(await screen.findByTestId('collections')).toHaveTextContent('Pagume 2018');
  prefs.language = 'am';
  view.rerender(<DashboardPage />);
  expect(screen.getByTestId('collections')).toHaveTextContent('ጳጉሜን 2018');
  prefs.calendar = 'gregorian';
  view.rerender(<DashboardPage />);
  expect(screen.queryByTestId('collections')).toBeNull();
  await waitFor(() => expect(api.collections).toHaveBeenCalledWith('?calendar=gregorian&months=13'));
  await act(async () => resolveGregorian(collection('gregorian')));
  expect(await screen.findByTestId('collections')).toHaveTextContent('ሴፕቴምበር 2026');
  expect(screen.getByTestId('collections')).not.toHaveTextContent('ጳጉሜን');
  prefs.calendar = 'ethiopian';
  view.rerender(<DashboardPage />);
  expect(await screen.findByTestId('collections')).toHaveTextContent('ጳጉሜን 2018');
});
it('ignores a late previous-calendar response after switching to Gregorian', async () => {
  let resolveEthiopian!: (v: Awaited<ReturnType<typeof api.collections>>) => void;
  vi.mocked(api.collections).mockImplementation((query) =>
    query?.includes('ethiopian')
      ? new Promise((resolve) => {
          resolveEthiopian = resolve;
        })
      : Promise.resolve(collection('gregorian')),
  );
  const view = render(<DashboardPage />);
  prefs.language = 'am';
  prefs.calendar = 'gregorian';
  view.rerender(<DashboardPage />);
  expect(await screen.findByTestId('collections')).toHaveTextContent('ሴፕቴምበር');
  await act(async () => resolveEthiopian(collection('ethiopian')));
  expect(screen.getByTestId('collections')).not.toHaveTextContent('ጳጉሜን');
  expect(screen.getByTestId('collections')).toHaveTextContent('ሴፕቴምበር');
});
