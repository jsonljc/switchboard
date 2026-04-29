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
  /**
   * SHA-256 of canonical-JSON of hash-included WorkTrace fields.
   * Set by the store on persist (v1) and every hash-relevant update (v+1).
   * Optional only because pre-migration reads return rows without it.
   */
  contentHash?: string;
  /**
   * Monotonic per workUnitId. 1 on persist; +1 per hash-relevant update.
   * 0 on pre-migration rows (treated as missing_anchor when contentHash is non-null).
   */
  traceVersion?: number;
  /**
   * Discriminator: how the row entered persistence.
   * - "platform_ingress": persisted by PlatformIngress.submit() after governance evaluation.
   * - "store_recorded_operator_mutation": persisted by a Store as an operator mutation;
   *   the row did NOT pass through PlatformIngress and matches none of the standard
   *   governance modes. See ConversationStateStore (packages/core/src/platform/
   *   conversation-state-store.ts) for the only current writer of this kind.
   * Defaults to "platform_ingress" on existing rows via the DB column default.
   */
  ingressPath: "platform_ingress" | "store_recorded_operator_mutation";
  /**
   * Hash-input shape version. v1 = pre-ingressPath (rows persisted before this column
   * existed); v2 = includes ingressPath in canonical hash input. Pre-migration backfill
   * sets 1 so original contentHash values continue to verify; new persists set 2.
   */
  hashInputVersion: number;
}
