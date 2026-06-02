// apps/dashboard/src/lib/cockpit/alex-config.ts
import { T, type AccentTokens } from "@/components/cockpit/tokens";
import type { CockpitStatus } from "@/components/cockpit/types";
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";
import type { SpriteVariantKey } from "@/components/cockpit/sprite/types";

export const ALEX_CONFIG = {
  name: "Alex",
  accent: {
    base: "hsl(var(--agent-alex))" /* coral — identity only */,
    deep: "hsl(var(--agent-alex-deep))",
    soft: "hsl(var(--agent-alex) / 0.30)",
    paper: "hsl(var(--agent-alex-tint))",
  },
  missionSubtitle: "SDR · Consultations pipeline",
  needsYouLabel: "Alex needs you",
} as const;

/**
 * Alex's approval-card accent — the action amber (identity stays coral).
 * Relocated here from the deleted cockpit/approval-card in T2; consumed by
 * inbox-agent-avatar. Values follow the action primitive via T.
 */
export const ALEX_APPROVAL_ACCENT: AccentTokens = {
  base: T.amber,
  deep: T.amberDeep,
  soft: T.amberSoft,
  paper: T.amberPaper,
};

export function statusColor(key: CockpitStatus, halted: boolean): string {
  if (halted) return T.red;
  if (key === "WORKING" || key === "TALKING") return T.green;
  if (key === "WAITING") return T.amber;
  return T.ink4;
}

export function statusPulse(key: CockpitStatus, halted: boolean): boolean {
  if (halted) return false;
  return key === "WORKING" || key === "WAITING" || key === "TALKING";
}

export function animState(key: CockpitStatus, halted: boolean): "sleep" | "draft" | "idle" {
  if (halted) return "sleep";
  if (key === "WORKING" || key === "WAITING" || key === "TALKING") return "draft";
  return "idle";
}

/** Hardcoded sprite variant for Alex — see spec §6.3 (intentional, not a missing
 *  Settings feature). Operators do not pick this; a future per-operator picker
 *  is post-launch. */
export const DEFAULT_ALEX_VARIANT: SpriteVariantKey = "classic";

export { ALEX_VARIANTS };
