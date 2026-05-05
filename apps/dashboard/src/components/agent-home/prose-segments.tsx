import type { ProseSegment } from "@/lib/agent-home/types";

export function ProseSegments({ segments }: { segments: readonly ProseSegment[] }) {
  return (
    <span>
      {segments.map((seg, i) =>
        seg.kind === "accent" ? (
          <span key={i} className="accent">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
