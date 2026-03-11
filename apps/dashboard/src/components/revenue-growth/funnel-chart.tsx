"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface FunnelStage {
  name: string;
  value: number;
}

interface FunnelChartProps {
  stages: FunnelStage[];
}

const COLORS = [
  "hsl(var(--positive))",
  "hsl(var(--positive) / 0.8)",
  "hsl(var(--caution))",
  "hsl(var(--caution) / 0.7)",
  "hsl(var(--destructive) / 0.7)",
];

function dropOffLabel(stages: FunnelStage[], index: number): string {
  if (index === 0 || stages[index - 1].value === 0) return "";
  const drop = ((stages[index - 1].value - stages[index].value) / stages[index - 1].value) * 100;
  return `-${drop.toFixed(0)}%`;
}

export function FunnelChart({ stages }: FunnelChartProps) {
  if (stages.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground py-8 text-center">No funnel data yet.</div>
    );
  }

  const data = stages.map((s, i) => ({
    ...s,
    dropOff: dropOffLabel(stages, i),
  }));

  return (
    <div className="w-full h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 5, bottom: 5 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={90}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
            <LabelList
              dataKey="dropOff"
              position="right"
              style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
