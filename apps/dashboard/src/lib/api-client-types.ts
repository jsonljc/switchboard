import type { AgentKey } from "@switchboard/schemas";

export interface AgentRosterEntry {
  id: string;
  organizationId: string;
  agentRole: string;
  displayName: string;
  description: string;
  status: string;
  tier: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  agentState?: AgentStateEntry | null;
}

/**
 * Persisted agent state — the `AgentState` Prisma row embedded in a roster
 * entry by `GET /api/dashboard/agents/roster` (`include: { agentState: true }`).
 * Keyed by `agentRosterId`. Distinct from {@link DerivedAgentStateEntry}.
 */
export interface AgentStateEntry {
  id: string;
  agentRosterId: string;
  organizationId: string;
  activityStatus: string;
  currentTask: string | null;
  lastActionAt: string | null;
  lastActionSummary: string | null;
  metrics: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Derived agent state — the on-demand shape returned by
 * `GET /api/dashboard/agents/state` (`{ states: DerivedAgentStateEntry[] }`).
 * Computed from recent audit entries by `deriveAgentStates` in `@switchboard/db`,
 * NOT a persisted row: keyed by `agentRole`, no id/agentRosterId/updatedAt.
 *
 * Mirrors `DerivedAgentState` from `@switchboard/db`, except `lastActionAt` is a
 * JSON-serialized ISO string over the wire (a `Date` server-side). Keep in sync
 * with that source of truth — the type-assertion test in
 * `api-client-types.test.ts` enforces structural agreement.
 */
export interface DerivedAgentStateEntry {
  agentRole: string;
  activityStatus: "idle" | "working" | "analyzing" | "waiting_approval" | "error";
  currentTask: string | null;
  lastActionAt: string | null;
  lastActionSummary: string | null;
  metrics: { actionsToday: number };
}

export interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
  // A.7c — optional payload fields forwarded from /api/approvals/pending.
  // Absent for legacy approvals (pre-A.7c). The cockpit's rich adapter reads
  // these to render the correct card variant (urgency eyebrow + CTA copy)
  // and falls back to the legacy adapter when kind is undefined.
  kind?: "pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation";
  body?: string;
  quote?: string;
  quoteFrom?: string;
}

export interface HealthCheck {
  healthy: boolean;
  checks: Record<string, { status: string; latencyMs: number; error?: string; detail?: unknown }>;
  checkedAt: string;
}

export interface SimulateResult {
  decisionTrace: {
    actionId: string;
    envelopeId: string;
    checks: Array<{
      checkCode: string;
      checkData: Record<string, unknown>;
      humanDetail: string;
      matched: boolean;
      effect: string;
    }>;
    computedRiskScore: {
      rawScore: number;
      category: string;
      factors: Array<{ factor: string; weight: number; contribution: number; detail: string }>;
    };
    finalDecision: string;
    approvalRequired: string;
    explanation: string;
    evaluatedAt: string;
  };
  wouldExecute: boolean;
  approvalRequired: string;
  explanation: string;
}

export type RecommendationApiRow = {
  id: string;
  orgId: string;
  agentKey: AgentKey;
  intent: string;
  action: string;
  humanSummary: string;
  confidence: number;
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  surface: "queue" | "shadow_action";
  status: "pending" | "acted" | "dismissed" | "confirmed" | "dismissed_by_undo" | "expired";
  parameters: {
    __recommendation?: {
      action?: string;
      note?: string | null;
      presentation?: {
        primaryLabel: string;
        secondaryLabel: string;
        dismissLabel: string;
        dataLines: unknown[];
      };
    };
    [key: string]: unknown;
  };
  targetEntities: Record<string, unknown> | null;
  sourceAgent: string;
  sourceWorkflow: string | null;
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  undoableUntil: string | null;
};

export type RecommendationActAction = "primary" | "secondary" | "dismiss" | "confirm" | "undo";
