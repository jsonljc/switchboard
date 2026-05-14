"use client";

import { useEffect, useState } from "react";
import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";
import { ApproveBlock } from "./approve-block";
import { RejectConfirm } from "./reject-confirm";
import { DispatchBanner, type DispatchKind } from "./dispatch-banner";
import { PatchEditor } from "./patch-editor";
import { agentDisplay } from "../../hooks/use-agent-display";
import { actionDisplay } from "../../action-display";
import { formatRemaining } from "../../format";
import { emit } from "../../telemetry";
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
  onPatch?: (patchValue: Record<string, unknown>) => void;
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
  onPatch,
}: ActionDrawerProps) {
  // Hooks must be called unconditionally at the top — before any short-circuit returns.
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("approvals.advancedJsonOpen") === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("approvals.advancedJsonOpen", advancedOpen ? "true" : "false");
  }, [advancedOpen]);

  function handleAdvancedToggle() {
    setAdvancedOpen((v) => {
      if (!v) emit({ type: "approvals.advanced_json_opened", id: row.id });
      return !v;
    });
  }

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

      {!isMobile && onPatch && (
        <div className={detailStyles.advancedToggleRow}>
          <button
            type="button"
            className={detailStyles.advancedToggleBtn}
            onClick={handleAdvancedToggle}
          >
            {advancedOpen ? "Hide JSON ▴" : "View JSON (advanced) ▾"}
          </button>
        </div>
      )}
      {!isMobile && advancedOpen && onPatch && (
        <PatchEditor
          snapshot={row.request?.parametersSnapshot ?? {}}
          seed={row.patchProposal?.diff ?? null}
          onCancel={() => setAdvancedOpen(false)}
          onSubmit={(patchValue) => onPatch(patchValue)}
        />
      )}

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
