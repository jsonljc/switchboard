// apps/dashboard/src/components/cockpit/kind-meta.ts
import { T } from "./tokens";
import type { ActivityKind } from "./types";

export interface KindMetaEntry {
  label: string;
  color: string;
  bg: string;
  pulse?: boolean;
}

// A.1 ships Alex kinds only. Riley kinds (watching / reviewing / paused / scaled
// / rotated / shifted / restructured / alert) are typed in ActivityKind for
// shell prop-type compatibility but are NOT populated here. Riley's PR adds the
// entries when it wires Riley's activity stream.
export const KIND_META: Partial<Record<ActivityKind, KindMetaEntry>> = {
  booked: { label: "BOOKED", color: T.amberDeep, bg: T.amberSoft },
  qualified: { label: "QUALIFIED", color: T.amber, bg: T.amberSoft },
  replied: { label: "REPLIED", color: T.ink2, bg: "rgba(14,12,10,0.05)" },
  sent: { label: "SENT", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  started: { label: "STARTED", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  connected: { label: "LEADS IN", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  waiting: { label: "WAITING", color: T.amberDeep, bg: T.amberSoft },
  escalated: { label: "TO YOU", color: T.red, bg: "rgba(160,58,46,0.08)" },
  passed: { label: "PASSED", color: T.ink4, bg: "rgba(14,12,10,0.04)" },
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
