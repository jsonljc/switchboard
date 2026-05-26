/**
 * Relative-time helpers for the inbox queue (ported from the P1-C prototype).
 * Pure functions of an ISO string + a reference "now" (ms) so they stay
 * deterministic and testable — callers pass `Date.now()` in real use.
 */

/** Coarse "Nm/Nh/Nd ago" label for a past timestamp. Empty string for absent input. */
export function relativeTime(iso: string | undefined, nowMs: number): string {
  if (!iso) return "";
  const ms = nowMs - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export type SlaState = "soon" | "normal" | "comfort";

export interface DueInResult {
  label: string;
  state: SlaState;
}

/**
 * SLA countdown for a future deadline. Returns `null` when no deadline is set.
 * Past/equal deadlines read "Overdue" with the most-urgent state.
 */
export function dueIn(iso: string | undefined, nowMs: number): DueInResult | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return { label: "Overdue", state: "soon" };
  const min = Math.round(ms / 60000);
  if (min < 60) return { label: `Due in ${min}m`, state: min < 30 ? "soon" : "normal" };
  const h = Math.round(min / 60);
  return {
    label: `Due in ${h}h`,
    state: h <= 1 ? "soon" : h >= 4 ? "comfort" : "normal",
  };
}

/** "undoable for Xm/Xh" while the undo window is live; null when absent or elapsed. */
export function undoableFor(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `undoable for ${min}m`;
  return `undoable for ${Math.round(min / 60)}h`;
}
