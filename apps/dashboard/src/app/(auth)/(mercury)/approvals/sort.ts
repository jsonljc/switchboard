import type { ApprovalRow } from "./types";

const PIN_THRESHOLD_MS = 5 * 60_000;

/**
 * Sort by `expiresAt` ascending with `createdAt` ascending tiebreak.
 *
 * If a reference `now` is provided, rows with `riskCategory === "critical"`
 * whose remaining time is under PIN_THRESHOLD_MS are pinned to the top of
 * the result (still ordered by expiresAt among themselves). This combines
 * "what's about to time out?" and "what's the riskiest?" into a single
 * default view.
 *
 * Pure function; does not mutate input.
 */
export function sortApprovals(rows: readonly ApprovalRow[], now?: number): ApprovalRow[] {
  // Pin logic is strictly opt-in. Callers without a `now` argument get pure
  // expiring-soonest behavior — this prevents accidental order changes in
  // callsites that don't yet thread the live clock through.
  const isPinned =
    typeof now === "number"
      ? (r: ApprovalRow) =>
          r.riskCategory === "critical" && new Date(r.expiresAt).getTime() - now < PIN_THRESHOLD_MS
      : () => false;

  return [...rows].sort((a, b) => {
    const pa = isPinned(a);
    const pb = isPinned(b);
    if (pa !== pb) return pa ? -1 : 1;
    const ta = new Date(a.expiresAt).getTime();
    const tb = new Date(b.expiresAt).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
