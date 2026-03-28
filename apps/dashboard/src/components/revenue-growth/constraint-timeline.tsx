"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { RevGrowthScorerOutput } from "@/lib/api-client-types";

interface CyclePoint {
  cycleIndex: number;
  label: string;
  signal: number;
  creative: number;
  funnel: number;
  sales: number;
  headroom: number;
}

interface ConstraintTimelineProps {
  history: Array<{
    cycleId: string;
    scorerOutputs: RevGrowthScorerOutput[];
    completedAt: string;
  }>;
  primaryConstraintType?: string | null;
}

const CONSTRAINT_COLORS: Record<string, string> = {
  SIGNAL: "hsl(var(--positive))",
  CREATIVE: "hsl(var(--caution))",
  FUNNEL: "hsl(var(--destructive))",
  SALES: "hsl(210, 60%, 55%)",
  SATURATION: "hsl(280, 50%, 55%)",
};

function extractScore(outputs: RevGrowthScorerOutput[], type: string): number {
  return outputs.find((o) => o.constraintType === type)?.score ?? 0;
}

export function ConstraintTimeline({ history, primaryConstraintType }: ConstraintTimelineProps) {
  if (history.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground py-8 text-center">
        No diagnostic history yet. Run a diagnostic to see constraint trends.
      </div>
    );
  }

  const data: CyclePoint[] = history.map((cycle, i) => ({
    cycleIndex: i + 1,
    label: `Cycle ${i + 1}`,
    signal: extractScore(cycle.scorerOutputs, "SIGNAL"),
    creative: extractScore(cycle.scorerOutputs, "CREATIVE"),
    funnel: extractScore(cycle.scorerOutputs, "FUNNEL"),
    sales: extractScore(cycle.scorerOutputs, "SALES"),
    headroom: extractScore(cycle.scorerOutputs, "SATURATION"),
  }));

  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            dataKey="signal"
            name="Signal"
            stroke={CONSTRAINT_COLORS.SIGNAL}
            strokeWidth={primaryConstraintType === "SIGNAL" ? 3 : 1.5}
            dot={{ r: primaryConstraintType === "SIGNAL" ? 4 : 2 }}
          />
          <Line
            dataKey="creative"
            name="Creative"
            stroke={CONSTRAINT_COLORS.CREATIVE}
            strokeWidth={primaryConstraintType === "CREATIVE" ? 3 : 1.5}
            dot={{ r: primaryConstraintType === "CREATIVE" ? 4 : 2 }}
          />
          <Line
            dataKey="funnel"
            name="Funnel"
            stroke={CONSTRAINT_COLORS.FUNNEL}
            strokeWidth={primaryConstraintType === "FUNNEL" ? 3 : 1.5}
            dot={{ r: primaryConstraintType === "FUNNEL" ? 4 : 2 }}
          />
          <Line
            dataKey="sales"
            name="Sales"
            stroke={CONSTRAINT_COLORS.SALES}
            strokeWidth={primaryConstraintType === "SALES" ? 3 : 1.5}
            dot={{ r: primaryConstraintType === "SALES" ? 4 : 2 }}
          />
          <Line
            dataKey="headroom"
            name="Headroom"
            stroke={CONSTRAINT_COLORS.SATURATION}
            strokeWidth={primaryConstraintType === "SATURATION" ? 3 : 1.5}
            dot={{ r: primaryConstraintType === "SATURATION" ? 4 : 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
