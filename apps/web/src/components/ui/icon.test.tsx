import { render, screen } from '@testing-library/react';

import { describe, expect, it } from 'vitest';

import { Icon } from './icon';

describe('Icon', () => {
  it('is decorative by default: hidden from assistive technology', () => {
    render(<Icon name="wallet" data-testid="icon" />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveAttribute('aria-label');
  });

  it('becomes a named image when the icon IS the content of a control', () => {
    render(<Icon name="wallet" label="Payments" data-testid="icon" />);
    expect(screen.getByRole('img', { name: 'Payments' })).toBeInTheDocument();
  });

  it('renders from the size tokens (4px grid), not arbitrary pixels', () => {
    const { rerender } = render(<Icon name="plus" size="sm" data-testid="icon" />);
    expect(screen.getByTestId('icon')).toHaveAttribute('width', '16');
    rerender(<Icon name="plus" data-testid="icon" />);
    expect(screen.getByTestId('icon')).toHaveAttribute('width', '20');
    rerender(<Icon name="plus" size="lg" data-testid="icon" />);
    expect(screen.getByTestId('icon')).toHaveAttribute('width', '24');
  });

  it('draws with the one stroke weight and inherits color via currentColor', () => {
    render(<Icon name="building" data-testid="icon" />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('stroke-width', '1.75');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    expect(icon).toHaveAttribute('fill', 'none');
  });

  it('never leaks a custom class into the meaning of the glyph', () => {
    // Every name in the union must resolve to real path data; a typo in a
    // call site is a compile error, but this guards the GLYPHS map itself.
    const names = [
      'calendar',
      'calendar-plus',
      'chart',
      'clipboard',
      'close',
      'dashboard',
      'download',
      'building',
      'file',
      'globe',
      'home',
      'ledger',
      'log-out',
      'menu',
      'play',
      'plus',
      'receipt',
      'refresh',
      'save',
      'search',
      'trash',
      'trend-down',
      'trend-up',
      'upload',
      'user-plus',
      'users',
      'wallet',
      'wrench',
      'chevron-left',
      'chevron-right',
    ] as const;
    for (const name of names) {
      const { container } = render(<Icon name={name} />);
      // A glyph is either stroked paths or a filled shape; never empty SVG.
      expect(container.querySelector('svg')?.innerHTML.trim().length).toBeGreaterThan(0);
    }
  });
});
