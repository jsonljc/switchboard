import type { CockpitStatus } from "@/components/cockpit/types";
import { RILEY_VARIANTS } from "@/components/cockpit/sprite/riley-variants";
import type { SpriteVariantKey } from "@/components/cockpit/sprite/types";

export const RILEY_ACCENT = {
  base: "#3F8C86" /* teal — identity only, matches --agent-riley hsl(180 33% 40%) */,
  deep: "#215451",
  soft: "#C5DFDD",
  paper: "#EBF5F4",
} as const;

export const RILEY_MISSION_SUBTITLE = "Optimizing Meta Ads";

// Riley's per-state status palette and pulse rule, as specified in the target
// design. NOT wired in B.1: the shared `StatusPill` component hard-imports
// `statusColor`/`statusPulse` from `alex-config` and Riley B.1 doesn't
// parameterize the pill (out of scope — needs Alex A.2/A.3 first). These
// exports are kept so that B.2 can wire them via pill parameterization
// without re-deriving the color/pulse rules. In B.1, Riley renders Alex's
// pill colors at runtime — this is the documented B.1 visual limitation.
export function statusColor(statusKey: CockpitStatus, halted: boolean): string {
  if (halted) return "#A03A2E";
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
// Halted state suppresses pulse — a halted agent should not draw attention
// via animation.
export function statusPulse(statusKey: CockpitStatus, halted: boolean): boolean {
  if (halted) return false;
  return statusKey === "REVIEWING";
}

export const RILEY_COMPOSER_PLACEHOLDER =
  "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…";

export interface RileyCommand {
  id: string;
  label: string;
  group: "control" | "thread" | "rules" | "nav";
}

// Catalog ships as typed data only in B.3. The B.3-followup (after Alex A.5)
// wires these into the shared <CommandPalette>. Order matches the order the
// palette renders groups: nav → rules → control → thread.
export const RILEY_COMMANDS: readonly RileyCommand[] = [
  { id: "open-meta", label: "Open Meta", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "rules" },
  { id: "open-targets", label: "Open targets", group: "rules" },
  { id: "pause-1h", label: "Pause Riley for 1h", group: "control" },
  { id: "resume", label: "Resume Riley", group: "control" },
  { id: "brief-eod", label: "Brief me at EOD", group: "thread" },
  { id: "cpl-30", label: "Show CPL — last 30d", group: "thread" },
];

/** Hardcoded sprite variant for Riley — see spec §6.3. */
export const DEFAULT_RILEY_VARIANT: SpriteVariantKey = "analyst";

export { RILEY_VARIANTS };

/** Map Riley's CockpitStatus into a sprite animation state.
 *  Mirrors alex-config.ts animState; WATCHING/REVIEWING get "draft" because
 *  Riley is actively working; IDLE/WAITING/HALTED other cases handled by the
 *  fallback. (won state is dormant per spec §5.4 — never returned.) */
export function animState(key: CockpitStatus, halted: boolean): "sleep" | "draft" | "idle" {
  if (halted) return "sleep";
  if (key === "WATCHING" || key === "REVIEWING" || key === "WAITING") return "draft";
  return "idle";
}
