import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArrearsChart, CollectionsChart, MoneyComparisonChart, OccupancyChart } from '@/components/charts';

// ECharts draws to a canvas that jsdom does not implement; the accessibility
// contract (label + text table) is exactly the part that does not depend on it.
vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

describe('chart accessibility', () => {
  it('exposes the money comparison as a labelled image with a text table', () => {
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

    expect(screen.getByRole('img', { name: 'Rent this period' })).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Chart data as a table' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent('30,000');
    expect(within(rows[2]).getAllByRole('cell')[1]).toHaveTextContent('21,500');
  });

  it('lists every collection period in the text table', () => {
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

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('Meskerem 2018');
    expect(within(rows[2]).getAllByRole('cell')[1]).toHaveTextContent('3,400');
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

    expect(screen.getByRole('img', { name: 'Occupancy' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getAllByRole('cell')).toHaveLength(3);
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

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('90+');
    expect(within(rows[2]).getAllByRole('cell')[1]).toHaveTextContent('9,000');
  });
});
