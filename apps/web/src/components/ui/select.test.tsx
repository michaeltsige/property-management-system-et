import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Label, Select } from './primitives';

/**
 * The Select keeps the native `<select>` API on top of Radix. These tests pin
 * the four behaviours the call sites depend on: the trigger shows the selected
 * option's label (including the `value=""` placeholder option), `onChange`
 * receives native-shaped `{ target: { value, name } }`, the `name` prop
 * produces a hidden native select so form association and `required`
 * validation survive the swap, and an uncontrolled select shows its first
 * option like a plain element would.
 */

const OPTIONS = (
  <>
    <option value="">All statuses</option>
    <option value="open">Open</option>
    <option value="closed" disabled>
      Closed
    </option>
  </>
);

function StatefulSelect({ onReport }: { onReport?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <Label htmlFor="status">Status</Label>
      <Select
        id="status"
        name="status"
        required
        value={value}
        onChange={(event) => {
          onReport?.(event.target.value);
          setValue(event.target.value);
        }}
      >
        {OPTIONS}
      </Select>
    </div>
  );
}

describe('<Select /> (Radix behind the native API)', () => {
  it('shows the placeholder option as the trigger label while nothing is chosen', () => {
    render(<StatefulSelect />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('All statuses');
  });

  it('opens the listbox, lists every option and reports the chosen value', async () => {
    const user = userEvent.setup();
    const reported: string[] = [];
    render(<StatefulSelect onReport={(value) => reported.push(value)} />);
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Open' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'Closed' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(listbox).getByRole('option', { name: 'Open' }));
    expect(reported).toEqual(['open']);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Open');
  });

  it('maps the placeholder option back to an empty string', async () => {
    const user = userEvent.setup();
    const reported: string[] = [];
    render(<StatefulSelect onReport={(value) => reported.push(value)} />);
    // Start from a real value, then return to the placeholder option — mirroring
    // the filter-reset flow. Re-selecting the ALREADY-selected option fires no
    // change event (Radix, like native select, only reports actual changes).
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Open' }));
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'All statuses' }));
    expect(reported).toEqual(['open', '']);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('All statuses');
  });

  it('mirrors value, name and required onto a hidden native select', () => {
    render(<StatefulSelect />);
    const native = document.querySelector('select[name="status"]');
    expect(native).not.toBeNull();
    expect(native).toBeRequired();
    expect(native).toHaveValue('');
  });

  it('defaults to the first option when uncontrolled, like a native select', () => {
    render(
      <Select aria-label="Fruit">
        <option value="apple">Apple</option>
        <option value="pear">Pear</option>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Fruit' })).toHaveTextContent('Apple');
  });

  it('propagates the disabled state to the trigger', () => {
    render(
      <Select disabled aria-label="Fruit">
        <option value="apple">Apple</option>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Fruit' })).toBeDisabled();
  });
});
