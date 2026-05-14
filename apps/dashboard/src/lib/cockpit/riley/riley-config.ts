import type { CockpitStatus } from "@/components/cockpit/types";
import type { TopbarTab } from "@/components/cockpit/topbar";

export const RILEY_ACCENT = {
  base: "#B86C50",
  deep: "#7E4533",
  soft: "#ECD4C8",
  paper: "#F6E7DE",
} as const;

// Topbar tab order with Riley active. Matches the TopbarTab shape so the page
// can pass `tabs={RILEY_TABS}` directly.
export const RILEY_TABS: readonly TopbarTab[] = [
  { name: "Alex" },
  { name: "Riley", active: true },
  { name: "Mira", muted: true },
];

export const RILEY_MISSION_SUBTITLE = "Optimizing Meta Ads";

// Riley's per-state status palette and pulse rule, as specified in the target
// design. NOT wired in B.1: the shared `StatusPill` component hard-imports
// `statusColor`/`statusPulse` from `alex-config` and Riley B.1 doesn't
// parameterize the pill (out of scope — needs Alex A.2/A.3 first). These
// exports are kept so that B.2 can wire them via pill parameterization
// without re-deriving the color/pulse rules. In B.1, Riley renders Alex's
// pill colors at runtime — this is the documented B.1 visual limitation.
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

// REVIEWING is the only state that pulses; WAITING is amber-but-static per
// the slicing spec. REVIEWING is type-shipped but not derivation-wired in B.1.
export function statusPulse(statusKey: CockpitStatus): boolean {
  return statusKey === "REVIEWING";
}
