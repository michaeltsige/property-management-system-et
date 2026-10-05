import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from '@/components/modal';
import { Alert, Badge, Button, Skeleton, Table, Td, Th } from '@/components/ui';
import { PreferencesProvider } from '@/lib/preferences';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

describe('primitives', () => {
  it('announces failures immediately and confirmations politely', () => {
    const { rerender } = render(<Alert tone="danger">Could not save</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');

    rerender(<Alert tone="success">Payment recorded</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Payment recorded');
  });

  it('describes table columns for screen readers', () => {
    render(
      <Table>
        <thead>
          <tr>
            <Th>Amount</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>1,500.00</Td>
          </tr>
        </tbody>
      </Table>,
    );

    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('cell', { name: '1,500.00' })).toBeInTheDocument();
  });

  it('hides loading placeholders from assistive technology', () => {
    const { container } = render(<Skeleton className="h-8 w-full" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders badges as plain text, not as a control', () => {
    render(<Badge tone="gold">Meskerem 2018</Badge>);
    expect(screen.getByText('Meskerem 2018')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a button act as a link without losing button semantics', () => {
    render(
      <Button asChild>
        <a href="/leases?new=1">New lease</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'New lease' })).toHaveAttribute('href', '/leases?new=1');
  });
});

describe('Modal', () => {
  it('is a labelled dialog with a labelled close control', () => {
    render(
      <PreferencesProvider>
        <Modal open onOpenChange={() => undefined} title="Reverse payment">
          <p>Body</p>
        </Modal>
      </PreferencesProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Reverse payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
