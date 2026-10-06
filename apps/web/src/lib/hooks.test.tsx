import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoOpenModal } from '@/lib/hooks';

function Harness({ open }: { open: () => void }) {
  useAutoOpenModal(open);
  return <p>screen</p>;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('useAutoOpenModal', () => {
  it('opens the create dialog for a dashboard quick action', () => {
    window.history.replaceState({}, '', '/leases?new=1');
    const open = vi.fn();

    render(<Harness open={open} />);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('cleans the parameter so a refresh does not reopen the dialog', () => {
    window.history.replaceState({}, '', '/leases?new=1');
    render(<Harness open={() => undefined} />);

    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/leases');
  });

  it('does nothing without the parameter', () => {
    window.history.replaceState({}, '', '/leases?page=2');
    const open = vi.fn();

    render(<Harness open={open} />);

    expect(open).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?page=2');
  });
});
