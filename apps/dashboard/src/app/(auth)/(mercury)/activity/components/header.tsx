"use client";

import styles from "../activity.module.css";
import { fmtRel } from "./format";

export interface ActivityHeaderProps {
  /** ISO timestamp of the most recent ledger entry available to the page
   *  (typically rows[0].timestamp). Null hides the tile. */
  lastLedgerEntryIso: string | null;
  /** H6 (spec §12): when true, the tile is hidden regardless of the iso prop.
   *  Page sets this when `appliedFilters` is non-empty so the tile doesn't
   *  lie about ledger head under narrowing. */
  lastLedgerEntryHidden?: boolean;
}

export function ActivityHeader({ lastLedgerEntryIso, lastLedgerEntryHidden }: ActivityHeaderProps) {
  const lastRel =
    !lastLedgerEntryHidden && lastLedgerEntryIso
      ? fmtRel(Date.now() - new Date(lastLedgerEntryIso).getTime())
      : null;

  return (
    <header className={styles.pageHeadWrap}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLead}>
          <span className={styles.eyebrow}>Mercury Tools · /activity</span>
          <h1 className={styles.pageTitle}>Audit log</h1>
          <p className={styles.pageSub}>
            Every mutation by every actor — user, agent, service account, system — lands here,
            hash-chained. By default this shows the operator-visible actions; switch to All to
            inspect the full audit vocabulary.
          </p>
        </div>
        {lastRel !== null && (
          <div className={styles.pageMeta}>
            <div className={styles.statTile}>
              <span className={styles.eyebrow}>last ledger entry</span>
              <span className={styles.statTileV}>{lastRel}</span>
              <span className={styles.statTileSub}>chain head · verified</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
