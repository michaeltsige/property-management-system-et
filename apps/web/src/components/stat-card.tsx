'use client';

import { cn } from '@/lib/utils';

import { Card, CardContent, Icon, Skeleton, type IconName } from './ui';

/**
 * One KPI. The optional `progress` (0–100) draws a hairline bar under the
 * value so rates like "collected vs expected" are read as a ratio, not as a
 * bare percentage that can look impossible when it exceeds 100 (callers clamp
 * and explain that case with a hint).
 *
 * `size="hero"` breaks the row of equal cards: the ONE number the screen leads
 * with renders ~1.5x the supporting cards, so the eye lands somewhere first.
 *
 * `delta` renders a period-over-period shift chip with semantic intent color
 * (green = up, red = down, muted = flat) plus a trend glyph — never color
 * alone, and only when the comparison is actually like-for-like.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  size = 'default',
  loading,
  progress,
  delta,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'gold';
  size?: 'default' | 'hero';
  loading?: boolean;
  progress?: number;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; label: string };
  className?: string;
}) {
  const toneClasses: Record<string, string> = {
    default: 'text-slate-900',
    brand: 'text-brand-700',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    gold: 'text-gold-600',
  };
  const barTone: Record<string, string> = {
    default: 'bg-slate-400',
    brand: 'bg-brand-600',
    warning: 'bg-amber-500',
    danger: 'bg-red-600',
    gold: 'bg-gold-500',
  };
  const clamped = Math.max(0, Math.min(100, progress ?? 0));

  // A shift is a fact, not a judgement: color follows the DIRECTION of the
  // number and always carries the trend glyph plus spelled-out context.
  const deltaTone =
    delta === undefined
      ? undefined
      : delta.direction === 'up'
        ? { icon: 'trend-up' as IconName, classes: 'bg-brand-50 text-brand-800' }
        : delta.direction === 'down'
          ? { icon: 'trend-down' as IconName, classes: 'bg-red-50 text-red-800' }
          : { icon: 'trend-down' as IconName, classes: 'bg-slate-100 text-slate-600' };

  return (
    <Card className={className}>
      <CardContent className={size === 'hero' ? 'space-y-1.5 py-5' : 'space-y-1.5 py-4'}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          {delta && deltaTone ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular',
                deltaTone.classes,
              )}
            >
              <Icon name={deltaTone.icon} size="sm" className="h-3 w-3" />
              {delta.value}
              <span className="font-normal opacity-80">{delta.label}</span>
            </span>
          ) : null}
        </div>
        {loading ? (
          <Skeleton className={size === 'hero' ? 'h-9 w-32' : 'h-7 w-24'} />
        ) : (
          <p
            className={cn(
              'tabular font-semibold leading-8 tracking-tight',
              size === 'hero' ? 'text-3xl leading-10' : 'text-xl leading-7',
              toneClasses[tone],
            )}
          >
            {value}
          </p>
        )}
        {typeof progress === 'number' && !loading ? (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped)}
            aria-label={label}
            className="h-1 w-full overflow-hidden rounded-full bg-slate-100"
          >
            <div className={cn('h-full rounded-full', barTone[tone])} style={{ width: `${clamped}%` }} />
          </div>
        ) : null}
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
