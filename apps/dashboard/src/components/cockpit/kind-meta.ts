// apps/dashboard/src/components/cockpit/kind-meta.ts
import { T } from "./tokens";
import type { ActivityKind } from "./types";

export interface KindMetaEntry {
  label: string;
  color: string;
  bg: string;
  pulse?: boolean;
}

// A.1 shipped Alex kinds; Riley B.1 adds the 8 additional kinds Riley emits
// (`started` is shared with Alex and unchanged). All kinds are typed in
// `ActivityKind` so the shell never crashes on an unknown row.
export const KIND_META: Partial<Record<ActivityKind, KindMetaEntry>> = {
  // Alex
  booked: { label: "BOOKED", color: T.amberDeep, bg: T.amberSoft },
  qualified: { label: "QUALIFIED", color: T.amber, bg: T.amberSoft },
  replied: { label: "REPLIED", color: T.ink2, bg: "rgba(14,12,10,0.05)" },
  sent: { label: "SENT", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  started: { label: "STARTED", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  connected: { label: "LEADS IN", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  waiting: { label: "WAITING", color: T.amberDeep, bg: T.amberSoft },
  escalated: { label: "TO YOU", color: T.red, bg: "rgba(160,58,46,0.08)" },
  passed: { label: "PASSED", color: T.ink4, bg: "rgba(14,12,10,0.04)" },
  // Riley
  watching: { label: "WATCHING", color: T.green, bg: "rgba(63,122,54,0.08)" },
  reviewing: { label: "REVIEWING", color: T.amberDeep, bg: T.amberSoft, pulse: true },
  paused: { label: "PAUSED", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  scaled: { label: "SCALED", color: T.green, bg: "rgba(63,122,54,0.08)" },
  rotated: { label: "ROTATED", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  shifted: { label: "SHIFTED", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  restructured: { label: "RESTRUCTURED", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  alert: { label: "ALERT", color: T.red, bg: "rgba(160,58,46,0.08)" },
  // PR-3 outcome rows: quiet treatment — neutral muted color, no pulse.
  // "OBSERVED" mirrors the "watching" register but visually softer (ink4 vs green)
  // so outcome attributions read as historical data, not live-watch signals.
  observed: { label: "OBSERVED", color: T.ink4, bg: "rgba(14,12,10,0.04)" },
};

const NEUTRAL_FALLBACK: KindMetaEntry = {
  label: "",
  color: T.ink3,
  bg: "rgba(14,12,10,0.04)",
};

// Centralized lookup so renderers never have to handle the Partial<> nullability
// at call sites. Unknown kinds (e.g. a Riley row leaking into Alex's stream
// before Riley's PR lands) render with the uppercased kind name and neutral
// styling — no crash.
export function lookupKindMeta(kind: ActivityKind): KindMetaEntry {
  const entry = KIND_META[kind];
  if (entry) return entry;
  return { ...NEUTRAL_FALLBACK, label: kind.toUpperCase() };
}
