"use client";
import styles from "../reports.module.css";
import type { ReportWindow } from "@switchboard/schemas";

export type RefreshState = "idle" | "refreshing" | "still-loading";

export interface PageHeadProps {
  dateFolio: string | null;
  activeWindow: ReportWindow;
  onSelectWindow: (w: ReportWindow) => void;
  onRefresh: () => void;
  refreshState?: RefreshState;
  cacheAge?: number | null;
}

const WINDOWS: ReportWindow[] = ["THIS WEEK", "THIS MONTH", "THIS QUARTER"];

function refreshLabel(state: RefreshState): string {
  if (state === "refreshing") return "Refreshing…";
  if (state === "still-loading") return "Still loading…";
  return "Refresh";
}

function cacheAgeLabel(age: number | null | undefined): string {
  if (age == null) return "—";
  if (age === 0) return "just now";
  return `${age}m ago`;
}

export function PageHead({
  dateFolio,
  activeWindow,
  onSelectWindow,
  onRefresh,
  refreshState = "idle",
  cacheAge = null,
}: PageHeadProps) {
  const inFlight = refreshState !== "idle";

  return (
    <div className={styles.pageHead}>
      <div className={styles.lead}>
        <span className={styles.eyebrow}>Statement</span>
        <h1 className={styles.pageTitle}>
          Operator&apos;s <span className={styles.accent}>Statement.</span>
        </h1>
        <p className={styles.pageSub}>
          A renewal-checkpoint reading of what your two agents earned you this period, what they
          cost, and what the equivalent in headcount would have run. Read top to bottom — the cost
          arithmetic sits near the end on purpose.
        </p>
      </div>
      <div className={styles.right}>
        <span className={styles.dateFolio} data-testid="dateFolio">
          {dateFolio ?? "—"}
        </span>
        <div className={styles.windowSeg} role="group" aria-label="Report window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={activeWindow === w ? styles.on : ""}
              aria-pressed={activeWindow === w}
              onClick={() => onSelectWindow(w)}
            >
              {w}
            </button>
          ))}
        </div>
        <div className={styles.recompute}>
          <button
            type="button"
            className={`${styles.btn} ${inFlight ? styles.spinning : ""}`}
            onClick={onRefresh}
            disabled={inFlight}
          >
            {inFlight && <span className={styles.spinner} />}
            {refreshLabel(refreshState)}
          </button>
          <span>
            cached <b>{cacheAgeLabel(cacheAge)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
