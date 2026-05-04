"use client";

import type { CostBreakdown, ReportWindow } from "../fixtures";
import { fmtMoney } from "./format";
import styles from "../reports.module.css";

interface ReportFooterProps {
  activeWindow: ReportWindow;
  cost: CostBreakdown;
}

export function ReportFooter({ activeWindow, cost }: ReportFooterProps) {
  const mailtoHref =
    "mailto:?subject=" +
    encodeURIComponent(`Your Switchboard report for ${activeWindow.toLowerCase()}`) +
    "&body=" +
    encodeURIComponent(
      "Attached is the latest report from your Switchboard team. Saving roughly " +
        fmtMoney(cost.saving) +
        "/mo vs an SDR + agency.\n\n— Maya",
    );

  function handleExport() {
    if (typeof window !== "undefined") {
      window.alert("PDF export — placeholder.");
    }
  }

  return (
    <div className={styles.reportFooter}>
      <button type="button" className={styles.textLink} onClick={handleExport}>
        Export PDF <span className={styles.arr}>→</span>
      </button>
      <a className={styles.textLink} href={mailtoHref}>
        Send to my accountant <span className={styles.arr}>→</span>
      </a>
    </div>
  );
}
