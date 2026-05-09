import Link from "next/link";
import styles from "../reports.module.css";

/**
 * Mercury-register header — visual port of the agent-home header.
 *
 * Brand mark + agent names route to their real homes; Inbox / Halt / Me /
 * `+` stay inert until C-slice and agent-management work wires them. Riley
 * is .isActive on /reports because the renewal-checkpoint statement is
 * Riley's surface (ad attribution narrative).
 */
export function ReportsHeader() {
  const inboxCount = 3;

  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderRow}>
        <div className={styles.brandCluster}>
          <Link href="/" className={styles.brandMark} aria-label="Switchboard home">
            <span className={styles.brandDot} />
            Switchboard
          </Link>
          <nav className={styles.brandNav} aria-label="agents">
            <Link href="/alex">Alex</Link>
            <Link href="/riley" className={styles.isActive}>
              Riley
            </Link>
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
