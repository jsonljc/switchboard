import type { PullQuoteCopy } from "@switchboard/schemas";
import styles from "../reports.module.css";

export function PullQuote({ q }: { q: PullQuoteCopy }) {
  return (
    <div className={styles.pullquoteWrap}>
      <p className={`${styles.pullquote} ${styles.fadeIn}`} key={q.value + q.cost}>
        {q.pre}
        <span className={styles.em}>{q.value}</span>
        {q.mid}
        <span className={styles.em}>{q.cost}</span>
        {q.post}
      </p>
    </div>
  );
}
