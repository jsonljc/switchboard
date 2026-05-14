import type { CockpitStatus } from "@/components/cockpit/types";

export const RILEY_ACCENT = {
  base: "#B86C50",
  deep: "#7E4533",
  soft: "#ECD4C8",
  paper: "#F6E7DE",
} as const;

export const RILEY_TABS = [
  { key: "alex" as const, label: "Alex", state: "inactive" as const },
  { key: "riley" as const, label: "Riley", state: "active" as const },
  { key: "mira" as const, label: "Mira", state: "muted" as const },
];

export const RILEY_MISSION_SUBTITLE = "Optimizing Meta Ads";

export function statusColor(statusKey: CockpitStatus): string {
  switch (statusKey) {
    case "WATCHING":
      return "#3F7A36";
    case "REVIEWING":
      return "#B8782E";
    case "WAITING":
      return "#B8782E";
    case "HALTED":
      return "#A03A2E";
    default:
      return "#A39786";
  }
}

// REVIEWING is the only state that pulses. WAITING is amber-but-static per
// slicing spec B.1 acceptance criterion 3. REVIEWING is type-shipped but
// not derivation-wired in B.1.
export function statusPulse(statusKey: CockpitStatus): boolean {
  return statusKey === "REVIEWING";
}
