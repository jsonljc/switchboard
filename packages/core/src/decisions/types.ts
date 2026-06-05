import type { AgentKey } from "@switchboard/schemas";

// Slice A shipped 2 kinds; "workflow_approval" (parked ApprovalLifecycle units)
// joined 2026-06-04. "escalation" reserved for a future slice — see spec §1.
// When EscalationRecord is promoted to a first-class operator-facing decision,
// add it here.
export type DecisionKind = "approval" | "handoff" | "workflow_approval";

/** Five-field risk contract (named so adapters and summarizers can share it). */
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
    /**
     * Five-field risk contract. Present on all approvals (from recommendation row)
     * and handoffs (derived conservative defaults). Absent on legacy decisions
     * predating this field — UI treats absence as unsafe (requires confirmation).
     */
    riskContract?: RiskContract;
    /**
     * Workflow approvals only: the current ApprovalRevision bindingHash. The
     * client echoes it on approve so a patched/raced revision is refused.
     */
    bindingHash?: string;
    /** Workflow approvals only: approved but dispatch failed; primary action is Retry. */
    dispatchFailed?: boolean;
  };
}
