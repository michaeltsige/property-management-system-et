'use client';

import * as Dialog from '@radix-ui/react-dialog';

import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { Button } from './ui';
import { Icon } from '@/components/ui';

/** Accessible modal built on Radix Dialog, styled like shadcn/ui's `Dialog`. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const { t } = usePreferences();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-0 shadow-xl',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-slate-900">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-xs text-slate-500">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.close')}>
                <Icon name="close" className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="px-4 py-4">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
