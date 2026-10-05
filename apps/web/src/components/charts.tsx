'use client';

/**
 * Apache ECharts wrappers.
 *
 * ECharts is imperative and touches `window`, so it is initialised inside an
 * effect and disposed on unmount. Charts receive plain numbers and pre-formatted
 * labels: no calendar or money logic lives in a chart.
 */

import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

export type EChartsOption = echarts.EChartsOption;

export function EChart({ option, height = 260 }: { option: EChartsOption; height?: number }) {
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

  return <div ref={container} style={{ height }} className="w-full" />;
}

/** Expected rent vs collected, for the dashboard. */
export function MoneyComparisonChart({
  expected,
  collected,
  currencyLabel,
}: {
  expected: number;
  collected: number;
  currencyLabel: string;
}) {
  return (
    <EChart
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value) => `${currencyLabel} ${Number(value).toLocaleString()}`,
        },
        xAxis: { type: 'category', data: ['Expected', 'Collected'] },
        yAxis: { type: 'value', axisLabel: { formatter: (value: number) => value.toLocaleString() } },
        series: [
          {
            type: 'bar',
            data: [
              { value: expected, itemStyle: { color: '#1d6753' } },
              { value: collected, itemStyle: { color: '#e8b22b' } },
            ],
            barWidth: '45%',
            label: {
              show: true,
              position: 'top',
              formatter: (params: { value?: unknown }) => Number(params.value ?? 0).toLocaleString(),
            },
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
}: {
  labels: string[];
  values: number[];
  currencyLabel: string;
}) {
  return (
    <EChart
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value) => `${currencyLabel} ${Number(value).toLocaleString()}`,
        },
        xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
        yAxis: { type: 'value', axisLabel: { formatter: (value: number) => value.toLocaleString() } },
        series: [
          {
            type: 'line',
            smooth: true,
            symbolSize: 6,
            data: values,
            areaStyle: { color: 'rgba(29, 103, 83, 0.12)' },
            lineStyle: { color: '#1d6753', width: 2 },
            itemStyle: { color: '#1d6753' },
          },
        ],
      }}
    />
  );
}

/** Occupancy by property: a horizontal stacked bar, one row per property. */
export function OccupancyChart({ rows }: { rows: { name: string; occupied: number; vacant: number }[] }) {
  return (
    <EChart
      height={Math.max(180, rows.length * 44)}
      option={{
        grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: {
          data: ['Occupied', 'Vacant'],
          top: 0,
          right: 0,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 10 },
        },
        xAxis: { type: 'value', minInterval: 1 },
        yAxis: { type: 'category', data: rows.map((row) => row.name) },
        series: [
          {
            name: 'Occupied',
            type: 'bar',
            stack: 'units',
            data: rows.map((row) => row.occupied),
            itemStyle: { color: '#1d6753' },
          },
          {
            name: 'Vacant',
            type: 'bar',
            stack: 'units',
            data: rows.map((row) => row.vacant),
            itemStyle: { color: '#cbd5e1' },
          },
        ],
      }}
    />
  );
}

/** Arrears aging: how old the unpaid rent is. */
export function ArrearsChart({ buckets }: { buckets: { label: string; value: number }[] }) {
  return (
    <EChart
      option={{
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (value) => Number(value).toLocaleString() },
        xAxis: { type: 'category', data: buckets.map((bucket) => bucket.label), axisLabel: { fontSize: 10 } },
        yAxis: { type: 'value', axisLabel: { formatter: (value: number) => value.toLocaleString() } },
        series: [
          {
            type: 'bar',
            barWidth: '50%',
            data: buckets.map((bucket, index) => ({
              value: bucket.value,
              itemStyle: { color: index === 0 ? '#e8b22b' : index >= 3 ? '#dc2626' : '#f59e0b' },
            })),
          },
        ],
      }}
    />
  );
}
