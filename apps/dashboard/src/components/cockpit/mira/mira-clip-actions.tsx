"use client";

import { useState } from "react";
import type { MiraReviewAction } from "@switchboard/core";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";
import { useHalt } from "@/components/layout/halt/halt-context";

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
  const { halted } = useHalt();
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const estimateQ = useCostEstimate(jobId, reviewAction.canContinue && confirm === "continue");

  function run(action: "continue" | "stop") {
    approve.mutate(
      { jobId, action },
      {
        onSuccess: () => {
          setConfirm(null);
          onResolve(jobId);
        },
      },
    );
  }

  const btn = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const;

  if (confirm === "continue") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "rgba(60,49,92,0.95)",
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
            style={{ ...btn, background: "#fff", color: "#3C315C" }}
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
            style={{ ...btn, background: "#fff", color: "#7A2E2E" }}
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
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
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
          <button style={{ ...btn, background: "#3C315C" }} onClick={() => setConfirm("continue")}>
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
