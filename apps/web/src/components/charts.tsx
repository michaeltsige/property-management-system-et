'use client';

/**
 * Apache ECharts wrappers.
 *
 * ECharts is imperative and touches `window`, so it is initialised inside an
 * effect and disposed on unmount. Charts receive plain numbers and pre-formatted
 * labels: no calendar or money logic lives in a chart.
 *
 * One palette everywhere (the previous mix of arbitrary per-series colors was
 * a big part of why the dashboards read as "vibecoded"): brand green for the
 * primary series, neutral slate for comparators, semantic amber/red only for
 * arrears aging. Grid lines and axis text stay quiet so the data leads.
 *
 * Accessibility (ADR-0024): a canvas is opaque to assistive technology, so every
 * chart requires an `aria-label` and should pass a `summary`. `EChart` then
 * exposes the drawing as `role="img"` with that label, and renders the same data
 * as a visually hidden table — the text equivalent a screen reader user can
 * actually read, and a fallback for anyone whose browser cannot draw the canvas.
 */

import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

export type EChartsOption = echarts.EChartsOption;

/** The one chart palette. Semantics: brand = ours/primary, slate = comparator. */
export const CHART_COLORS = {
  brand: '#1d6753',
  brandSoft: 'rgba(29, 103, 83, 0.10)',
  neutral: '#94a3b8',
  gold: '#e8b22b',
  warning: '#f59e0b',
  danger: '#dc2626',
  grid: '#e2e8f0',
  // slate-600, not slate-500: axis and legend text must clear WCAG AA (4.5:1)
  // against the white card, and slate-500 sat right on the line.
  axisLabel: '#475569',
  axisLine: '#cbd5e1',
} as const;

const AXIS_LABEL = { fontSize: 11, color: CHART_COLORS.axisLabel };

/** The same numbers the chart draws, as a table a screen reader can read. */
export interface ChartSummary {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

export function EChart({
  option,
  height = 260,
  ariaLabel,
  summary,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
  summary?: ChartSummary;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  // ECharts draws text on a canvas, which never inherits the CSS font stack:
  // read the composed family from the container (Poppins via --font-poppins on
  // <body>) and set it as the global ECharts default. Per-element styles keep
  // their own sizes/colors and inherit this family.
  const fontAwareOption = (next: EChartsOption): EChartsOption => {
    const el = container.current;
    if (!el) return next;
    const fontFamily = window.getComputedStyle(el).fontFamily;
    return fontFamily ? { ...next, textStyle: { fontFamily } } : next;
  };

  useEffect(() => {
    if (!container.current) return;
    const instance = echarts.init(container.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(container.current);
    // Web fonts land after first paint; redraw once they do, so canvas text is
    // measured with Poppins rather than the fallback it was laid out with.
    document.fonts?.ready
      .then(() => {
        if (chart.current && container.current) {
          chart.current.setOption(fontAwareOption(latestOption.current), true);
          chart.current.resize();
        }
      })
      .catch(() => undefined);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  // Keep the latest option in a ref so the font-ready redraw (above) and the
  // update effect below share one code path.
  const latestOption = useRef(option);
  latestOption.current = option;

  useEffect(() => {
    chart.current?.setOption(fontAwareOption(option), true);
  }, [option]);

  // The summary rides inside the image's accessible name instead of a hidden
  // DOM table: screen readers still hear the numbers, but nothing renders (or
  // leaks into copy/paste) below the chart.
  const label = summary
    ? `${ariaLabel} — ${summary.caption}: ${summary.rows.map((row) => row.join(' ')).join('; ')}`
    : ariaLabel;

  return <div ref={container} role="img" aria-label={label} style={{ height }} className="w-full" />;
}

/**
 * Rent-roll composition for the period: billed amount per charge status, as a
 * donut in the donut-stat pattern (shadcn/charts): a thick, rounded ring with
 * the period total standing in the exact center, and the share of each status
 * spelled out in an HTML legend — the numbers are permanent, not hover-only.
 *
 * The center text and the legend are DOM, not canvas: DOM can be perfectly
 * centered over the ring regardless of device pixel ratio, and it inherits
 * the app's font. The canvas below draws only the ring itself.
 */
export function ChargesByStatusChart({
  openMinor,
  partialMinor,
  paidMinor,
  count,
  currencyLabel,
  ariaLabel,
  chartDataLabel,
  openLabel,
  partialLabel,
  paidLabel,
  countLabel,
  totalLabel = 'Total collected',
}: {
  openMinor: string;
  partialMinor: string;
  paidMinor: string;
  count: number;
  currencyLabel: string;
  ariaLabel: string;
  chartDataLabel: string;
  openLabel: string;
  partialLabel: string;
  paidLabel: string;
  countLabel: string;
  /** Label under the centered total, e.g. "total collected". */
  totalLabel?: string;
}) {
  const parts = [
    { name: paidLabel, value: Number(paidMinor) / 100, color: CHART_COLORS.brand },
    { name: partialLabel, value: Number(partialMinor) / 100, color: CHART_COLORS.gold },
    { name: openLabel, value: Number(openMinor) / 100, color: CHART_COLORS.neutral },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  // An empty period renders a quiet placeholder ring instead of nothing, so
  // the card never reads as a failed load.
  const data =
    total > 0
      ? parts.map((part) => ({ name: part.name, value: part.value, itemStyle: { color: part.color } }))
      : [{ name: '', value: 1, itemStyle: { color: '#f1f5f9' }, tooltip: { show: false } }];
  const share = (value: number) =>
    total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';

  return (
    <div>
      <div className="relative">
        <EChart
          height={216}
          ariaLabel={ariaLabel}
          summary={{
            caption: chartDataLabel,
            columns: ['', currencyLabel],
            rows: parts.map((part) => [part.name, part.value.toLocaleString()]),
          }}
          option={{
            tooltip: {
              trigger: 'item',
              valueFormatter: (value) => `${currencyLabel} ${Number(value).toLocaleString()}`,
            },
            series: [
              {
                type: 'pie',
                // Thick ring, dead center of its box: the DOM overlay below
                // relies on the ring being exactly centered.
                radius: ['58%', '82%'],
                center: ['50%', '50%'],
                padAngle: total > 0 ? 2 : 0,
                itemStyle: { borderRadius: 6 },
                label: { show: false },
                emphasis: { scale: false },
                data,
              },
            ],
          }}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <p className="text-lg font-semibold tracking-tight text-slate-900 tabular">
            {currencyLabel} {Math.round(total).toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500">{totalLabel}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((part) => (
          <li key={part.name} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
              style={{ background: part.color }}
            />
            <span className="truncate text-slate-600">{part.name}</span>
            <span className="ml-auto shrink-0 font-medium text-slate-900 tabular">{share(part.value)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          <span className="truncate">{`${count} ${countLabel}`}</span>
        </li>
      </ul>
    </div>
  );
}

/** Collections over the last N periods, in the user's calendar. */
export function CollectionsChart({
  labels,
  values,
  currencyLabel,
  ariaLabel,
  periodLabel,
  chartDataLabel,
}: {
  labels: string[];
  values: number[];
  currencyLabel: string;
  ariaLabel: string;
  periodLabel: string;
  chartDataLabel: string;
}) {
  return (
    <EChart
      ariaLabel={ariaLabel}
      summary={{
        caption: chartDataLabel,
        columns: [periodLabel, currencyLabel],
        rows: labels.map((label, index) => [label, (values[index] ?? 0).toLocaleString()]),
      }}
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value) => `${currencyLabel} ${Number(value).toLocaleString()}`,
        },
        xAxis: {
          type: 'category',
          data: labels,
          // 13 Ethiopian months do not fit across a phone; drop labels rather
          // than draw them on top of each other.
          axisLabel: { ...AXIS_LABEL, hideOverlap: true },
          axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { ...AXIS_LABEL, formatter: (value: number) => value.toLocaleString() },
          splitLine: { lineStyle: { color: CHART_COLORS.grid } },
        },
        series: [
          {
            type: 'line',
            smooth: true,
            symbolSize: 5,
            data: values,
            areaStyle: { color: CHART_COLORS.brandSoft },
            lineStyle: { color: CHART_COLORS.brand, width: 2 },
            itemStyle: { color: CHART_COLORS.brand },
          },
        ],
      }}
    />
  );
}

/** Occupancy by property: a horizontal stacked bar, one row per property. */
export function OccupancyChart({
  rows,
  ariaLabel,
  occupiedLabel,
  vacantLabel,
  chartDataLabel,
}: {
  rows: { name: string; occupied: number; vacant: number }[];
  ariaLabel: string;
  occupiedLabel: string;
  vacantLabel: string;
  chartDataLabel: string;
}) {
  return (
    <EChart
      ariaLabel={ariaLabel}
      height={Math.max(180, rows.length * 44)}
      summary={{
        caption: chartDataLabel,
        columns: ['', occupiedLabel, vacantLabel],
        rows: rows.map((row) => [row.name, row.occupied, row.vacant]),
      }}
      option={{
        grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: {
          data: [occupiedLabel, vacantLabel],
          top: 0,
          right: 0,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 11, color: CHART_COLORS.axisLabel },
        },
        xAxis: { type: 'value', minInterval: 1, axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: CHART_COLORS.grid } } },
        yAxis: { type: 'category', data: rows.map((row) => row.name), axisLabel: AXIS_LABEL, axisLine: { lineStyle: { color: CHART_COLORS.axisLine } } },
        series: [
          {
            name: occupiedLabel,
            type: 'bar',
            stack: 'units',
            barWidth: 14,
            data: rows.map((row) => row.occupied),
            itemStyle: { color: CHART_COLORS.brand },
          },
          {
            name: vacantLabel,
            type: 'bar',
            stack: 'units',
            barWidth: 14,
            data: rows.map((row) => row.vacant),
            itemStyle: { color: '#e2e8f0' },
          },
        ],
      }}
    />
  );
}

/** Compact axis numbers: 12,500 → 12.5k, 4,300,000 → 4.3M — money-scale
 * rent figures do not fit as raw strings across a card. */
function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions >= 10 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (Math.abs(value) >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands.toFixed(thousands >= 10 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(value)}`;
}

/** Arrears aging: how old the unpaid rent is.
 *
 * Rebuilt from a bare bar plot into an aging picture that reads at a glance
 * (and matches the dashboard's donut-stat language): the total outstanding
 * stands above the plot, each bucket is a rounded, gradient-filled bar over a
 * soft full-height track with its amount spelled out on top, and a legend
 * below gives every bucket's share of the debt. Severity still carries the
 * color — the older the debt, the hotter the bar (gold → amber → red). */
export function ArrearsChart({
  buckets,
  ariaLabel,
  bucketLabel,
  currencyLabel,
  chartDataLabel,
  totalLabel = 'Total outstanding',
}: {
  buckets: { label: string; value: number }[];
  ariaLabel: string;
  bucketLabel: string;
  currencyLabel: string;
  chartDataLabel: string;
  /** Label beside the summed debt, e.g. "total outstanding". */
  totalLabel?: string;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
  // One gradient per severity: the top of each bar is a lighter step of the
  // same hue, so the bars read as solid objects rather than flat strips.
  const severityStyle = (index: number) => {
    const [base, top] =
      index === 0
        ? ['#e8b22b', '#f3cf6b']
        : index >= buckets.length - 2
          ? ['#dc2626', '#f87171']
          : ['#f59e0b', '#fcd34d'];
    return {
      type: 'linear' as const,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: top },
        { offset: 1, color: base },
      ],
    };
  };

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-end gap-2">
        <span className="text-[11px] text-slate-500">{totalLabel}</span>
        <span className="tabular text-sm font-semibold text-slate-900">
          {currencyLabel} {Math.round(total).toLocaleString()}
        </span>
      </div>
      <EChart
        ariaLabel={`${ariaLabel} — ${chartDataLabel}: ${buckets
          .map((bucket) => `${bucket.label} ${bucket.value.toLocaleString()}`)
          .join('; ')}`}
        summary={{
          caption: chartDataLabel,
          columns: [bucketLabel, currencyLabel],
          rows: buckets.map((bucket) => [bucket.label, bucket.value.toLocaleString()]),
        }}
        option={{
          grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15, 23, 42, 0.04)' } },
            valueFormatter: (value) => `${currencyLabel} ${Number(value).toLocaleString()}`,
          },
          xAxis: {
            type: 'category',
            data: buckets.map((bucket) => bucket.label),
            axisTick: { show: false },
            axisLabel: { ...AXIS_LABEL, hideOverlap: true, fontWeight: 500 },
            axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { ...AXIS_LABEL, formatter: (value: number) => compactNumber(value) },
            splitLine: { lineStyle: { color: CHART_COLORS.grid } },
          },
          series: [
            {
              type: 'bar',
              barWidth: 26,
              barCategoryGap: '35%',
              data: buckets.map((bucket, index) => ({
                value: bucket.value,
                itemStyle: {
                  color: severityStyle(index),
                  borderRadius: [8, 8, 3, 3],
                },
              })),
              // The full-height track makes small buckets readable against the
              // scale of the largest one.
              showBackground: true,
              backgroundStyle: { color: '#f1f5f9', borderRadius: [8, 8, 3, 3] },
              label: {
                show: true,
                position: 'top',
                // `unknown` keeps the ECharts formatter callback happy while the
                // payload stays the plain number we passed in.
                formatter: (params: unknown) => {
                  const value = (params as { value: number }).value;
                  return value > 0 ? compactNumber(Number(value)) : '';
                },
                color: CHART_COLORS.axisLabel,
                fontSize: 10,
                fontWeight: 600,
              },
            },
          ],
        }}
      />
      <ul className="mt-3 space-y-1.5">
        {buckets.map((bucket, index) => (
          <li key={bucket.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
              style={{ background: index === 0 ? CHART_COLORS.gold : index >= buckets.length - 2 ? CHART_COLORS.danger : CHART_COLORS.warning }}
            />
            <span className="truncate text-slate-600">{bucket.label}</span>
            <span className="ml-auto shrink-0 font-medium text-slate-900 tabular">
              {total > 0 ? `${Math.round((bucket.value / total) * 100)}%` : '0%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
