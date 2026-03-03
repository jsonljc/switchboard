import type { StorageContext } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { GuardrailState } from "../engine/policy-engine.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";
import type { RiskScoringConfig } from "../engine/risk-scorer.js";
import type { CompetenceTracker } from "../competence/tracker.js";
import type { GuardrailStateStore } from "../guardrail-state/store.js";
import type { RiskPostureStore } from "../engine/risk-posture.js";
import type { GovernanceProfileStore } from "../governance/profile.js";
import type { PolicyCache } from "../policy-cache.js";
import type { ApprovalNotifier } from "../notifications/notifier.js";
import type { CrossCartridgeEnricher } from "../enrichment/types.js";
import type { DataFlowExecutor } from "../data-flow/executor.js";
import type { TierStore } from "../smb/tier-resolver.js";
import type { SmbActivityLog } from "../smb/activity-log.js";
import type { ConnectionCredentialResolver } from "../credentials/resolver.js";
import type { ExecutionMode, EnqueueCallback } from "./lifecycle.js";
import type { CartridgeCircuitBreakerWrapper } from "./circuit-breaker-wrapper.js";
import type { IdempotencyGuard } from "../idempotency/guard.js";

/**
 * Shared dependencies and configuration passed to ProposePipeline,
 * ApprovalManager, and ExecutionManager. Constructed once by
 * LifecycleOrchestrator and passed by reference.
 */
export interface SharedContext {
  storage: StorageContext;
  ledger: AuditLedger;
  guardrailState: GuardrailState;
  guardrailStateStore: GuardrailStateStore | null;
  routingConfig: ApprovalRoutingConfig;
  riskScoringConfig?: RiskScoringConfig;
  competenceTracker: CompetenceTracker | null;
  riskPostureStore: RiskPostureStore | null;
  governanceProfileStore: GovernanceProfileStore | null;
  policyCache: PolicyCache | null;
  executionMode: ExecutionMode;
  onEnqueue: EnqueueCallback | null;
  approvalNotifier: ApprovalNotifier | null;
  selfApprovalAllowed: boolean;
  approvalRateLimit: { maxApprovals: number; windowMs: number } | null;
  crossCartridgeEnricher: CrossCartridgeEnricher | null;
  dataFlowExecutor: DataFlowExecutor | null;
  tierStore: TierStore | null;
  smbActivityLog: SmbActivityLog | null;
  credentialResolver: ConnectionCredentialResolver | null;
  circuitBreaker: CartridgeCircuitBreakerWrapper | null;
  idempotencyGuard: IdempotencyGuard | null;
}

/**
 * Build a CartridgeContext (principalId + organizationId + connectionCredentials)
 * for calling cartridge methods. Resolves org-scoped credentials via the
 * credential resolver when available.
 */
export async function buildCartridgeContext(
  ctx: SharedContext,
  cartridgeId: string,
  principalId: string,
  organizationId: string | null,
): Promise<{
  principalId: string;
  organizationId: string | null;
  connectionCredentials: Record<string, unknown>;
}> {
  let connectionCredentials: Record<string, unknown> = {};
  if (ctx.credentialResolver && organizationId) {
    try {
      connectionCredentials = await ctx.credentialResolver.resolve(cartridgeId, organizationId);
    } catch {
      // Fall back to empty credentials if resolution fails
    }
  }
  return { principalId, organizationId, connectionCredentials };
}

/**
 * Check if an organization is SMB tier.
 */
export async function isSmbOrg(
  ctx: SharedContext,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!ctx.tierStore || !organizationId) return false;
  const tier = await ctx.tierStore.getTier(organizationId);
  return tier === "smb";
}
