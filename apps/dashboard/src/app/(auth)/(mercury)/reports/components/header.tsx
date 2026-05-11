import styles from "../reports.module.css";

/**
 * Mercury-register header — visual port of the agent-home header.
 * Placeholder header — agent-home migration will wire these to live nav.
 *
 * Renders nav/action affordances as inert <span> elements (matching the
 * design bundle's anchor-with-no-target semantics minus the navigation)
 * so screen readers don't announce them as buttons that fire no action.
 */
export function ReportsHeader() {
  const inboxCount = 3;

  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderRow}>
        <div className={styles.brandCluster}>
          <span className={styles.brandMark} aria-label="Switchboard home">
            <span className={styles.brandDot} />
            Switchboard
          </span>
          <nav className={styles.brandNav} aria-label="agents">
            <span>Alex</span>
            <span className={styles.isActive}>Riley</span>
            <span className={styles.navAdd} aria-label="Add an agent">
              +
            </span>
          </nav>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.livePip}>
            <span className={styles.pulse} />
            Live
          </span>
          <span className={styles.folioLink} aria-label={`Inbox, ${inboxCount} items`}>
            {inboxCount > 0 && <span className={styles.pip} />}
            <span>Inbox</span>
            {inboxCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.num}>{inboxCount}</span>
              </>
            )}
          </span>
          <span className={styles.folioLink}>Halt</span>
          <span className={styles.meChip}>M</span>
        </div>
      </div>
    </header>
  );
}
