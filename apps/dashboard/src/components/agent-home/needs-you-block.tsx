"use client";

import type { AgentKey } from "@switchboard/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";

export function NeedsYouBlock({ agentKey }: { agentKey: AgentKey }) {
  const { data, isLoading, isError } = useDecisionFeed(agentKey);
  const queryClient = useQueryClient();
  const tenant = useTenantContext();

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
              onPrimary={() => {
                if (!tenant) return;
                void dispatchDecisionAction(d.sourceRef, "primary", undefined, {
                  queryClient,
                  orgId: tenant.orgId,
                  agentKey,
                });
              }}
              onSecondary={() => {
                if (!tenant) return;
                void dispatchDecisionAction(d.sourceRef, "secondary", undefined, {
                  queryClient,
                  orgId: tenant.orgId,
                  agentKey,
                });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
