"use client";

import styles from "../activity.module.css";

export type EmptyStateProps =
  | { variant: "zero" }
  | {
      variant: "filtered";
      /** Active base scope; suppresses the "switch to All events" suggestion when already on "all". */
      scope?: "operational" | "all";
      onClear?: () => void;
    };

export function EmptyState(props: EmptyStateProps) {
  if (props.variant === "zero") {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyEyebrow}>ledger health</span>
        <h2 className={styles.emptyHeadline}>
          No activity <em className={styles.emptyHeadlineEm}>recorded yet</em>.
        </h2>
        <p className={styles.emptySub}>
          The chain is healthy and the writer is connected — no audit-emitting event has fired in
          this org&apos;s window. Once an agent proposes a mutation or an operator changes a policy,
          entries will appear here, hash-chained to the genesis row.
        </p>
        <div className={styles.emptyMeta}>
          <span>writer connected</span>
          <span className={styles.emptyMetaSep}>·</span>
          <span>chain head verified</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <span className={styles.emptyEyebrow}>no matches</span>
      <h2 className={styles.emptyHeadline}>
        No entries match <em className={styles.emptyHeadlineEm}>these filters</em>.
      </h2>
      <p className={styles.emptySub}>
        Nothing in the current scope matches. Try broadening the date range or dropping the entity
        {props.scope !== "all" && (
          <>
            , or switch to <b className={styles.emptyMetaB}>All events</b> if you&apos;re looking
            for non-operational types
          </>
        )}
        .
      </p>
      {props.onClear !== undefined && (
        <button type="button" className={styles.emptyCta} onClick={props.onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
