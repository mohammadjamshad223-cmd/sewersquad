"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Chart tokens. Series colors come from the validated reference categorical palette
 * (the brand navy is too dark/desaturated to read as a data mark). Text uses ink tokens.
 */
const SERIES_1 = "#2a78d6";
const GRID = "#e8eaee";
const INK_SECONDARY = "#52514e";

type Fmt = "cents" | "gallons" | "number";
function fmt(v: number, f: Fmt, compact = false) {
  if (f === "cents") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(v / 100);
  const n = new Intl.NumberFormat("en-US", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(v);
  return f === "gallons" ? `${n} gal` : n;
}

function TooltipBox({ active, payload, label, format, seriesName }: { active?: boolean; payload?: { value: number }[]; label?: string; format: Fmt; seriesName: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-surface px-3 py-2 text-[12px] shadow-pop">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-0.5 flex items-center gap-2 text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: SERIES_1 }} aria-hidden />
        {seriesName}: <span className="font-medium tabular-nums text-foreground">{fmt(payload[0]!.value, format)}</span>
      </p>
    </div>
  );
}

function DataTable({ data, xKey, yKey, format, seriesName }: { data: Record<string, unknown>[]; xKey: string; yKey: string; format: Fmt; seriesName: string }) {
  return (
    <details className="mt-2 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">Period</th>
            <th className="py-1 text-right font-medium">{seriesName}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((d, i) => (
            <tr key={i}>
              <td className="py-1">{String(d[xKey])}</td>
              <td className="py-1 text-right tabular-nums">{fmt(Number(d[yKey]), format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const axisProps = { tick: { fill: INK_SECONDARY, fontSize: 11 }, tickLine: false, axisLine: false } as const;

export function BarSeries({ data, xKey, yKey, format = "number", seriesName, height = 220 }: { data: Record<string, unknown>[]; xKey: string; yKey: string; format?: Fmt; seriesName: string; height?: number }) {
  if (data.length === 0 || data.every((d) => !Number(d[yKey]))) return <p className="py-10 text-center text-[13px] text-muted-foreground">No data for this period.</p>;
  return (
    <div>
      <div style={{ height }} role="img" aria-label={`${seriesName} bar chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} {...axisProps} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmt(v, format, true)} />
            <Tooltip cursor={{ fill: "rgba(42,120,214,0.08)" }} content={<TooltipBox format={format} seriesName={seriesName} />} />
            <Bar dataKey={yKey} fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} xKey={xKey} yKey={yKey} format={format} seriesName={seriesName} />
    </div>
  );
}

export function LineSeries({ data, xKey, yKey, format = "number", seriesName, height = 220 }: { data: Record<string, unknown>[]; xKey: string; yKey: string; format?: Fmt; seriesName: string; height?: number }) {
  if (data.length === 0) return <p className="py-10 text-center text-[13px] text-muted-foreground">No data for this period.</p>;
  return (
    <div>
      <div style={{ height }} role="img" aria-label={`${seriesName} line chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} {...axisProps} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmt(v, format, true)} />
            <Tooltip cursor={{ stroke: INK_SECONDARY, strokeDasharray: "3 3" }} content={<TooltipBox format={format} seriesName={seriesName} />} />
            <Line dataKey={yKey} stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} xKey={xKey} yKey={yKey} format={format} seriesName={seriesName} />
    </div>
  );
}

/** Ranked horizontal bars as plain HTML: direct-labeled, readable at any width. */
export function RankedBars({ rows, format = "cents" }: { rows: { name: string; value: number }[]; format?: Fmt }) {
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-muted-foreground">No data for this period.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name} className="text-[13px]" title={`${r.name}: ${fmt(r.value, format)}`}>
          <div className="flex justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(r.value, format)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-subtle">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: SERIES_1 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
