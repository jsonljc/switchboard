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
