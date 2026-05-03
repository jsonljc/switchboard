"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApprovals } from "@/hooks/use-approvals";
import { useEscalations } from "@/hooks/use-escalations";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { QueueCardView } from "../queue-cards";
import { mapQueue, type ApprovalApiRow, type EscalationApiRow } from "../console-mappers";
import { ZoneEmpty, ZoneError, ZoneSkeleton } from "./zone-states";

const RESOLVE_DURATION_MS = 320;

export function QueueZone() {
  const escalations = useEscalations();
  const approvals = useApprovals();
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(() => new Set());

  const beginResolve = useCallback(
    (cardId: string) => {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.add(cardId);
        return next;
      });
      setTimeout(() => {
        if (keys) {
          queryClient.invalidateQueries({ queryKey: keys.escalations.all() });
          queryClient.invalidateQueries({ queryKey: keys.approvals.pending() });
        }
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }, RESOLVE_DURATION_MS);
    },
    [queryClient, keys],
  );

  if (escalations.isLoading || approvals.isLoading) {
    return <ZoneSkeleton label="Loading queue" />;
  }

  if (escalations.error || approvals.error) {
    return (
      <ZoneError
        message="Couldn't load queue."
        onRetry={() => {
          escalations.refetch();
          approvals.refetch();
        }}
      />
    );
  }

  const escalationRows: EscalationApiRow[] =
    (escalations.data as { escalations?: EscalationApiRow[] } | undefined)?.escalations ?? [];
  const approvalRows: ApprovalApiRow[] =
    (approvals.data as { approvals?: ApprovalApiRow[] } | undefined)?.approvals ?? [];

  const cards = mapQueue(escalationRows, approvalRows, new Date());

  if (cards.length === 0) {
    return <ZoneEmpty message="No queue items right now." />;
  }

  return (
    <section aria-label="Queue">
      <div className="queue-head">
        <Link className="label" href="/escalations">
          Queue
        </Link>
        <span className="count">{cards.length} pending</span>
      </div>
      <div className="queue">
        {cards.map((card) => (
          <QueueCardView
            key={card.id}
            card={card}
            resolving={resolvingIds.has(card.id)}
            onResolve={() => beginResolve(card.id)}
          />
        ))}
      </div>
    </section>
  );
}
