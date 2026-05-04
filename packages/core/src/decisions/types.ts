import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds. "escalation" reserved for a future slice — see spec §1.
// When EscalationRecord is promoted to a first-class operator-facing decision,
// add it here.
export type DecisionKind = "approval" | "handoff";

export interface DecisionPresentation {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: ReadonlyArray<unknown>;
}

export interface Decision {
  /** Namespaced ("approval:abc" / "handoff:def") so frontend can use it as a single React key. */
  id: string;
  kind: DecisionKind;
  orgId: string;
  agentKey: AgentKey;
  /** The serif sentence that displays on the card. */
  humanSummary: string;
  presentation: DecisionPresentation;
  /** 0..100, computed by per-kind scorer (urgency.ts). */
  urgencyScore: number;
  createdAt: Date;
  /** "View thread →" target; null if no thread. */
  threadHref: string | null;
  /** For action dispatch — the original row's id + kind. */
  sourceRef: { kind: DecisionKind; sourceId: string };
  meta: {
    contactName?: string;
    /** Handoffs only. */
    slaDeadlineAt?: Date;
    /** Recommendations only. */
    riskLevel?: "low" | "medium" | "high";
    /** Recommendations only. */
    undoableUntil?: Date;
  };
}
