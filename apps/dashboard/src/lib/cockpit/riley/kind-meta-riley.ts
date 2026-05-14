import type { ActivityKind } from "@/components/cockpit/types";

type RileyActivityKind = Extract<
  ActivityKind,
  | "watching"
  | "reviewing"
  | "paused"
  | "scaled"
  | "rotated"
  | "shifted"
  | "restructured"
  | "started"
  | "alert"
>;

interface KindMetaEntry {
  label: string;
  color: string;
  pulse: boolean;
}

export const RILEY_KIND_META: Record<RileyActivityKind, KindMetaEntry> = {
  watching: { label: "WATCHING", color: "#3F7A36", pulse: false },
  reviewing: { label: "REVIEWING", color: "#7C4F1C", pulse: true },
  paused: { label: "PAUSED", color: "#6B6052", pulse: false },
  scaled: { label: "SCALED", color: "#3F7A36", pulse: false },
  rotated: { label: "ROTATED", color: "#3A5A80", pulse: false },
  shifted: { label: "SHIFTED", color: "#3A5A80", pulse: false },
  restructured: { label: "RESTRUCTURED", color: "#3A5A80", pulse: false },
  started: { label: "STARTED", color: "#6B6052", pulse: false },
  alert: { label: "ALERT", color: "#A03A2E", pulse: false },
};
