// apps/dashboard/src/lib/cockpit/alex-config.ts
import { T } from "@/components/cockpit/tokens";
import type { CockpitStatus } from "@/components/cockpit/types";

export const ALEX_CONFIG = {
  name: "Alex",
  accent: {
    base: "#B8782E",
    deep: "#7C4F1C",
    soft: "#F1E2C2",
    paper: "#FBF1D6",
  },
  // Mira intentionally has no href: no `/mira` route exists in apps/dashboard
  // (verified via `ls apps/dashboard/src/app/(auth)/`). Without href the tab
  // renders as a non-routing muted span — clicking does nothing, matching the
  // pre-existing visual "muted" affordance.
  tabs: [
    { name: "Alex", active: true, href: "/alex" },
    { name: "Riley", href: "/riley" },
    { name: "Mira", muted: true },
  ] as const,
  missionSubtitle: "SDR · Consultations pipeline",
  needsYouLabel: "Alex needs you",
} as const;

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
