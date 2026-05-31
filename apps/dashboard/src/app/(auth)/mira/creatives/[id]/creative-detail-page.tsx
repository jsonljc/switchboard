"use client";

import { useState } from "react";
import { useMiraCreative } from "@/hooks/use-mira-creative";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";

export function MiraCreativeDetailPage({ id }: { id: string }) {
  const jobQ = useMiraCreative(id);
  const approve = useApproveStage();
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const job = jobQ.data;

  const canContinue = !!job?.reviewAction.canContinue;
  const canStop = !!job?.reviewAction.canStop;
  const estimateQ = useCostEstimate(id, canContinue);

  if (jobQ.isLoading) return <div style={{ padding: 28 }}>Loading draft…</div>;
  if (jobQ.isError)
    return <div style={{ padding: 28 }}>Couldn&apos;t load this draft — try again.</div>;
  if (!job) return <div style={{ padding: 28 }}>Draft not found.</div>;

  const videoUrl = job.draft?.videoUrl;

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          background: MIRA_ACCENT.paper,
          color: MIRA_ACCENT.deep,
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        Draft only — not published. Nothing goes live without you.
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: T.ink }}>
        {job.title}
      </h1>

      {videoUrl ? (
        <video
          src={videoUrl}
          poster={job.draft?.thumbnailUrl}
          controls
          playsInline
          style={{ width: "100%", borderRadius: 10 }}
        />
      ) : (
        <div style={{ color: T.ink3 }}>No draft clip yet — still generating.</div>
      )}

      <div style={{ fontSize: 13, color: T.ink3 }}>
        {job.status === "draft_ready"
          ? "Draft completed — ready for your review."
          : job.status === "stopped"
            ? "This draft was stopped."
            : job.status === "awaiting_review"
              ? "Awaiting your review."
              : "Still drafting."}
      </div>

      {canContinue || canStop ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {confirm === null && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {canContinue && (
                <button
                  disabled={approve.isPending}
                  onClick={() => setConfirm("continue")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: T.amber,
                    color: "white",
                    border: `1px solid ${T.amberDeep}`,
                  }}
                >
                  Continue draft
                </button>
              )}
              {canStop && (
                <button
                  disabled={approve.isPending}
                  onClick={() => setConfirm("stop")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "transparent",
                    color: T.ink2,
                    border: `1px solid ${T.hair}`,
                  }}
                >
                  Stop draft
                </button>
              )}
              <span style={{ fontSize: 12, color: T.ink3 }}>
                {estimateQ.data
                  ? `Continue runs the next generation step (~$${estimateQ.data.basic.cost}). Stop is free but can't be undone.`
                  : "Continue runs the next generation step (a real cost). Stop is free but can't be undone."}
              </span>
            </div>
          )}

          {confirm === "continue" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: MIRA_ACCENT.paper,
              }}
            >
              <span style={{ fontSize: 13, color: T.ink2 }}>
                Continue draft? Runs the next generation step. This may create provider cost
                {estimateQ.data ? ` (about $${estimateQ.data.basic.cost})` : ""}. It stays a draft —
                nothing is published.
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "continue" });
                    setConfirm(null);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: T.amber,
                    color: "white",
                    border: `1px solid ${T.amberDeep}`,
                  }}
                >
                  Confirm continue
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: `1px solid ${T.hair}`,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {confirm === "stop" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: "#F6ECEC",
              }}
            >
              <span style={{ fontSize: 13, color: T.red }}>
                Stop this draft? You can&apos;t continue it later. This can&apos;t be undone.
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "stop" });
                    setConfirm(null);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: T.red,
                    color: "white",
                    border: "none",
                  }}
                >
                  Stop draft
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: `1px solid ${T.hair}`,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {approve.isError && (
            <span style={{ color: T.red, fontSize: 12 }}>
              Couldn&apos;t update the draft — try again.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
