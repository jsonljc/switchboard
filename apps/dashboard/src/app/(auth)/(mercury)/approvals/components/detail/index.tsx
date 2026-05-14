"use client";

import { useEffect, useState } from "react";
import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";
import { DetailHeader } from "./header";
import { ConfirmationCode } from "./confirmation-code";
import { DetailEmpty } from "./empty";
import { ActionDrawer } from "./action-drawer";
import {
  ApprovalRespondError,
  useApprovalDetail,
  useRespondToApproval,
} from "../../hooks/use-approvals";
import { useSessionPrincipal } from "../../hooks/use-session-principal";
import { emit } from "../../telemetry";
import type { DispatchKind } from "./dispatch-banner";

export interface DetailProps {
  id: string | null;
  now: number;
}

export function Detail({ id, now }: DetailProps) {
  const principalId = useSessionPrincipal();
  const { data: row, isLoading, isError } = useApprovalDetail(id);
  const mutation = useRespondToApproval();

  const [decision, setDecision] = useState<{ kind: DispatchKind; awaitingQuorum?: number } | null>(
    null,
  );
  const [errorState, setErrorState] = useState<{ status: number } | null>(null);

  // Reset local state when the row id changes (operator picked a different card).
  useEffect(() => {
    setDecision(null);
    setErrorState(null);
  }, [id]);

  if (!id) return <DetailEmpty />;
  if (isLoading) {
    return (
      <div className={detailStyles.detailEmpty}>
        <span className={styles.eyebrow}>loading…</span>
      </div>
    );
  }
  if (isError || !row) {
    return (
      <div className={detailStyles.detailEmpty}>
        <span className={styles.eyebrow}>couldn't load</span>
        <p className={detailStyles.detailEmptySub}>
          We couldn't load this approval. Pick another card or refresh.
        </p>
      </div>
    );
  }

  function handleApprove() {
    if (!row) return;
    emit({
      type: "approvals.approve_clicked",
      id: row.id,
      riskCategory: row.riskCategory,
      quorum: false,
    });
    setErrorState(null);
    mutation.mutate(
      { id: row.id, action: "approve", bindingHash: row.bindingHash },
      {
        onSuccess: () => setDecision({ kind: "approved" }),
        onError: (err) => {
          if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
          else setErrorState({ status: 500 });
        },
      },
    );
  }

  function handleReject() {
    if (!row) return;
    emit({ type: "approvals.reject_clicked", id: row.id });
    setErrorState(null);
    mutation.mutate(
      { id: row.id, action: "reject" },
      {
        onSuccess: () => setDecision({ kind: "rejected" }),
        onError: (err) => {
          if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
          else setErrorState({ status: 500 });
        },
      },
    );
  }

  function handlePatch(patchValue: Record<string, unknown>) {
    if (!row) return;
    emit({ type: "approvals.patch_submitted", id: row.id, changedKeys: Object.keys(patchValue) });
    setErrorState(null);
    mutation.mutate(
      { id: row.id, action: "patch", bindingHash: row.bindingHash, patchValue },
      {
        onSuccess: () => setDecision({ kind: "patched" }),
        onError: (err) => {
          if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
          else setErrorState({ status: 500 });
        },
      },
    );
  }

  return (
    <div className={detailStyles.detail}>
      <DetailHeader row={row} now={now} />
      <ConfirmationCode bindingHash={row.bindingHash} envelopeId={row.envelopeId} />
      <ActionDrawer
        row={row}
        now={now}
        principalId={principalId}
        decision={decision}
        error={errorState}
        pending={mutation.isPending}
        onApprove={handleApprove}
        onReject={handleReject}
        onPatch={handlePatch}
      />
    </div>
  );
}
