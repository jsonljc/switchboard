"use client";

import { useState } from "react";

interface HealthCheck {
  name: string;
  status: string;
  expected: number;
  actual: number;
  driftPercent: number;
}

interface HealthIndicatorProps {
  status: string;
  lastRun: string | null;
  checks: HealthCheck[];
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  failing: "bg-red-500",
  unknown: "bg-gray-400",
};

const STATUS_TEXT: Record<string, string> = {
  healthy: "All conversion events delivered successfully",
  degraded: "Some events experienced delivery delays",
  failing: "Significant event delivery issues detected",
  unknown: "Reconciliation has not run yet",
};

export function HealthIndicator({ status, lastRun, checks }: HealthIndicatorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        Data Health
        <span
          className={`inline-block h-3 w-3 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.unknown}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-80 rounded-lg border bg-card p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium">{STATUS_TEXT[status] ?? STATUS_TEXT.unknown}</p>
          {lastRun && (
            <p className="mb-2 text-xs text-muted-foreground">
              Last checked: {new Date(lastRun).toLocaleString()}
            </p>
          )}
          {!lastRun && (
            <p className="mb-2 text-xs text-muted-foreground">
              Reconciliation has not run in 48 hours — numbers may be stale
            </p>
          )}
          {checks.length > 0 && (
            <ul className="space-y-1 text-xs">
              {checks.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className={c.status === "pass" ? "text-green-600" : "text-red-600"}>
                    {c.status} ({c.driftPercent}% drift)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
