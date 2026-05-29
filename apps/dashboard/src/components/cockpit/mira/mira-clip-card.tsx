"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MiraCreativeJobSummary } from "@switchboard/core";

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
 * plays). `footer` is the action rail slot (wired in PR3B).
 */
export function MiraClipCard({
  job,
  isActive,
  footer,
}: {
  job: MiraCreativeJobSummary;
  isActive: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) void el.play().catch(() => {});
    else el.pause();
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

      {/* action rail slot (PR3B) */}
      <div style={{ position: "absolute", right: 14, bottom: 24 }}>{footer}</div>
    </section>
  );
}
