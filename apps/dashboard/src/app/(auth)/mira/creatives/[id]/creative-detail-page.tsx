"use client";

import { useState } from "react";
import { useCreativeJob, useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production", "complete"] as const;

export function MiraCreativeDetailPage({ id }: { id: string }) {
  const jobQ = useCreativeJob(id);
  const approve = useApproveStage();
  // Both actions require an explicit confirm: Continue is cost-bearing (a real
  // provider call, no budget guard in M1) and Stop is irreversible (no resume).
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const job = jobQ.data;

  const isComplete = job?.currentStage === "complete";
  const isStopped = !!job?.stoppedAt;
  const canAct = !!job && !isComplete && !isStopped;
  const estimateQ = useCostEstimate(id, canAct);

  if (jobQ.isLoading) return <div style={{ padding: 28 }}>Loading draft…</div>;
  if (jobQ.isError)
    return <div style={{ padding: 28 }}>Couldn&apos;t load this draft — try again.</div>;
  if (!job) return <div style={{ padding: 28 }}>Draft not found.</div>;

  const production = (job.stageOutputs as Record<string, unknown> | undefined)?.["production"] as
    | { assembledVideos?: Array<{ videoUrl?: string; thumbnailUrl?: string }> }
    | undefined;
  const video = production?.assembledVideos?.[0];

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Draft-only banner — never "published" language */}
      <div
        style={{
          background: "#EFECF6",
          color: "#3C315C",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        Draft only — not published. Nothing goes live without you.
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{job.productDescription}</h1>

      {video?.videoUrl ? (
        <video
          src={video.videoUrl}
          poster={video.thumbnailUrl}
          controls
          style={{ width: "100%", borderRadius: 10 }}
        />
      ) : (
        <div style={{ color: "#777" }}>No draft clip yet — still in {job.currentStage}.</div>
      )}

      {/* Stage progress */}
      <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0, flexWrap: "wrap" }}>
        {STAGES.map((s) => {
          const idx = STAGES.indexOf(s);
          const curIdx = STAGES.indexOf(job.currentStage as (typeof STAGES)[number]);
          const done = idx < curIdx;
          return (
            <li
              key={s}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: done ? "#D8D2E8" : "#F2F2F2",
                fontSize: 12,
              }}
            >
              {s}
            </li>
          );
        })}
      </ol>

      {canAct ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {confirm === null && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                disabled={approve.isPending}
                onClick={() => setConfirm("continue")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "#3C315C",
                  color: "white",
                  border: "none",
                }}
              >
                Continue draft
              </button>
              <button
                disabled={approve.isPending}
                onClick={() => setConfirm("stop")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "transparent",
                  color: "#3C315C",
                  border: "1px solid #3C315C",
                }}
              >
                Stop draft
              </button>
              {/* Explicit cost label up front (confirmed decision) */}
              <span style={{ fontSize: 12, color: "#777" }}>
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
                background: "#EFECF6",
              }}
            >
              <span style={{ fontSize: 13, color: "#3C315C" }}>
                Continue this draft? This runs the next generation step and may cost
                {estimateQ.data ? ` about $${estimateQ.data.basic.cost}` : " money"}. It stays a
                draft — nothing is published.
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    // M1 deliberately continues at the default (basic) tier — no pro-tier selection on this page.
                    approve.mutate({ jobId: id, action: "continue" });
                    setConfirm(null);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "#3C315C",
                    color: "white",
                    border: "none",
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
                    border: "1px solid #999",
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
              <span style={{ fontSize: 13, color: "#7A2E2E" }}>
                Stop this draft? You can't continue it later — this can't be undone.
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
                    background: "#7A2E2E",
                    color: "white",
                    border: "none",
                  }}
                >
                  Confirm stop
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid #999",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {approve.isError && (
            <span style={{ color: "#7A2E2E", fontSize: 12 }}>
              Couldn&apos;t update the draft — try again.
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "#777" }}>
          {isStopped
            ? "This draft was stopped."
            : isComplete
              ? "Draft completed — ready for your review."
              : ""}
        </div>
      )}
    </div>
  );
}
