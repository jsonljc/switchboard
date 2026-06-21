import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
  DeploymentContext,
  DeploymentResolver,
} from "@switchboard/core/platform";
import {
  ROBIN_RECOVERY_SEND_INTENT,
  ROBIN_RECOVERY_RETRY_INTENT,
} from "../services/workflows/robin-recovery-request.js";

/** Options for the authoritative deployment resolver wired into PlatformIngress. */
export interface ResolveAuthoritativeDeploymentOptions {
  /**
   * Predicate identifying non-skill, platform-initiated intents that resolve to a platform-direct
   * DeploymentContext instead of the strict skillSlug deployment lookup. Production wires
   * buildPlatformDirectIntentPredicate; the option stays injectable for tests. Qualifying classes:
   *  - operator_mutation intents (cron- or owner-initiated, e.g. "ledger" / "receipt" / "booking"),
   *    which are system_auto_approved so deployment trust is never consulted; and
   *  - the PLATFORM_DIRECT_WORKFLOW_INTENTS set (proactive sends + lead intake-records + Robin),
   *    platform-initiated workflow intents whose slug (conversation / meta / lead) has no seeded
   *    deployment. platform-direct (supervised / trustScore 0) cannot relax any mandatory gate, so
   *    resolving here is the honest result AND avoids the deployment_not_found throw that would
   *    otherwise ship them prod-inert. They STILL need a seeded allow policy to clear the gate's
   *    default-deny — resolving here only gets them TO the gate.
   * Skill intents still resolve their real deployment (and still throw if it is missing).
   */
  isPlatformDirectIntent?: (intent: string) => boolean;
}

/**
 * Platform-initiated, NON-skill workflow intents whose slug (conversation / meta / lead) has no
 * seeded deployment, so the strict slug lookup throws deployment_not_found and ships them prod-inert.
 * They resolve to a platform-direct context instead. Each is non-financial and gated downstream
 * (consent / 24h window / template at the executor) and/or parks via a seeded mandatory policy
 * (Robin); platform-direct (supervised / trustScore 0) cannot relax any mandatory gate. They STILL
 * require a seeded allow policy to clear the gate's default-deny (proactive-intake-governance.ts +
 * robin-recovery-governance.ts) — resolving here only gets them TO the gate.
 *
 * meta.lead.intake is intentionally ABSENT: it threads its RESOLVED deploymentId into the lead it
 * ingests, so it must resolve the real Alex deployment (targetHint skillSlug "alex"), not
 * platform-direct, or every Meta lead would be attributed to "platform-direct".
 */
export const PLATFORM_DIRECT_WORKFLOW_INTENTS: ReadonlySet<string> = new Set<string>([
  "conversation.reminder.send",
  "conversation.followup.send",
  "meta.lead.greeting.send",
  "meta.lead.inquiry.record",
  "lead.intake",
  ROBIN_RECOVERY_SEND_INTENT,
  // The bounded-retry re-send of an already-approved campaign recipient: a 1:1 allow-only send.
  // Auto-executes (no park): consent + template re-validated in the retry executor at send time.
  ROBIN_RECOVERY_RETRY_INTENT,
]);

/** Minimal registry shape the predicate needs (structural; the real IntentRegistry satisfies it). */
interface PlatformDirectIntentRegistry {
  lookup(intent: string): { defaultMode?: string } | undefined;
}

/**
 * The production isPlatformDirectIntent predicate wired into resolveAuthoritativeDeployment (app.ts).
 * True for (a) operator_mutation intents (system_auto_approved; deployment trust never consulted) and
 * (b) the explicit PLATFORM_DIRECT_WORKFLOW_INTENTS set. Extracted + exported so the real predicate is
 * unit-pinned — it was previously an inline arrow exercised only by per-intent live-path tests.
 */
export function buildPlatformDirectIntentPredicate(
  intentRegistry: PlatformDirectIntentRegistry,
): (intent: string) => boolean {
  return (intent) =>
    intentRegistry.lookup(intent)?.defaultMode === "operator_mutation" ||
    PLATFORM_DIRECT_WORKFLOW_INTENTS.has(intent);
}

export function resolveAuthoritativeDeployment(
  resolver: DeploymentResolver | null,
  options?: ResolveAuthoritativeDeploymentOptions,
): AuthoritativeDeploymentResolver {
  return {
    async resolve(request: CanonicalSubmitRequest): Promise<DeploymentContext> {
      const skillSlug = request.targetHint?.skillSlug ?? request.intent.split(".")[0] ?? "unknown";
      const platformDirect = (): DeploymentContext => ({
        deploymentId: "platform-direct",
        skillSlug,
        trustLevel: "supervised" as const,
        trustScore: 0,
      });
      // Non-skill, platform-initiated intents (operator_mutation crons + Robin's recovery campaign)
      // resolve to platform-direct rather than a strict slug lookup that throws deployment_not_found
      // for their non-skill intent prefix.
      if (options?.isPlatformDirectIntent?.(request.intent)) return platformDirect();
      if (!resolver) return platformDirect();
      const result = await resolver.resolveByOrgAndSlug(request.organizationId, skillSlug);
      return {
        deploymentId: result.deploymentId,
        skillSlug: result.skillSlug,
        trustLevel: result.trustLevel,
        trustScore: result.trustScore,
        // Forward the launch-posture trust override so GovernanceGate can honor it.
        // Without this, the resolved override is silently dropped before reaching
        // the gate and the auto-allow posture has no runtime effect.
        trustLevelOverride: result.trustLevelOverride,
        // Forward policyOverrides so spendApprovalThreshold reaches GovernanceGate's
        // spend-approval autonomy lever. Dropping it here is the #644 footgun that
        // left the stored threshold inert in production. (persona/inputConfig are
        // also dropped by this live mapper — a separate, out-of-scope #644 gap.)
        policyOverrides: result.policyOverrides,
        // Forward the explicit spend-autonomy opt-in. The threshold column is
        // always populated (Float @default 50), so this separate flag — not the
        // threshold's presence — is what activates the lever.
        spendAutonomyEnabled: result.spendAutonomyEnabled,
      };
    },
  };
}
