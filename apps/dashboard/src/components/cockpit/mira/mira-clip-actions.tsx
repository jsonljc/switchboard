"use client";

import { useState } from "react";
import type { MiraReviewAction } from "@switchboard/core";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useReviewDecision } from "@/hooks/use-review-decision";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";

export function MiraClipActions({
  jobId,
  reviewAction,
  onResolve,
}: {
  jobId: string;
  reviewAction: MiraReviewAction;
  /** Called after a Continue/Stop mutation succeeds → feed dismisses + advances. */
  onResolve: (jobId: string) => void;
}) {
  const approve = useApproveStage();
  const decide = useReviewDecision();
  const { halted } = useHalt();
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const estimateQ = useCostEstimate(jobId, reviewAction.canContinue && confirm === "continue");

  function run(action: "continue" | "stop") {
    approve.mutate(
      { jobId, action },
      {
        onSuccess: (data) => {
          setConfirm(null);
          // A render parked over the spend threshold is NOT a resolution — keep the
          // clip in the feed (a pending notice shows) instead of dismissing it.
          if (!data?.pendingApproval) onResolve(jobId);
        },
      },
    );
  }

  const pendingApproval = approve.data?.pendingApproval === true;

  const btn = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  } as const;

  if (confirm === "continue") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "rgba(14,12,10,0.92)",
          padding: 10,
          borderRadius: 10,
          maxWidth: 220,
        }}
      >
        <span style={{ color: "#fff", fontSize: 12 }}>
          Runs the next generation step. This may create provider cost
          {estimateQ.data ? ` (about $${estimateQ.data.basic.cost})` : ""}.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{
              ...btn,
              background: T.amber,
              color: "#fff",
              border: `1px solid ${T.amberDeep}`,
            }}
            disabled={approve.isPending}
            onClick={() => run("continue")}
          >
            Confirm continue
          </button>
          <button
            style={{ ...btn, background: "transparent", border: "1px solid #fff" }}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
        {approve.isError && (
          <span style={{ color: "#fff", fontSize: 11 }}>
            Couldn&apos;t update the draft — try again.
          </span>
        )}
      </div>
    );
  }
  if (confirm === "stop") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "rgba(122,46,46,0.95)",
          padding: 10,
          borderRadius: 10,
          maxWidth: 220,
        }}
      >
        <span style={{ color: "#fff", fontSize: 12 }}>
          Stop this draft? You can&apos;t continue it later. This can&apos;t be undone.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...btn, background: "#fff", color: T.red }}
            disabled={approve.isPending}
            onClick={() => run("stop")}
          >
            Confirm stop
          </button>
          <button
            style={{ ...btn, background: "transparent", border: "1px solid #fff" }}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
        {approve.isError && (
          <span style={{ color: "#fff", fontSize: 11 }}>
            Couldn&apos;t update the draft — try again.
          </span>
        )}
      </div>
    );
  }

  if (reviewAction.label === "review_draft") {
    const decideAndResolve = (decision: "kept" | "passed") =>
      decide.mutate({ id: jobId, decision }, { onSuccess: () => onResolve(jobId) });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
        <button
          style={{ ...btn, background: MIRA_ACCENT.deep }}
          disabled={decide.isPending}
          onClick={() => decideAndResolve("kept")}
        >
          Keep
        </button>
        <button
          style={{ ...btn, background: "rgba(0,0,0,0.55)" }}
          disabled={decide.isPending}
          onClick={() => decideAndResolve("passed")}
        >
          Pass
        </button>
        {decide.isError && (
          <span style={{ color: "#fff", fontSize: 11 }}>Couldn&apos;t save — try again.</span>
        )}
      </div>
    );
  }

  if (!reviewAction.canContinue && !reviewAction.canStop) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      {pendingApproval && (
        <span style={{ color: "#fff", fontSize: 11, maxWidth: 220, textAlign: "right" }}>
          Queued for your approval — over the auto-spend limit. Nothing ran.
        </span>
      )}
      {reviewAction.canContinue &&
        (halted ? (
          <button
            style={{ ...btn, background: "#555", cursor: "not-allowed" }}
            disabled
            title="Resume Mira to continue drafts."
          >
            Halted
          </button>
        ) : (
          <button style={{ ...btn, background: T.amber }} onClick={() => setConfirm("continue")}>
            Continue draft
          </button>
        ))}
      {reviewAction.canStop && (
        <button
          style={{ ...btn, background: "rgba(0,0,0,0.55)" }}
          onClick={() => setConfirm("stop")}
        >
          Stop draft
        </button>
      )}
    </div>
  );
}
