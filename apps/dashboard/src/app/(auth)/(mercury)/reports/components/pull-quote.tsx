import type { PullQuoteCopy } from "../fixtures";
import styles from "../reports.module.css";

export function PullQuote({ q }: { q: PullQuoteCopy }) {
  return (
    <div className={styles.pullquoteWrap}>
      <p className={`${styles.pullquote} ${styles.fadeIn}`} key={q.value}>
        {q.pre}
        <span className={styles.accent}>{q.value}</span>
        {q.mid}
        <span className={styles.accent}>{q.cost}</span>
        {q.post}
      </p>
    </div>
  );
}
