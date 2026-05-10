"use client";

import styles from "../automations.module.css";

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
