import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArrearsChart, ChargesByStatusChart, CollectionsChart, OccupancyChart } from '@/components/charts';

// ECharts draws to a canvas that jsdom does not implement; the accessibility
// contract (label + text table) is exactly the part that does not depend on it.
vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

describe('chart accessibility', () => {
  it('exposes the by-status donut as a labelled image, with data in the label', () => {
    render(
      <ChargesByStatusChart
        openMinor="850000"
        partialMinor="1500000"
        paidMinor="2000000"
        count={7}
        currencyLabel="ETB"
        ariaLabel="Charges by status"
        chartDataLabel="Chart data as a table"
        openLabel="Open"
        partialLabel="Partial"
        paidLabel="Paid"
        countLabel="charges this period"
      />,
    );

    // No visible or hidden table below the chart: the numbers live in the
    // accessible name of the image itself.
    expect(screen.queryByRole('table')).toBeNull();
    const image = screen.getByRole('img');
    expect(image.getAttribute('aria-label')).toContain('Charges by status');
    expect(image.getAttribute('aria-label')).toContain('8,500');
    expect(image.getAttribute('aria-label')).toContain('20,000');
  });

  it('renders a quiet placeholder ring for an empty period instead of a bare card', () => {
    render(
      <ChargesByStatusChart
        openMinor="0"
        partialMinor="0"
        paidMinor="0"
        count={0}
        currencyLabel="ETB"
        ariaLabel="Charges by status"
        chartDataLabel="Chart data as a table"
        openLabel="Open"
        partialLabel="Partial"
        paidLabel="Paid"
        countLabel="charges this period"
      />,
    );

    // The setOption call still happens; nothing can assert canvas pixels here,
    // but the labelled image contract must hold on the empty path too.
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Charges by status');
  });

  it('carries every collection period in the image label', () => {
    render(
      <CollectionsChart
        labels={['Meskerem 2018', 'Tir 2018']}
        values={[1200, 3400]}
        currencyLabel="ETB"
        ariaLabel="Collections trend"
        periodLabel="Period"
        chartDataLabel="Chart data as a table"
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('Collections trend');
    expect(label).toContain('Meskerem 2018');
    expect(label).toContain('3,400');
  });

  it('gives the occupancy chart one row per property', () => {
    render(
      <OccupancyChart
        rows={[
          { name: 'Bole Tower', occupied: 4, vacant: 1 },
          { name: 'CMC Villas', occupied: 2, vacant: 0 },
        ]}
        ariaLabel="Occupancy"
        occupiedLabel="Occupied"
        vacantLabel="Vacant"
        chartDataLabel="Chart data as a table"
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('Occupancy');
    expect(label).toContain('Bole Tower');
    expect(label).toContain('CMC Villas');
  });

  it('keeps arrears buckets readable as text', () => {
    render(
      <ArrearsChart
        buckets={[
          { label: '0-30', value: 500 },
          { label: '90+', value: 9000 },
        ]}
        ariaLabel="Arrears"
        bucketLabel="Period"
        currencyLabel="ETB"
        chartDataLabel="Chart data as a table"
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('90+');
    expect(label).toContain('9,000');
  });
});
