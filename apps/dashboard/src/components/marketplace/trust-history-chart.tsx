"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

interface TrustPoint {
  timestamp: string;
  score: number;
}

interface TrustHistoryChartProps {
  data: TrustPoint[];
  totalApprovals: number;
  totalRejections: number;
  currentStreak: number;
  highestScore: number;
}

export function TrustHistoryChart({
  data,
  totalApprovals,
  totalRejections,
  currentStreak,
  highestScore,
}: TrustHistoryChartProps) {
  return (
    <div className="space-y-6">
      {/* Sparkline */}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="timestamp" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              labelFormatter={(ts) =>
                new Date(ts as string).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              }
              formatter={(value: number) => [`${value}`, "Trust Score"]}
              contentStyle={{
                backgroundColor: "hsl(var(--surface))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: "0.875rem",
              }}
            />
            <Line
              type="stepAfter"
              dataKey="score"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--foreground))" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Approvals", value: totalApprovals },
          { label: "Rejections", value: totalRejections },
          { label: "Current streak", value: currentStreak },
          { label: "Highest score", value: highestScore },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="font-mono text-lg tabular-nums">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Auto-approval note */}
      <p className="text-xs text-muted-foreground border-t border-border pt-4">
        Tasks are auto-approved when trust exceeds 30.
      </p>
    </div>
  );
}
