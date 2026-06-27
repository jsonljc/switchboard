"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useReviewDecision } from "@/hooks/use-review-decision";
import { ConnectionTrouble } from "@/components/query-states";
import { T } from "@/components/cockpit/tokens";
import { MiraClipCard } from "./mira-clip-card";

export function MiraCreativeFeed() {
  const { data, isError, refetch } = useMiraFeed();
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const { toast } = useToast();
  const decide = useReviewDecision();

  const jobs = (data?.jobs ?? []).filter((j) => !resolved.has(j.id));
  const safeActive = jobs.length > 0 ? Math.min(activeIndex, jobs.length - 1) : 0;

  function handleResolve(jobId: string) {
    setResolved((prev) => new Set(prev).add(jobId));
    setActiveIndex((i) => Math.min(i, Math.max(0, jobs.length - 2)));
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.list() });
  }

  function undoDecision(jobId: string) {
    decide.mutate(
      { id: jobId, decision: null },
      {
        onSuccess: () => {
          setResolved((prev) => {
            const next = new Set(prev);
            next.delete(jobId);
            return next;
          });
        },
      },
    );
  }

  function handleDecided(jobId: string, decision: "kept" | "passed", silent: boolean) {
    const job = jobs.find((j) => j.id === jobId);
    handleResolve(jobId);
    if (silent) return; // already decided elsewhere: no undo to offer
    toast({
      title: decision === "kept" ? "Kept" : "Passed",
      description: job?.title,
      action: (
        <ToastAction altText="Undo" onClick={() => undoDecision(jobId)}>
          Undo
        </ToastAction>
      ),
    });
  }

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

  // Keys-pending-safe gating: useMiraFeed is enabled:!!keys, so while the org
  // scope resolves React Query reports a disabled query as isLoading:false /
  // data:undefined / isError:false. A plain `if (isLoading)` gate is skipped here
  // and falls through to the empty state, flashing a false "no drafts". Derive
  // loading from {data, error} (resolveQueryState precedence: data ▸ error ▸
  // loading) so keys-pending — and the initial load — render the skeleton.
  if (data == null && !isError) {
    return (
      <div
        data-testid="mira-feed-skeleton"
        style={{ height: "100%", background: "hsl(var(--night-canvas))" }}
      />
    );
  }
  if (isError) {
    // The shared failure vocabulary (role=alert, offline-aware) on a light card
    // floating over the night ground: same component, honest on both registers.
    return (
      <div
        style={{
          height: "100%",
          background: "hsl(var(--night-canvas))",
          display: "grid",
          placeItems: "center",
          padding: 28,
        }}
      >
        <div
          style={{
            background: T.paper,
            borderRadius: 18,
            boxShadow: "var(--shadow-3)",
            padding: 8,
            maxWidth: 420,
            width: "100%",
          }}
        >
          <ConnectionTrouble agentName="Mira" onRetry={refetch} />
        </div>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          background: "hsl(var(--night-canvas))",
          display: "grid",
          placeItems: "center",
          padding: 28,
        }}
      >
        <p
          style={{
            margin: 0,
            color: "hsl(var(--night-ink-2))",
            fontSize: 14,
            textAlign: "center",
            maxWidth: 360,
          }}
        >
          No drafts to review yet. Mira&apos;s drafts will appear here as she drafts them.
        </p>
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
          <MiraClipCard
            job={job}
            isActive={i === safeActive}
            onResolve={handleResolve}
            onDecided={handleDecided}
          />
        </div>
      ))}
    </div>
  );
}
