// apps/dashboard/src/components/cockpit/status-pill.tsx
import { Dot } from "./dot";
import { statusColor, statusPulse } from "@/lib/cockpit/alex-config";
import type { CockpitStatus } from "./types";

export interface StatusPillProps {
  statusKey: CockpitStatus;
  halted: boolean;
}

export function StatusPill({ statusKey, halted }: StatusPillProps) {
  const color = statusColor(statusKey, halted);
  const pulse = statusPulse(statusKey, halted);
  const label = halted ? "HALTED" : statusKey;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Dot color={color} pulse={pulse} />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </span>
  );
}
