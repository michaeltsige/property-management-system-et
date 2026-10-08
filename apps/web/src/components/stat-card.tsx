'use client';

import { cn } from '@/lib/utils';

import { Card, CardContent, Skeleton } from './ui';

/**
 * One KPI. The optional `progress` (0–100) draws a hairline bar under the
 * value so rates like "collected vs expected" are read as a ratio, not as a
 * bare percentage that can look impossible when it exceeds 100 (callers clamp
 * and explain that case with a hint).
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  loading,
  progress,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'gold';
  loading?: boolean;
  progress?: number;
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

  return (
    <Card>
      <CardContent className="space-y-1.5 py-4">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className={cn('tabular text-[22px] font-semibold leading-8 tracking-tight', toneClasses[tone])}>
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
