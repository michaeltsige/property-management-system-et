import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArrearsChart, CollectionsChart, MoneyComparisonChart, OccupancyChart } from '@/components/charts';

// ECharts draws to a canvas that jsdom does not implement; the accessibility
// contract (label + text table) is exactly the part that does not depend on it.
vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

describe('chart accessibility', () => {
  it('exposes the money comparison as a labelled image, with data in the label', () => {
    render(
      <MoneyComparisonChart
        expected={30000}
        collected={21500}
        currencyLabel="ETB"
        ariaLabel="Rent this period"
        expectedLabel="Expected rent"
        collectedLabel="Collected"
        chartDataLabel="Chart data as a table"
      />,
    );

    // No visible or hidden table below the chart: the numbers live in the
    // accessible name of the image itself.
    expect(screen.queryByRole('table')).toBeNull();
    const image = screen.getByRole('img');
    expect(image.getAttribute('aria-label')).toContain('Rent this period');
    expect(image.getAttribute('aria-label')).toContain('30,000');
    expect(image.getAttribute('aria-label')).toContain('21,500');
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
