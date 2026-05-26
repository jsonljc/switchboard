"use client";

import { type ReportWindow, REPORT_WINDOWS } from "@/app/(auth)/(mercury)/reports/fixtures";
import styles from "./results.module.css";

const WINDOW_LABELS: Record<ReportWindow, string> = {
  "THIS WEEK": "This week",
  "THIS MONTH": "This month",
  "THIS QUARTER": "This quarter",
};

export function ResultsHeader({
  window,
  onWindow,
  dateFolio,
  cacheAgeMinutes,
  onRecompute,
  isRecomputing,
}: {
  window: ReportWindow;
  onWindow: (w: ReportWindow) => void;
  dateFolio?: string | null;
  cacheAgeMinutes: number | null;
  onRecompute: () => void;
  isRecomputing: boolean;
}) {
  function recomputeLabel(): string {
    if (isRecomputing) return "Recomputing…";
    if (cacheAgeMinutes === null) return "Recompute";
    if (cacheAgeMinutes === 0) return "Recompute (updated just now)";
    return `Recompute (updated ${cacheAgeMinutes}m ago)`;
  }

  return (
    <header className={styles.resultsHeader}>
      <h1 className={styles.resultsTitle}>Results</h1>

      {/* Period segmented control */}
      <div className={styles.windowControl} role="group" aria-label="Reporting period">
        {(REPORT_WINDOWS as readonly ReportWindow[]).map((w) => {
          const isActive = w === window;
          return (
            <button
              key={w}
              type="button"
              className={isActive ? styles.windowBtnActive : styles.windowBtn}
              aria-current={isActive ? true : undefined}
              onClick={() => onWindow(w)}
            >
              {WINDOW_LABELS[w]}
            </button>
          );
        })}
      </div>

      {/* Date folio + recompute */}
      <div className={styles.headerMeta}>
        {dateFolio && <span className={styles.dateFolio}>{dateFolio}</span>}
        <button
          type="button"
          className={styles.recomputeBtn}
          onClick={onRecompute}
          disabled={isRecomputing}
        >
          {recomputeLabel()}
        </button>
      </div>
    </header>
  );
}
