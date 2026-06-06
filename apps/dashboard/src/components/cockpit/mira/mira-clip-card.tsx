"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import { MiraClipActions } from "./mira-clip-actions";

function statusLabel(status: MiraCreativeJobSummary["status"]): string {
  switch (status) {
    case "draft_ready":
      return "Ready for review";
    case "awaiting_review":
      return "Awaiting review";
    default:
      return "In draft";
  }
}

/**
 * One full-bleed clip page. `isActive` drives autoplay (only the in-view clip
 * plays). `onResolve` is called after Continue/Stop succeeds so the feed can
 * dismiss the clip and advance. `onDecided` is called after Keep/Pass so the
 * feed can raise an undo toast.
 */
export function MiraClipCard({
  job,
  isActive,
  onResolve,
  onDecided,
}: {
  job: MiraCreativeJobSummary;
  isActive: boolean;
  onResolve: (jobId: string) => void;
  onDecided: (jobId: string, decision: "kept" | "passed", silent: boolean) => void;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) void el.play().catch(() => {});
    else el.pause();
    return () => {
      el.pause();
    };
  }, [isActive]);

  return (
    <section
      data-testid="mira-clip"
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        scrollSnapAlign: "start",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {job.draft?.videoUrl ? (
        <video
          ref={videoRef}
          src={job.draft.videoUrl}
          poster={job.draft.thumbnailUrl}
          muted
          loop
          playsInline
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) void v.play().catch(() => {});
            else v.pause();
          }}
          style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
        />
      ) : (
        <div style={{ color: "#bbb", fontSize: 14 }}>This clip didn&apos;t load.</div>
      )}

      {/* status chip */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 12,
        }}
      >
        {statusLabel(job.status)}
      </div>

      {/* metadata caption → detail */}
      <button
        type="button"
        onClick={() => router.push(`/mira/creatives/${job.id}`)}
        style={{
          position: "absolute",
          left: 14,
          bottom: 18,
          maxWidth: "70%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "#fff",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 600 }}>{job.title}</span>
        <span style={{ opacity: 0.8 }}> · {job.source.mode === "ugc" ? "UGC" : "Polished"} ↗</span>
      </button>

      {/* action rail */}
      <div style={{ position: "absolute", right: 14, bottom: 24 }}>
        <MiraClipActions
          jobId={job.id}
          reviewAction={job.reviewAction}
          onResolve={onResolve}
          onDecided={onDecided}
        />
      </div>
    </section>
  );
}
