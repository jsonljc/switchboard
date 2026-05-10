"use client";

import { REPORT_WINDOWS, type ReportWindow } from "../fixtures";
import styles from "../reports.module.css";

interface TitleControlsProps {
  dateFolio: string;
  activeWindow: ReportWindow;
  onSelectWindow: (next: ReportWindow) => void;
}

export function TitleControls({ dateFolio, activeWindow, onSelectWindow }: TitleControlsProps) {
  const mailtoHref =
    "mailto:?subject=" +
    encodeURIComponent(`Your Switchboard report for ${activeWindow.toLowerCase()}`) +
    "&body=" +
    encodeURIComponent("Attached is the latest report from your Switchboard team.\n\n— Maya");

  function handleExport() {
    // Placeholder: PDF export wiring lives in a follow-up PR.
    if (typeof window !== "undefined") {
      window.alert("PDF export — placeholder.");
    }
  }

  return (
    <>
      <div className={styles.titleRow}>
        <h1 className={styles.pageTitle}>Reports</h1>
        <span className={styles.titleFolio}>{dateFolio}</span>
      </div>
      <div className={styles.controls}>
        <div className={styles.timeSelectors} role="tablist" aria-label="Reporting period">
          {REPORT_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={`${styles.timeOpt} ${activeWindow === w ? styles.isActive : ""}`}
              role="tab"
              aria-selected={activeWindow === w}
              onClick={() => onSelectWindow(w)}
            >
              {w}
            </button>
          ))}
        </div>
        <div className={styles.timeActions}>
          <button type="button" className={styles.textLink} onClick={handleExport}>
            Export PDF <span className={styles.arr}>→</span>
          </button>
          <a className={styles.textLink} href={mailtoHref}>
            Share link <span className={styles.arr}>→</span>
          </a>
        </div>
      </div>
    </>
  );
}
