"use client";

import Link from "next/link";
import { useApprovals } from "@/hooks/use-approvals";
import { useEscalations } from "@/hooks/use-escalations";
import { QueueCardView } from "../queue-cards";
import { mapQueue, type ApprovalApiRow, type EscalationApiRow } from "../console-mappers";
import { ZoneEmpty, ZoneError, ZoneSkeleton } from "./zone-states";

interface QueueZoneProps {
  onOpenSlideOver: (
    sel:
      | { kind: "approval"; approvalId: string; bindingHash: string }
      | { kind: "escalation"; escalationId: string },
  ) => void;
}

export function QueueZone({ onOpenSlideOver }: QueueZoneProps) {
  const escalations = useEscalations();
  const approvals = useApprovals();

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
            onApprovalPrimary={(c) =>
              onOpenSlideOver({
                kind: "approval",
                approvalId: c.approvalId,
                bindingHash: c.bindingHash,
              })
            }
            onEscalationPrimary={(c) =>
              onOpenSlideOver({
                kind: "escalation",
                escalationId: c.escalationId,
              })
            }
          />
        ))}
      </div>
    </section>
  );
}
