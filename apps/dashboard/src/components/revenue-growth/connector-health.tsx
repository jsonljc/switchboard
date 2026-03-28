"use client";

import { cn } from "@/lib/utils";
import type { RevGrowthConnectorHealth } from "@/lib/api-client-types";

interface ConnectorHealthProps {
  connectors: RevGrowthConnectorHealth[];
}

function statusDot(status: string) {
  if (status === "connected") return "bg-positive";
  if (status === "degraded") return "bg-caution";
  return "bg-destructive/60";
}

function statusLabel(status: string) {
  if (status === "connected") return "Connected";
  if (status === "degraded") return "Degraded";
  return "Not connected";
}

export function ConnectorHealth({ connectors }: ConnectorHealthProps) {
  if (connectors.length === 0) {
    return <div className="text-[13px] text-muted-foreground py-4">No connectors configured.</div>;
  }

  return (
    <div className="space-y-3">
      {connectors.map((c) => (
        <div key={c.connectorId} className="flex items-center gap-3">
          {/* Status dot */}
          <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", statusDot(c.status))} />

          {/* Name + status */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-foreground font-medium truncate">{c.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {statusLabel(c.status)}
              {c.lastSyncAt && ` \u00B7 Last sync ${new Date(c.lastSyncAt).toLocaleDateString()}`}
            </p>
          </div>

          {/* Match rate bar */}
          {c.matchRate !== null && (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="w-16 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    c.matchRate >= 0.8
                      ? "bg-positive"
                      : c.matchRate >= 0.5
                        ? "bg-caution"
                        : "bg-destructive",
                  )}
                  style={{ width: `${Math.min(100, c.matchRate * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(c.matchRate * 100)}%
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
