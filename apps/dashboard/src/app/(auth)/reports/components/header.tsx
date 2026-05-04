"use client";

import { useState } from "react";
import styles from "../reports.module.css";

/**
 * Mercury-register header — visual port of the agent-home header.
 * Static for now; nav links and Halt are local-state placeholders
 * pending the agent-home migration that will wire them up.
 */
export function ReportsHeader() {
  const [halted, setHalted] = useState(false);
  const inboxCount = 3;

  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderRow}>
        <div className={styles.brandCluster}>
          <button type="button" className={styles.brandMark} aria-label="Switchboard home">
            <span className={styles.brandDot} />
            Switchboard
          </button>
          <nav className={styles.brandNav} aria-label="agents">
            <button type="button">Alex</button>
            <button type="button" className={styles.isActive}>
              Riley
            </button>
            <button type="button" className={styles.navAdd} aria-label="Add an agent">
              +
            </button>
          </nav>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.livePip}>
            <span className={styles.pulse} />
            Live
          </span>
          <button
            type="button"
            className={styles.folioLink}
            aria-label={`Inbox, ${inboxCount} items`}
          >
            {inboxCount > 0 && <span className={styles.pip} />}
            <span>Inbox</span>
            {inboxCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.num}>{inboxCount}</span>
              </>
            )}
          </button>
          <button
            type="button"
            className={`${styles.folioLink} ${halted ? styles.isHalt : ""}`}
            aria-pressed={halted}
            onClick={() => setHalted((h) => !h)}
          >
            {halted ? "Halted" : "Halt"}
          </button>
          <span className={styles.meChip}>M</span>
        </div>
      </div>
    </header>
  );
}
