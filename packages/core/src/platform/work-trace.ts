import type { ExecutionModeName, WorkOutcome, Trigger, ExecutionError, Actor } from "./types.js";
import type { ExecutionConstraints } from "./governance-types.js";
import type { DeploymentContext } from "./deployment-context.js";

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
  idempotencyKey?: string;

  parameters?: Record<string, unknown>;
  deploymentContext?: DeploymentContext;

  governanceOutcome: "execute" | "require_approval" | "deny";
  riskScore: number;
  matchedPolicies: string[];
  governanceConstraints?: ExecutionConstraints;

  approvalId?: string;
  approvalOutcome?: "approved" | "rejected" | "patched" | "expired";
  approvalRespondedBy?: string;
  approvalRespondedAt?: string;

  outcome: WorkOutcome;
  durationMs: number;
  error?: ExecutionError;
  executionSummary?: string;
  executionOutputs?: Record<string, unknown>;

  modeMetrics?: Record<string, unknown>;
  requestedAt: string;
  governanceCompletedAt: string;
  executionStartedAt?: string;
  completedAt?: string;
  /**
   * Set automatically by the store when outcome transitions into a terminal value.
   * Once non-null, the trace is sealed: see work-trace-lock.ts for invariants.
   */
  lockedAt?: string;
}
