import type { ExecutionModeName, WorkOutcome, Trigger, ExecutionError, Actor } from "./types.js";

export interface WorkTrace {
  workUnitId: string;
  traceId: string;
  parentWorkUnitId?: string;
  deploymentId?: string;
  intent: string;
  mode: ExecutionModeName;
  organizationId: string;
  actor: Actor;
  trigger: Trigger;
  governanceOutcome: "execute" | "require_approval" | "deny";
  riskScore: number;
  matchedPolicies: string[];
  outcome: WorkOutcome;
  durationMs: number;
  approvalWaitMs?: number;
  error?: ExecutionError;
  modeMetrics?: Record<string, unknown>;
  requestedAt: string;
  governanceCompletedAt: string;
  executionStartedAt?: string;
  completedAt?: string;
}
