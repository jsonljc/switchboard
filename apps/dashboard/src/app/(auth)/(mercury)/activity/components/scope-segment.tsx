"use client";

import styles from "../activity.module.css";

export type ScopeBase = "operational" | "all";
export type EffectiveScope = ScopeBase | "custom";

export interface ScopeSegmentProps {
  /** The server-derived effective scope. "custom" when any narrowing is active. */
  effectiveScope: EffectiveScope;
  /** The operator's base scope choice (Operational or All). Drives aria-pressed. */
  baseScope: ScopeBase;
  /** Page-local count for the Operational scope (operational rows on this page). */
  operationalCount: number;
  /** Page-local count for the All scope (all rows on this page). */
  allCount: number;
  /** Fired when the operator clicks one of the two real buttons. */
  onChange: (next: ScopeBase) => void;
}

/**
 * Two-button hairline segmented control + inline `· Custom` status badge.
 *
 * Spec §5.2 + §2.3: the badge is server-auto-derived from `appliedFilters`
 * non-emptiness. It is NOT a button — no click handler, no role="button",
 * aria-hidden so screen readers don't try to announce it (narrowing
 * affordances already announce active filters). The active highlight
 * (aria-pressed + .scopeSegmentBtnOn) follows the operator's base scope,
 * not the effective scope — so the group reads as "Operational, plus
 * narrowing" rather than "Custom alone".
 */
export function ScopeSegment({
  effectiveScope,
  baseScope,
  operationalCount,
  allCount,
  onChange,
}: ScopeSegmentProps) {
  return (
    <>
      <span className={styles.filterStripEyebrow}>scope</span>
      <div className={styles.scopeSegment} role="group" aria-label="Activity scope">
        <button
          type="button"
          className={
            baseScope === "operational"
              ? `${styles.scopeSegmentBtn} ${styles.scopeSegmentBtnOn}`
              : styles.scopeSegmentBtn
          }
          aria-pressed={baseScope === "operational"}
          onClick={() => onChange("operational")}
        >
          Operational
          <span className={styles.scopeSegmentCount}>{operationalCount}</span>
        </button>
        <button
          type="button"
          className={
            baseScope === "all"
              ? `${styles.scopeSegmentBtn} ${styles.scopeSegmentBtnOn}`
              : styles.scopeSegmentBtn
          }
          aria-pressed={baseScope === "all"}
          onClick={() => onChange("all")}
        >
          All
          <span className={styles.scopeSegmentCount}>{allCount}</span>
        </button>
      </div>
      {effectiveScope === "custom" && (
        <span className={styles.customBadge} aria-hidden="true">
          <span data-testid="custom-dot" className={styles.customDot} />· Custom
        </span>
      )}
    </>
  );
}
