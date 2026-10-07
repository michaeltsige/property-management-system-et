'use client';

import { cn } from '@/lib/utils';

import { Card, CardContent, Skeleton } from './ui';

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'gold';
  loading?: boolean;
}) {
  const toneClasses: Record<string, string> = {
    default: 'text-slate-900',
    brand: 'text-brand-700',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    gold: 'text-gold-600',
  };

  return (
    <Card>
      <CardContent className="space-y-1.5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className={cn('tabular text-2xl font-semibold tracking-tight', toneClasses[tone])}>{value}</p>
        )}
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
