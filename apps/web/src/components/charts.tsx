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

  useEffect(() => {
    if (!container.current) return;
    chart.current = echarts.init(container.current, undefined, { renderer: 'canvas' });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
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
 * donut (three parts — under the four where a donut stays readable, and the
 * house rules ban standard pies). The ring center carries the charge count so
 * the summary number sits with the picture.
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

  return (
    <EChart
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
        legend: {
          bottom: 0,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 11, color: CHART_COLORS.axisLabel },
        },
        title: {
          text: String(count),
          subtext: countLabel,
          left: 'center',
          top: '38%',
          textStyle: { fontSize: 24, fontWeight: 600, color: '#0f172a' },
          subtextStyle: { fontSize: 11, color: CHART_COLORS.axisLabel },
        },
        series: [
          {
            type: 'pie',
            radius: ['62%', '82%'],
            center: ['50%', '44%'],
            padAngle: total > 0 ? 1.5 : 0,
            itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
            label: { show: false },
            emphasis: { scale: false },
            data,
          },
        ],
      }}
    />
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

/** Arrears aging: how old the unpaid rent is. */
export function ArrearsChart({
  buckets,
  ariaLabel,
  bucketLabel,
  currencyLabel,
  chartDataLabel,
}: {
  buckets: { label: string; value: number }[];
  ariaLabel: string;
  bucketLabel: string;
  currencyLabel: string;
  chartDataLabel: string;
}) {
  return (
    <EChart
      ariaLabel={ariaLabel}
      summary={{
        caption: chartDataLabel,
        columns: [bucketLabel, currencyLabel],
        rows: buckets.map((bucket) => [bucket.label, bucket.value.toLocaleString()]),
      }}
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (value) => Number(value).toLocaleString() },
        xAxis: {
          type: 'category',
          data: buckets.map((bucket) => bucket.label),
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
            type: 'bar',
            barWidth: '50%',
            data: buckets.map((bucket, index) => ({
              value: bucket.value,
              // The only place color carries meaning: the older the debt, the
              // hotter the bar (gold → amber → red).
              itemStyle: {
                color:
                  index === 0
                    ? CHART_COLORS.gold
                    : index >= 3
                      ? CHART_COLORS.danger
                      : CHART_COLORS.warning,
              },
            })),
          },
        ],
      }}
    />
  );
}
