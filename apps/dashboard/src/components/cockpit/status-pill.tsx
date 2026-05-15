// apps/dashboard/src/components/cockpit/status-pill.tsx
import { Dot } from "./dot";
import {
  statusColor as defaultStatusColor,
  statusPulse as defaultStatusPulse,
} from "@/lib/cockpit/alex-config";
import type { CockpitStatus } from "./types";

export interface StatusPillProps {
  statusKey: CockpitStatus;
  halted: boolean;
  colorFor?: (s: CockpitStatus, halted: boolean) => string;
  pulseFor?: (s: CockpitStatus, halted: boolean) => boolean;
}

export function StatusPill({
  statusKey,
  halted,
  colorFor = defaultStatusColor,
  pulseFor = defaultStatusPulse,
}: StatusPillProps) {
  const color = colorFor(statusKey, halted);
  const pulse = pulseFor(statusKey, halted);
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
