"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface MetricDelta {
  metric: string;
  current: number;
  previous: number;
  deltaPercent: number;
  direction: string;
  significant: boolean;
}

interface MetricTrendChartProps {
  periodDeltas: MetricDelta[];
}

const METRIC_LABELS: Record<string, string> = {
  cpm: "CPM",
  ctr: "CTR",
  cpc: "CPC",
  cpl: "CPL",
  cpa: "CPA",
  roas: "ROAS",
  frequency: "Frequency",
};

const METRIC_FORMATS: Record<string, (v: number) => string> = {
  cpm: (v) => `$${v.toFixed(2)}`,
  ctr: (v) => `${v.toFixed(1)}%`,
  cpc: (v) => `$${v.toFixed(2)}`,
  cpl: (v) => `$${v.toFixed(0)}`,
  cpa: (v) => `$${v.toFixed(0)}`,
  roas: (v) => `${v.toFixed(1)}x`,
  frequency: (v) => v.toFixed(1),
};

function getDeltaColor(delta: MetricDelta): string {
  if (!delta.significant) return "text-muted-foreground";
  // For cost metrics, "up" is bad; for ROAS, "up" is good
  const costMetrics = ["cpm", "cpc", "cpl", "cpa"];
  const isGood = costMetrics.includes(delta.metric)
    ? delta.direction === "down"
    : delta.direction === "up";
  return isGood ? "text-positive" : "text-negative";
}

export function MetricTrendChart({ periodDeltas }: MetricTrendChartProps) {
  // Build chart data: each metric gets a row with "Previous" and "Current" columns
  const chartData = periodDeltas.map((d) => ({
    metric: METRIC_LABELS[d.metric] ?? d.metric,
    previous: d.previous,
    current: d.current,
  }));

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold mb-4">Period Comparison</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {periodDeltas.map((d) => {
          const format = METRIC_FORMATS[d.metric] ?? ((v: number) => v.toFixed(1));
          const deltaColor = getDeltaColor(d);
          const arrow = d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→";
          return (
            <div key={d.metric} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {METRIC_LABELS[d.metric] ?? d.metric}
              </p>
              <p className="text-xl font-bold">{format(d.current)}</p>
              <p className={`text-sm ${deltaColor}`}>
                {arrow} {Math.abs(d.deltaPercent).toFixed(1)}%
                <span className="text-muted-foreground ml-1">vs {format(d.previous)}</span>
              </p>
            </div>
          );
        })}
      </div>

      {chartData.length > 0 && (
        <div className="mt-6 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 12 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--surface))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                name="Previous"
              />
              <Line
                type="monotone"
                dataKey="current"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                name="Current"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
