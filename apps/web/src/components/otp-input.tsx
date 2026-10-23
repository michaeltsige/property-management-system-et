'use client';

/**
 * The portal's one-time-code entry: one box per digit.
 *
 * The code that arrives by SMS is six digits, and six boxes are how every
 * phone OS trains people to read one — so the old single letter-spaced input
 * became this. The behavior mirrors the training: typing advances, backspace
 * on an empty box steps back and clears, arrows move, and pasting (or an SMS
 * autofill landing in the first box) fills every box from the start.
 *
 * Controlled: the parent owns the joined digit string, this component only
 * moves focus. The parent keeps its own sanitizer (strip non-digits, cap at
 * the length) on everything emitted here.
 */

import { useEffect, useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * One box, in the design tokens: the same border/focus voice as the Input
 * primitive, with a gentle two-step brand ring and a shadow transition so
 * focus reads as a lift, not a flash.
 */
const BOX_CLASSES = cn(
  'h-12 w-10 rounded-lg border border-edge bg-canvas text-center text-lg font-semibold tabular text-strong',
  'transition-[border-color,box-shadow] duration-150',
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'sm:h-14 sm:w-12',
);

export default function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Put on the first box, so a `<Label htmlFor>` can name the whole entry. */
  id?: string;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // Land on the first empty box on mount (a re-sent code starts the entry over).
  useEffect(() => {
    if (autoFocus) boxes.current[Math.min(value.length, length - 1)]?.focus();
    // Mount-only on purpose: the parent remounts this input for a fresh code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Remove the digit at `index`; digits after it close the gap. */
  function removeAt(index: number) {
    const chars = value.split('');
    chars.splice(index, 1);
    return chars.join('');
  }

  /**
   * Write `digits` from box `start`, then move focus: typing advances to the
   * next box, while a paste lands on the last box it filled. A sequence as
   * long as the code itself always fills from the first box.
   */
  function writeFrom(start: number, digits: string) {
    const from = digits.length >= length ? 0 : start;
    const chars = value.split('');
    let last = from - 1;
    for (let i = 0; i < digits.length && from + i < length; i += 1) {
      chars[from + i] = digits[i];
      last = from + i;
    }
    onChange(chars.join(''));
    boxes.current[Math.min(last + 1, length - 1)]?.focus();
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, '');
    if (!digits) {
      // Cleared in place (select + delete): drop the digit, keep the position.
      if (value[index]) onChange(removeAt(index));
      return;
    }
    writeFrom(index, digits);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        onChange(removeAt(index));
      } else if (index > 0) {
        // Backspace on an empty box steps back and clears that box too.
        onChange(removeAt(index - 1));
        boxes.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '');
    if (digits) writeFrom(index, digits);
  }

  return (
    <div className="flex justify-between gap-2">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // The first box carries the SMS autofill hint; the rest opt out.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          id={index === 0 ? id : undefined}
          value={value[index] ?? ''}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          // Selecting the digit on focus is what makes typing over a filled
          // box replace it instead of being blocked by maxLength.
          onFocus={(event) => event.currentTarget.select()}
          className={BOX_CLASSES}
        />
      ))}
    </div>
  );
}
