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

export interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
}

export interface ApprovalDetail {
  request: {
    id: string;
    summary: string;
    riskCategory: string;
    bindingHash: string;
    approvers: string[];
    createdAt: string;
  };
  state: {
    status: string;
    expiresAt: string;
    respondedBy?: string;
    respondedAt?: string;
  };
  envelopeId: string;
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
  agentKey: "nova" | "alex" | "mira";
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
