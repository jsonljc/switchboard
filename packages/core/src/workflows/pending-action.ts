import { randomUUID } from "node:crypto";
import type {
  PendingAction,
  PendingActionStatus,
  RiskLevel,
  ApprovalType,
} from "@switchboard/schemas";

export interface CreatePendingActionInput {
  intent: string;
  targetEntities: Array<{ type: string; id: string }>;
  parameters: Record<string, unknown>;
  humanSummary: string;
  confidence: number;
  riskLevel: RiskLevel;
  dollarsAtRisk: number;
  requiredCapabilities: string[];
  dryRunSupported: boolean;
  approvalRequired: ApprovalType;
  sourceAgent: string;
  organizationId: string;
  workflowId?: string;
  stepIndex?: number;
  sourceWorkflow?: string;
  expiresAt?: Date;
  fallback?: { action: string; reason: string };
}

export function createPendingAction(input: CreatePendingActionInput): PendingAction {
  return {
    id: randomUUID(),
    idempotencyKey: `${input.sourceAgent}:${input.intent}:${randomUUID()}`,
    workflowId: input.workflowId ?? null,
    stepIndex: input.stepIndex ?? null,
    status: "proposed",
    intent: input.intent,
    targetEntities: input.targetEntities,
    parameters: input.parameters,
    humanSummary: input.humanSummary,
    confidence: input.confidence,
    riskLevel: input.riskLevel,
    dollarsAtRisk: input.dollarsAtRisk,
    requiredCapabilities: input.requiredCapabilities,
    dryRunSupported: input.dryRunSupported,
    approvalRequired: input.approvalRequired,
    fallback: input.fallback ?? null,
    sourceAgent: input.sourceAgent,
    sourceWorkflow: input.sourceWorkflow ?? null,
    organizationId: input.organizationId,
    createdAt: new Date(),
    expiresAt: input.expiresAt ?? null,
    resolvedAt: null,
    resolvedBy: null,
  };
}

export const VALID_ACTION_TRANSITIONS: Record<PendingActionStatus, PendingActionStatus[]> = {
  proposed: ["approved", "rejected", "expired"],
  approved: ["executing"],
  executing: ["completed", "failed"],
  completed: [],
  failed: [],
  rejected: [],
  expired: [],
};

export function canActionTransition(from: PendingActionStatus, to: PendingActionStatus): boolean {
  return VALID_ACTION_TRANSITIONS[from].includes(to);
}

export class PendingActionTransitionError extends Error {
  constructor(
    public readonly from: PendingActionStatus,
    public readonly to: PendingActionStatus,
  ) {
    super(
      `Invalid action transition: cannot move from '${from}' to '${to}'. Valid transitions from '${from}': [${VALID_ACTION_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "PendingActionTransitionError";
  }
}
