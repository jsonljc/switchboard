import type { OpportunityStage } from "@switchboard/schemas";
import styles from "../pipeline.module.css";

const PER_COLUMN_COPY: Record<OpportunityStage, string> = {
  interested: "No fresh leads parked here.",
  qualified: "Nothing qualified waiting.",
  quoted: "No quotes outstanding.",
  booked: "No upcoming appointments.",
  showed: "Nobody in clinic right now.",
  won: "No wins in this view.",
  lost: "Nothing lost — quiet column.",
  nurturing: "Long-tail empty. Nice.",
};

export function PerColumnEmpty({ stage }: { stage: OpportunityStage }) {
  return <div className={styles.perColumnEmpty}>{PER_COLUMN_COPY[stage]}</div>;
}

export function WholeBoardEmpty() {
  return (
    <div className={styles.wholeBoardEmpty}>
      <p className={styles.wholeBoardEmptyTitle}>No deals in your pipeline yet.</p>
      <p className={styles.wholeBoardEmptyBody}>
        New ones appear here as soon as someone replies to one of your channels.
      </p>
    </div>
  );
}

/**
 * Board-shaped loading placeholder. Shown while the board query is pending —
 * including React Query's `enabled:false` pending state while session/org keys
 * resolve, where isLoading is false but no data exists yet. Renders ghost
 * columns so the page never flashes the (dishonest) whole-board empty state
 * before the first fetch lands. See MEMORY feedback_react_query_enabled_false_isloading.
 */
export function BoardSkeleton() {
  return (
    <div className={styles.board} role="status" aria-label="Loading pipeline" aria-busy="true">
      <div className={styles.boardInner}>
        {Array.from({ length: 8 }).map((_, col) => (
          <div key={col} className={styles.skeletonColumn}>
            <div className={styles.skeletonColumnHead} />
            {Array.from({ length: 3 }).map((__, card) => (
              <div key={card} className={styles.skeletonCard} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Whole-board error state — distinct from the empty state so a failed fetch is
 * never mistaken for "no deals". Offers a retry that re-runs the board query.
 */
export function WholeBoardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.wholeBoardEmpty} role="alert">
      <p className={styles.wholeBoardEmptyTitle}>We couldn&apos;t load your pipeline.</p>
      <p className={styles.wholeBoardEmptyBody}>
        The connection dropped on the way to your deals. Nothing was lost &mdash; try again.
      </p>
      <button type="button" className={styles.wholeBoardRetry} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
