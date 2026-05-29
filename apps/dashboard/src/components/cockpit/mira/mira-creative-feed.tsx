"use client";

import { useEffect, useRef, useState } from "react";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { MiraClipCard } from "./mira-clip-card";

export function MiraCreativeFeed() {
  const { data, isLoading, isError } = useMiraFeed();
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const jobs = data?.jobs ?? [];

  // Update the active (in-view) clip on scroll. IntersectionObserver is the
  // browser path; the first clip is active on mount so autoplay starts without
  // waiting for an intersection (and so tests are deterministic).
  useEffect(() => {
    const root = containerRef.current;
    if (!root || jobs.length === 0) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-clip-index]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.clipIndex);
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { root, threshold: 0.6 },
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [jobs.length]);

  if (isLoading) {
    return <div data-testid="mira-feed-skeleton" style={{ height: "100%", background: "#000" }} />;
  }
  if (isError) {
    return (
      <div style={{ padding: 28, color: "#777" }}>
        Couldn&apos;t load your drafts — pull to refresh.
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div style={{ padding: 28, color: "#777" }}>
        No drafts to review yet — Mira&apos;s drafts will appear here as they generate.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", overflowY: "auto", scrollSnapType: "y mandatory" }}
    >
      {jobs.map((job, i) => (
        <div key={job.id} data-clip-index={i} style={{ height: "100%", scrollSnapAlign: "start" }}>
          <MiraClipCard job={job} isActive={i === activeIndex} />
        </div>
      ))}
    </div>
  );
}
