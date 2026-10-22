'use client';

/**
 * Small form and layout primitives, kept in one file because each is a handful
 * of lines of Tailwind. The APIs match shadcn/ui (`Input`, `Label`, `Card`,
 * `Badge`, `Separator`, `Skeleton`, `Alert`) so components can be swapped for
 * the upstream ones without touching call sites.
 */

import * as LabelPrimitive from '@radix-ui/react-label';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowDown2, ArrowUp2, Tick } from '../icons';
import {
  Children,
  Fragment,
  isValidElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

export function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root className={cn('text-xs font-medium text-soft', className)} {...props}>
      {children}
      {/* The visible required marker: the HTML attribute alone is invisible. */}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-red-600 dark:text-red-400">
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
}

/** Field-level validation message, shown under the input it describes. */
export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

export function Input({
  className,
  invalid,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement>; invalid?: boolean }) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(
        'flex h-9 w-full rounded-md border border-line bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60',
        invalid && 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500',
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
        'flex min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-muted focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Radix Select behind the native `<select>` API. Call sites keep writing
 * `<Select value onChange>{<option/>s}</Select>` and the adapter translates:
 *
 * - `<option>` children become Radix items. Radix forbids empty item values,
 *   so an option with `value=""` (the "All"/"Select…" placeholder pattern)
 *   travels as an internal sentinel and maps back to `''` on change —
 *   `e.target.value` semantics are preserved exactly.
 * - `onChange` receives a native-shaped `{ target: { value, name } }`, so the
 *   twenty-odd existing `onChange={(e) => set(e.target.value)}` call sites
 *   compile and run unchanged.
 * - With `name` set, a visually hidden native `<select>` mirrors the current
 *   value so FormData submission and native `required` validation behave as
 *   they did with the plain element (the Radix trigger is a button, which
 *   browsers do not associate with form submission).
 */
const SELECT_EMPTY = '__pms_empty__';

interface CollectedOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

function collectOptions(children: ReactNode): CollectedOption[] {
  const options: CollectedOption[] = [];
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === 'option') {
        const props = child.props as {
          value?: string | number;
          label?: ReactNode;
          disabled?: boolean;
          children?: ReactNode;
        };
        options.push({
          value: String(props.value ?? ''),
          label: props.label ?? props.children ?? '',
          disabled: props.disabled ?? false,
        });
        return;
      }
      // `<>...</>` fragments are a common way to group options (and a classic
      // trap: Children.forEach does NOT walk into them); recurse through.
      if (child.type === Fragment) {
        visit((child.props as { children?: ReactNode }).children);
      }
    });
  };
  visit(children);
  return options;
}

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'defaultValue' | 'multiple' | 'onChange' | 'size' | 'value'
> & {
  /** Controlled value. `''` selects the placeholder-style `<option value="">`. */
  value?: string | number;
  defaultValue?: string | number;
  /** Native-shaped handler: `{ target: { value, name } }`. */
  onChange?: (event: { target: { value: string; name: string } }) => void;
  /** Red "something is wrong" state on the trigger. */
  invalid?: boolean;
};

export function Select({
  className,
  children,
  id,
  name,
  required,
  disabled,
  value,
  defaultValue,
  onChange,
  invalid,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectProps) {
  const options = collectOptions(children);
  const isControlled = value !== undefined;
  const toRadix = (v: string | number | undefined) => {
    if (v === undefined) return undefined;
    const s = String(v);
    return s === '' ? SELECT_EMPTY : s;
  };
  // A native select with no explicit value shows its first option; keep that.
  const rootValue = isControlled ? toRadix(value) : undefined;
  const rootDefaultValue = isControlled
    ? undefined
    : toRadix(defaultValue ?? options[0]?.value ?? '');

  const handleValueChange = (next: string) => {
    onChange?.({ target: { value: next === SELECT_EMPTY ? '' : next, name: name ?? '' } });
  };

  const mirroredValue = isControlled
    ? String(value)
    : String(defaultValue ?? options[0]?.value ?? '');

  return (
    <SelectPrimitive.Root
      value={rootValue}
      defaultValue={rootDefaultValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-1 rounded-md border border-line bg-surface px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:border-brand-500 data-[state=open]:ring-1 data-[state=open]:ring-brand-500 [&>span]:min-w-0 [&>span]:truncate',
          invalid && 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="shrink-0 opacity-50">
          <ArrowDown2 className="h-4 w-4" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-surface text-strong shadow-float"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center">
            <ArrowUp2 className="h-4 w-4" aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value === '' ? SELECT_EMPTY : option.value}
                disabled={option.disabled}
                className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-wash-strong data-[highlighted]:text-strong"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Tick className="h-4 w-4" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center">
            <ArrowDown2 className="h-4 w-4" aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
      {name ? (
        <select
          name={name}
          required={required}
          disabled={disabled}
          value={mirroredValue}
          onChange={() => {}}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {typeof option.label === 'string' || typeof option.label === 'number'
                ? option.label
                : undefined}
            </option>
          ))}
        </select>
      ) : null}
    </SelectPrimitive.Root>
  );
}

/**
 * Cards are containers, and per the depth decision containers carry a crisp,
 * ink-tinted edge plus a tiny ink-tinted shadow — visible separation against
 * the green-mist canvas, nothing like the old 1.2:1 hairline. The tonal half
 * of the system lives in the canvas contrast, the brand-tinted header row
 * (CardHeader) and the borderless floating overlays.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-edge bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // The tonal header: the shallowest step of brand green, rounded to
        // stay inside the card's corners. The hairline under it is a step of
        // edge, so the tint ends with the same ink voice as the card border.
        'flex flex-wrap items-center justify-between gap-2 rounded-t-[7px] border-b border-edge/50 bg-brand-50/80 px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-strong', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

const badgeVariants = cva(
  // Compact rectangle, not a pill: statuses read as data in a dense table,
  // not as decorative chips (java110/Element convention). The inset ring is
  // the subtle border that keeps every tone legible on both canvas shades.
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset',
  {
    variants: {
      tone: {
        neutral: 'bg-wash-strong text-body ring-black/10 dark:ring-white/15',
        brand: 'bg-brand-100 text-brand-800 ring-brand-600/25',
        warning: 'bg-amber-100 text-amber-800 ring-amber-600/25 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/30',
        danger: 'bg-red-100 text-red-800 ring-red-600/25 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-400/30',
        info: 'bg-sky-100 text-sky-800 ring-sky-600/25 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-400/30',
        gold: 'bg-gold-400/20 text-gold-600 ring-gold-600/30 dark:text-gold-400',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Separator({ className, ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root className={cn('my-2 h-px w-full bg-line', className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-line', className)} />;
}

const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    tone: {
      info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
      success: 'border-brand-200 bg-brand-50 text-brand-900',
      warning:
        'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
      danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
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
  // A failure has to interrupt the screen reader; a confirmation can wait.
  const role = tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={cn(alertVariants({ tone }), className)} role={role}>
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

export function Th({ className, scope = 'col', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        // Normal-case column headers (the operations-console convention):
        // shouting uppercase on every screen was one of the "vibecoded" tells.
        'border-b border-edge/50 bg-brand-50/60 px-3 py-2 text-left text-xs font-semibold text-soft',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-line-soft px-3 py-2.5 align-middle text-body', className)}
      {...props}
    />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-12 text-center">
      <p className="text-sm font-medium text-body">{title}</p>
      {description ? <p className="max-w-md text-xs text-muted">{description}</p> : null}
    </div>
  );
}
