"use client";

import { useState } from "react";
import detailStyles from "../../detail.module.css";
import { shortHash } from "../../short-hash";
import type { RiskCategory } from "../../types";

export interface ApproveBlockProps {
  bindingHash: string;
  riskCategory: RiskCategory;
  agentName: string;
  actionDisplay: string;
  /** When > 1, the sub-line switches to quorum copy. */
  approvalsRequired?: number;
  /** Current signed count (excluding the operator's pending signature). */
  signedSoFar?: number;
  onApprove: () => void;
  disabled?: boolean;
}

export function ApproveBlock({
  bindingHash,
  riskCategory,
  agentName,
  actionDisplay,
  approvalsRequired,
  signedSoFar = 0,
  onApprove,
  disabled,
}: ApproveBlockProps) {
  const isHighRisk = riskCategory === "high" || riskCategory === "critical";
  const [acked, setAcked] = useState(false);
  const ctaDisabled = !!disabled || (isHighRisk && !acked);
  const sh = shortHash(bindingHash);

  const showQuorumSub = !!approvalsRequired && approvalsRequired > 1;
  const subLine = showQuorumSub
    ? `Adds your signature to the quorum (${signedSoFar + 1} of ${approvalsRequired} after this).`
    : null;

  return (
    <div className={detailStyles.approveBlock}>
      {isHighRisk ? (
        <>
          <p className={detailStyles.approveStatement}>
            I've checked the details above. Approve this <em>{actionDisplay}</em>.
            <span className={detailStyles.approveCodePill}>{sh}</span>
          </p>
          <label className={detailStyles.approveAck}>
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
            <span>
              I've read the details and the confirmation code{" "}
              <code className={detailStyles.approveCodeInline}>{sh}</code> matches what I want to
              approve.
            </span>
          </label>
        </>
      ) : (
        <>
          <p className={detailStyles.approveContext}>
            Approving sends this to be processed by <b>{agentName}</b>.
          </p>
          <p className={detailStyles.approveCodeAnchor}>
            The confirmation code above locks these details before approval.
          </p>
        </>
      )}
      {subLine && <p className={detailStyles.approveSub}>{subLine}</p>}
      <button
        type="button"
        className={detailStyles.approveBtn}
        onClick={onApprove}
        disabled={ctaDisabled}
        aria-disabled={ctaDisabled}
      >
        <span className={detailStyles.approveBtnTitle}>
          {isHighRisk ? "Approve & sign" : "Approve"}
        </span>
        <span className={detailStyles.approveBtnHash}>Code {sh}</span>
      </button>
    </div>
  );
}
