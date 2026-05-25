import Link from "next/link";
import type { WhileYouSleptRow } from "./types";
import styles from "./home.module.css";

const MAX_ROWS = 3;

/**
 * WhileYouSlept — overnight activity digest (quiet module, no ticker theater).
 *
 * Presentational only: renders whatever factual rows it receives. No introspection,
 * no fabricated activity. Empty → a single calm line. Capped at 3 rows with a
 * "View all →" link to /activity when the full list is longer.
 */
export function WhileYouSlept({ rows }: { rows: WhileYouSleptRow[] }) {
  if (rows.length === 0) {
    return (
      <section className={`${styles.module} ${styles.moduleQuiet}`} aria-label="While you slept">
        <div className={styles.moduleH}>
          <h2>while you slept</h2>
        </div>
        <p className={styles.quietText} style={{ padding: "4px" }}>
          All quiet overnight.
        </p>
      </section>
    );
  }

  const visible = rows.slice(0, MAX_ROWS);
  const hasMore = rows.length > MAX_ROWS;

  return (
    <section className={`${styles.module} ${styles.moduleQuiet}`} aria-label="While you slept">
      <div className={styles.moduleH}>
        <h2>while you slept</h2>
        {hasMore && <span className={styles.hMeta}>{rows.length} total</span>}
      </div>
      <ul className={styles.quietList} role="list">
        {visible.map((row, i) => (
          <li
            key={`${row.agentKey}-${row.time}-${i}`}
            className={styles.quietRow}
            data-agent={row.agentKey}
          >
            <span className={styles.quietMark} aria-hidden="true" />
            <span className={styles.quietText}>{row.text}</span>
            <span className={styles.quietTime}>{row.time}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Link href="/activity" className={styles.moduleMore} style={{ alignSelf: "flex-end" }}>
          View all <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
