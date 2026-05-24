"use client";
import { useDecisionFeed } from "@/hooks/use-decision-feed";

export default function InboxPage() {
  const { data, isLoading } = useDecisionFeed(null);
  if (isLoading) return <div className="inbox-loading">Loading…</div>;
  const decisions = data?.decisions ?? [];
  if (decisions.length === 0) return <div className="inbox-empty">That's everything.</div>;
  return (
    <ul className="inbox-list">
      {decisions.map((d) => (
        <li key={d.id} className="inbox-row">
          {d.humanSummary}
        </li>
      ))}
    </ul>
  );
}
