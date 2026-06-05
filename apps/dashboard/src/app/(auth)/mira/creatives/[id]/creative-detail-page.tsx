"use client";

import { useState } from "react";
import { useMiraCreative } from "@/hooks/use-mira-creative";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { STAGE_COPY, UGC_PHASE_COPY } from "@/lib/cockpit/mira/desk-copy";
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
    return <div style={{ padding: 28 }}>Couldn&apos;t load this draft. Try again.</div>;
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
        Draft only. Not published. Nothing goes live without you.
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
        // Phase-honest no-video header (slice-3 spec 3.4): a job parked at a
        // pre-video gate reads its real progress, not a generic "drafting".
        // Terminal states keep it plain; the status line below carries them.
        <div style={{ color: T.ink3 }}>
          {job.status === "failed" || job.status === "stopped"
            ? "No draft clip."
            : `No draft clip yet. ${
                job.ugcPhase
                  ? (UGC_PHASE_COPY[job.ugcPhase] ?? "In production")
                  : (STAGE_COPY[job.stage] ?? "Still drafting")
              }.`}
        </div>
      )}

      <div style={{ fontSize: 13, color: T.ink3 }}>
        {job.status === "draft_ready"
          ? "Draft completed. Ready for your review."
          : job.status === "stopped"
            ? "This draft was stopped."
            : job.status === "failed"
              ? "This draft could not be completed."
              : job.status === "awaiting_review"
                ? "Awaiting your review."
                : "Still drafting."}
      </div>

      {job.qa && (
        // Technical frame QA (slice-3): objective integrity only. Taste stays
        // the operator's call; this line never judges creative quality.
        <div style={{ fontSize: 12, color: T.ink3 }}>
          {job.qa.status === "evaluated" && job.qa.decision === "pass"
            ? "Frame QA: passed (evaluated)"
            : job.qa.status === "evaluated" && job.qa.decision === "fail"
              ? "Frame QA: rejected"
              : "Frame QA: needs your eyes"}
        </div>
      )}

      {job.performance && (
        <div
          style={{
            background: "var(--canvas-2)",
            borderRadius: 8,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: T.ink3,
            }}
          >
            Performance
          </span>
          {job.performance.delivery === "no_delivery" ? (
            <span style={{ fontSize: 13, color: T.ink2 }}>
              No delivery yet. The ad is published as a paused draft; activate it in Ads Manager to
              start measuring.
            </span>
          ) : (
            <>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: T.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`$${job.performance.spend.toFixed(2)} spent`}
                {job.performance.trueRoas !== null
                  ? ` · ${job.performance.trueRoas.toFixed(1)}x trueROAS`
                  : ""}
                {` · $${(job.performance.bookedValueCents / 100).toFixed(2)} booked (${job.performance.bookedCount})`}
              </span>
              {/* Meta's generic `conversions` field is often empty without an
                  actions breakdown; a literal "0" would mislead, so the line
                  only renders when Meta actually reported something. */}
              {(job.performance.metaConversions > 0 || job.performance.trueRoas === null) && (
                <span style={{ fontSize: 12, color: T.ink3 }}>
                  {[
                    job.performance.metaConversions > 0
                      ? `${job.performance.metaConversions} Meta-reported conversions`
                      : null,
                    job.performance.trueRoas === null ? "no booked revenue attributed yet" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </>
          )}
          {/* A measured number must never read as live truth: the sweep freezes
              when the kill-switch is off or a campaign is deleted. */}
          {job.performance.delivery === "measured" && (
            <span style={{ fontSize: 11, color: T.ink3 }}>
              {`as of ${new Date(job.performance.asOf).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}`}
            </span>
          )}
        </div>
      )}

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
                  ? `Continue runs the next render step (~$${estimateQ.data.basic.cost}). Stop is free but can't be undone.`
                  : "Continue runs the next render step (a real cost). Stop is free but can't be undone."}
              </span>
            </div>
          )}

          {confirm === "continue" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 14,
                borderRadius: 8,
                background: T.paper,
                border: `1px solid ${T.hair}`,
              }}
            >
              <span style={{ fontSize: 13, color: T.ink2 }}>
                Continue draft? Runs the next render step. This may create provider cost
                {estimateQ.data ? ` (about $${estimateQ.data.basic.cost})` : ""}. It stays a draft.
                Nothing is published.
              </span>
              {estimateQ.data ? (
                <div
                  style={{
                    background: "var(--canvas-2)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: T.ink3,
                    }}
                  >
                    Provider cost
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      color: T.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {`about $${estimateQ.data.basic.cost}`}
                  </span>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "continue" });
                    setConfirm(null);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
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
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "transparent",
                    color: T.ink2,
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
                gap: 10,
                padding: 14,
                borderRadius: 8,
                // Intentional red wash: #F6ECEC here (stop confirm on cream) vs the
                // feed's rgba(122,46,46) on black (mira-clip-actions.tsx) — both deliberate.
                background: "#F6ECEC",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: T.red,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 6, height: 6, borderRadius: "50%", background: T.red }}
                />
                Irreversible
              </span>
              <span style={{ fontSize: 13, color: T.red }}>
                Stop this draft? You can&apos;t continue it later. This can&apos;t be undone.
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "stop" });
                    setConfirm(null);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
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
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "transparent",
                    color: T.ink2,
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
              Couldn&apos;t update the draft. Try again.
            </span>
          )}

          {approve.data?.pendingApproval && (
            <span style={{ color: T.ink2, fontSize: 12 }}>
              Queued for your approval. This render is over the auto-spend limit, so it needs your
              sign-off. Nothing ran or was charged.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
