"use client";

import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";
import { ApproveBlock } from "./approve-block";
import { RejectConfirm } from "./reject-confirm";
import { DispatchBanner, type DispatchKind } from "./dispatch-banner";
import { agentDisplay } from "../../hooks/use-agent-display";
import { actionDisplay } from "../../action-display";
import { formatRemaining } from "../../format";
import type { DetailRow } from "../../types";

export interface ActionDrawerProps {
  row: DetailRow;
  now: number;
  principalId: string | null;
  decision?: { kind: DispatchKind; awaitingQuorum?: number } | null;
  error?: { status: number } | null;
  pending?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function ActionDrawer({
  row,
  now,
  principalId,
  decision,
  error,
  pending,
  onApprove,
  onReject,
}: ActionDrawerProps) {
  const remaining = new Date(row.expiresAt).getTime() - now;
  const expired = remaining <= 0;
  const recovery = row.status === "recovery_required";
  const agent = agentDisplay(row.agent);
  const action = actionDisplay(row.request?.action);

  if (decision) {
    return (
      <div className={detailStyles.actions}>
        <DispatchBanner
          kind={decision.kind}
          agentName={agent.name}
          awaitingQuorum={decision.awaitingQuorum}
        />
      </div>
    );
  }

  if (!principalId) {
    return (
      <div className={detailStyles.actions}>
        <p className={detailStyles.actionsNotice}>Sign in again to approve or reject.</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className={detailStyles.actions}>
        <p className={detailStyles.actionsReadOnly}>
          This expired {formatRemaining(-remaining)} ago. The agent will re-propose if it&apos;s
          still needed.
        </p>
      </div>
    );
  }

  if (recovery) {
    return (
      <div className={detailStyles.actions}>
        <div className={detailStyles.recoveryNotice}>
          <span className={styles.eyebrow}>Needs retry</span>
          <p className={detailStyles.recoveryMsg}>
            <b>This action couldn&apos;t be prepared.</b> The agent ran into a problem and needs to
            try again. Dismiss this card; a new one will appear when the agent retries.
          </p>
          <div className={detailStyles.recoveryFoot}>
            <button
              type="button"
              className={detailStyles.btnSm}
              onClick={onReject}
              disabled={pending}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={detailStyles.actions}>
      <ApproveBlock
        bindingHash={row.bindingHash}
        riskCategory={row.riskCategory}
        agentName={agent.name}
        actionDisplay={action}
        onApprove={onApprove}
        disabled={pending}
      />
      <RejectConfirm onConfirm={onReject} disabled={pending} />
      {error && (
        <p className={detailStyles.actionsError}>
          {error.status === 409
            ? "This was already decided by a teammate — refreshing your view."
            : "Couldn't send your approval — your decision wasn't recorded. Safe to try again."}
        </p>
      )}
    </div>
  );
}
