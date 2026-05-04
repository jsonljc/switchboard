import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds (matches the backend type — see spec §1).
export type DecisionKind = "approval" | "handoff";

export interface DecisionPresentation {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: ReadonlyArray<unknown>;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  agentKey: AgentKey;
  humanSummary: string;
  presentation: DecisionPresentation;
  urgencyScore: number;
  /** ISO string — backend serializes Date → string for the wire. */
  createdAt: string;
  threadHref: string | null;
  sourceRef: { kind: DecisionKind; sourceId: string };
  meta: {
    contactName?: string;
    /** ISO string. */
    slaDeadlineAt?: string;
    riskLevel?: "low" | "medium" | "high";
    /** ISO string. */
    undoableUntil?: string;
  };
}
