"use client";

import styles from "./agent-panel.module.css";

/**
 * Honest "not set up" body for Mira.
 *
 * Mira is not yet available. This component renders informational copy only —
 * no dead anchors, no "Set up Mira" CTA, no fabricated capability claims.
 * If a real informational destination (docs, marketing page) is added later,
 * replace the copy below with a real link to it.
 */
export function MiraPanel() {
  return (
    <div className={styles.notset}>
      <div className={styles.notsetMark} aria-hidden="true">
        M
      </div>
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}
