import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";

export type DispatchKind = "approved" | "patched" | "rejected";

export interface DispatchBannerProps {
  kind: DispatchKind;
  agentName: string;
  /** When set, the operator signed but N more signatures are still required. */
  awaitingQuorum?: number;
}

export function DispatchBanner({ kind, agentName, awaitingQuorum }: DispatchBannerProps) {
  if (kind === "rejected") {
    return (
      <div className={detailStyles.dispatchBanner} data-kind="rejected">
        <span className={styles.eyebrow}>recorded</span>
        <p className={detailStyles.dispatchMsg}>
          <b>Rejected.</b> The card is closed; the agent has been told to stand down.
        </p>
      </div>
    );
  }

  if (awaitingQuorum && awaitingQuorum > 0) {
    return (
      <div className={detailStyles.dispatchBanner} data-kind="signed">
        <span className={styles.eyebrow}>signed</span>
        <p className={detailStyles.dispatchMsg}>
          <b>Signed.</b> Waiting on {awaitingQuorum} more teammate
          {awaitingQuorum > 1 ? "s" : ""}. You'll get an in-app notification once everyone's
          approved.
        </p>
      </div>
    );
  }

  const verb = kind === "patched" ? "Approved with changes" : "Approved";
  return (
    <div className={detailStyles.dispatchBanner} data-kind="approved">
      <span className={styles.eyebrow}>processed</span>
      <p className={detailStyles.dispatchMsg}>
        <b>{verb}.</b> {agentName} is processing this now — check Activity in a moment to see the
        result.
      </p>
    </div>
  );
}
