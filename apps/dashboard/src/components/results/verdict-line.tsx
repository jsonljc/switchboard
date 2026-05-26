import type { PullQuoteCopy } from "./types";
import styles from "./results.module.css";

export function VerdictLine({ pullquote }: { pullquote: PullQuoteCopy }) {
  const { pre, value, mid, cost, post } = pullquote;
  const hasPost = post.length > 0;

  return (
    <p className={styles.verdictLine}>
      {pre}
      <span className={styles.verdictEmphasis}>{value}</span>
      {mid}
      <span className={styles.verdictEmphasis}>{cost}</span>
      {hasPost && (
        <>
          {" "}
          {post}
          <span className={styles.verdictByline}>{"— Riley"}</span>
        </>
      )}
    </p>
  );
}
