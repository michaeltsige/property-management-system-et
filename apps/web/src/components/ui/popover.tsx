'use client';

/**
 * Radix Popover behind a small, friendly API.
 *
 * Content portals to `document.body` (so it escapes Radix Modals such as the
 * lease form) and reuses the exact surface the Radix-behind-native Select uses,
 * so floating panels look like one system.
 */

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          aria-label={ariaLabel}
          className="z-50 rounded-lg border border-slate-200 bg-white shadow-md outline-none"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
