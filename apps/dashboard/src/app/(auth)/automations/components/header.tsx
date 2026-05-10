"use client";

import styles from "../automations.module.css";

/**
 * AutomationsHeader is intentionally a near-clone of ContactsHeader / ReportsHeader
 * for now (decision §2.0 #4). Once D3 ships, the three headers will be
 * extracted into a shared MercuryAuthShell — that's D3's tax.
 */
export function AutomationsHeader() {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.brand}>Switchboard</div>
      <nav aria-label="Agents" className={styles.agentNav}>
        <span>Alex</span>
        <span>·</span>
        <span>Riley</span>
        <span>·</span>
        <span>+</span>
      </nav>
      <nav aria-label="Tools" className={styles.toolNav}>
        <span>Live</span>
        <span>·</span>
        <span>Inbox</span>
        <span>·</span>
        <span>Halt</span>
        <span>·</span>
        <span>M</span>
      </nav>
    </header>
  );
}
