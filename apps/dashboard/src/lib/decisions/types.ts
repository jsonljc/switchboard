import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds (matches the backend type — see spec §1).
export type DecisionKind = "approval" | "handoff";

/**
 * Five-field risk contract — mirrors core Decision.meta.riskContract exactly.
 * Absent on legacy decisions predating this field; UI treats absence as unsafe.
 */
export interface RiskContract {
  riskLevel: "low" | "medium" | "high";
  externalEffect: boolean;
  financialEffect: boolean;
  clientFacing: boolean;
  requiresConfirmation: boolean;
}

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
    /** Back-compat scalar — prefer riskContract.riskLevel when available. */
    riskLevel?: "low" | "medium" | "high";
    /** ISO string. */
    undoableUntil?: string;
    /**
     * Five-field risk contract. Present on all approvals (from recommendation row)
     * and handoffs (derived conservative defaults). Absent on legacy decisions
     * predating this field — UI treats absence as unsafe (requires confirmation).
     */
    riskContract?: RiskContract;
  };
}
