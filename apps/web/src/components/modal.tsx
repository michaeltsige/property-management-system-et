'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Close } from './icons';

import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { Button } from './ui';

/** Accessible modal built on Radix Dialog, styled like shadcn/ui's `Dialog`. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'sm:max-w-lg',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Tailwind classes that set the modal's max-width at sm and up. Default
   * `sm:max-w-lg`. Wide forms (leases, properties) pass `sm:max-w-2xl`. Use
   * the `sm:` prefix so the mobile width (`w-[calc(100vw-2rem)]`) is the
   * binding constraint below sm — the modal nearly fills the phone screen
   * with a 1rem gutter on each side.
   */
  width?: string;
}) {
  const { t } = usePreferences();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] dark:bg-black/60" />
        <Dialog.Content
          className={cn(
            // Mobile: full viewport width minus 1rem each side, capped at 92vh
            // so the URL bar doesn't hide the close button. sm+: width=auto and
            // the `width` prop's `sm:max-w-*` is the binding constraint.
            // flex-col + overflow-hidden on the outer container means the
            // header and footer stay pinned while the middle (the form) is
            // the only thing that scrolls — no scroll-within-scroll on mobile.
            'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface p-0 shadow-float sm:w-auto',
            width,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold text-strong">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-xs text-muted">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label={t('common.close')}>
                <Close className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
