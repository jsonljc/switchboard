import Link from "next/link";
import styles from "../contacts.module.css";

/**
 * Mercury-register header for /contacts. Near-clone of ReportsHeader with one
 * deliberate difference: no agent name carries `.isActive`, since /contacts is
 * a Tools-tier surface that doesn't belong to any single agent.
 *
 * Brand mark + agent names route to their real homes; the rest (Inbox, Halt,
 * Me chip, +) stay inert until C-slice / agent-management work wires them. A
 * future Mercury-chrome consolidation slice will lift this into a shared
 * MercuryAuthShell once a third Mercury surface lands (D2/D3).
 */
export function ContactsHeader() {
  const inboxCount = 0;

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
            <Link href="/riley">Riley</Link>
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
