import type { AgentKey } from "@switchboard/schemas";

// Matches the backend type: Slice A shipped 2 kinds; "workflow_approval"
// (parked ApprovalLifecycle units) joined 2026-06-04.
export type DecisionKind = "approval" | "handoff" | "workflow_approval";

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
    /** Enrichment (P1-C.2) — rendered if present, absent on current backend. */
    replyPreview?: string;
    /** Enrichment (P1-C.2) — rendered if present, absent on current backend. */
    channel?: string;
    /**
     * Workflow approvals only: the current ApprovalRevision bindingHash; the
     * client echoes it on approve so a patched/raced revision is refused.
     */
    bindingHash?: string;
    /** Workflow approvals only: approved but dispatch failed; primary action is Retry. */
    dispatchFailed?: boolean;
    /** Estimated whole-dollar impact (>= 0); render only when > 0. SGD. Source: core recommendation-adapter. */
    dollarsAtRisk?: number;
    /** Recommendation confidence 0..1; rendered as a qualitative band. Source: core recommendation-adapter. */
    confidence?: number;
  };
}
