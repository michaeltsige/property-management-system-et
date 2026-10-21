'use client';

/**
 * Button — shadcn/ui's API (variants via cva, `asChild` support) so screens read
 * the same way as the upstream component kit. See THIRD_PARTY_NOTICES.md.
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand-600 text-white hover:bg-brand-700',
        secondary: 'bg-surface text-strong border border-line hover:bg-wash',
        outline: 'border border-brand-600 text-brand-700 dark:border-brand-400/70 dark:text-brand-300 hover:bg-brand-50',
        ghost: 'text-body hover:bg-wash-strong',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        gold: 'bg-gold-600 text-white hover:bg-gold-700',
        link: 'text-brand-700 dark:text-brand-300 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
