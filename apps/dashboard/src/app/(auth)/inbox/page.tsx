"use client";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { NeedsYouCard } from "@/components/home/needs-you-card";

export default function InboxPage() {
  const { data, isLoading, isError } = useDecisionFeed(null);
  if (isLoading) return <div className="inbox-loading">Loading…</div>;
  if (isError) return <div className="inbox-error">Couldn't load your inbox. Try again.</div>;
  const decisions = data?.decisions ?? [];
  if (decisions.length === 0) return <div className="inbox-empty">That's everything.</div>;
  return (
    <ul className="inbox-list">
      {decisions.map((d, i) => (
        <li key={d.id} className="inbox-row">
          {/*
           * Each NeedsYouCard owns its own useRecommendationAction hook — hooks
           * can't be called in a loop, so the per-card hook lives inside the child
           * component, not in this page.
           */}
          <NeedsYouCard decision={d} index={i} />
        </li>
      ))}
    </ul>
  );
}
