"use client";

import type { AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";

export function NeedsYouBlock({ agentKey }: { agentKey: AgentKey }) {
  const { data, isLoading, isError } = useDecisionFeed(agentKey);

  if (isLoading) return null;
  if (isError) {
    return (
      <section className="section page" data-block="needs-you">
        <div className="folio">
          <span className="folio-l">Needs you</span>
          <span className="folio-r">—</span>
        </div>
        <p className="empty-state">
          <em>Couldn&apos;t load this block.</em>
        </p>
      </section>
    );
  }

  const decisions = data?.decisions ?? [];

  return (
    <section className="section page" data-block="needs-you" data-testid="block-needs-you">
      <div className="folio">
        <span className="folio-l">Needs you</span>
        <span className="folio-r">
          {decisions.length} {decisions.length === 1 ? "item" : "items"}
        </span>
      </div>
      {decisions.length === 0 ? (
        <p className="empty-state">
          <em>You&apos;re caught up. I&apos;ll write again when something needs you.</em>
        </p>
      ) : (
        <div className="decisions measure-prose">
          {decisions.map((d, i) => (
            <DecisionCard
              key={d.id}
              {...mapToDecisionCard(d, i)}
              onPrimary={() => dispatchDecisionAction(d.sourceRef, "primary")}
              onSecondary={() => dispatchDecisionAction(d.sourceRef, "secondary")}
            />
          ))}
        </div>
      )}
    </section>
  );
}
