import type { ApprovalRow } from "./types";

/**
 * Sort by expiresAt ascending, with createdAt as tiebreak.
 *
 * Critical-pinned variant is added in Phase 1 once live countdown lands.
 * Pure function; does not mutate input.
 */
export function sortApprovals(rows: readonly ApprovalRow[]): ApprovalRow[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.expiresAt).getTime();
    const tb = new Date(b.expiresAt).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
