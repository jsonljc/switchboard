import styles from "../contacts.module.css";

/**
 * Mercury-register header for /contacts. Near-clone of ReportsHeader with one
 * deliberate difference: no agent name carries `.isActive`, since /contacts is
 * a Tools-tier surface that doesn't belong to any single agent.
 *
 * Nav and actions render as inert <span> elements — same posture as
 * ReportsHeader. A future Mercury-chrome consolidation slice will lift this
 * into a shared MercuryAuthShell once a third Mercury surface lands (D2/D3).
 */
export function ContactsHeader() {
  const inboxCount = 0;

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
            <span>Riley</span>
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
