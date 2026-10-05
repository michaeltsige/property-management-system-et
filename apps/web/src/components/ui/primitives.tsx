'use client';

/**
 * Small form and layout primitives, kept in one file because each is a handful
 * of lines of Tailwind. The APIs match shadcn/ui (`Input`, `Label`, `Card`,
 * `Badge`, `Separator`, `Skeleton`, `Alert`) so components can be swapped for
 * the upstream ones without touching call sites.
 */

import * as LabelPrimitive from '@radix-ui/react-label';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cva, type VariantProps } from 'class-variance-authority';
import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium text-slate-700', className)} {...props} />;
}

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-slate-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-slate-500', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

const badgeVariants = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-700',
      brand: 'bg-brand-100 text-brand-800',
      warning: 'bg-amber-100 text-amber-800',
      danger: 'bg-red-100 text-red-800',
      info: 'bg-sky-100 text-sky-800',
      gold: 'bg-gold-400/20 text-gold-600',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Separator({ className, ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root className={cn('my-2 h-px w-full bg-slate-200', className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} />;
}

const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    tone: {
      info: 'border-sky-200 bg-sky-50 text-sky-900',
      success: 'border-brand-200 bg-brand-50 text-brand-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      danger: 'border-red-200 bg-red-50 text-red-900',
    },
  },
  defaultVariants: { tone: 'info' },
});

export function Alert({
  tone,
  title,
  children,
  className,
}: {
  tone?: AlertProps['tone'];
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(alertVariants({ tone }), className)} role="status">
      {title ? <p className="font-medium">{title}</p> : null}
      {children}
    </div>
  );
}

type AlertProps = VariantProps<typeof alertVariants>;

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-slate-100 px-3 py-2 align-middle text-slate-700', className)}
      {...props}
    />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-xs text-slate-500">{description}</p> : null}
    </div>
  );
}
