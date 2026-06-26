import { Prisma, type PrismaClient } from "@prisma/client";
import { AD_OPTIMIZER_LISTING_SLUG } from "./seed-riley-ad-optimizer-deployment.js";
import type { CapabilityAuditRecorder } from "./riley-pause-flag-toggle.js";

/**
 * Auditable per-org toggles for Riley's budget-reallocation capability flags on the org's Riley
 * deployment governanceSettings. Both are CAPABILITY ASSIGNMENT, not config: every flip writes one
 * chain-hashed AuditLedger row (actor, org, old -> new), so capability changes are never silent DB
 * mutations. Mirrors setRileyPauseSelfExecution (riley-pause-flag-toggle.ts); the reallocate flags
 * previously had NO audited setter (a raw DB edit), which this closes before a real-money pilot.
 *
 *  - reallocateSelfExecutionEnabled: the per-org CANARY enable flag. Gates the reallocate SUBMITTER
 *    (the weekly-audit sink), so a flip reaches ONE org rather than every org's runner. Combined with
 *    the env kill switch RILEY_REALLOCATE_SELF_EXECUTION_ENABLED.
 *  - reallocateKillSwitch: the runtime IN-FLIGHT kill-switch. The reallocate EXECUTOR reads it at the
 *    last mile and aborts (RILEY_REALLOCATE_KILLED) when true, halting in-flight + future execution
 *    without a redeploy. Distinct from the enable flag (which only gates the submitter).
 */

const REALLOCATE_FLAG_KEYS = {
  killSwitch: "reallocateKillSwitch",
  selfExecution: "reallocateSelfExecutionEnabled",
} as const;

async function setRileyReallocateFlag(
  prisma: PrismaClient,
  ledger: CapabilityAuditRecorder,
  args: { organizationId: string; key: string; enabled: boolean; actor: string },
): Promise<{ previous: boolean; current: boolean }> {
  const listing = await prisma.agentListing.findUnique({
    where: { slug: AD_OPTIMIZER_LISTING_SLUG },
    select: { id: true },
  });
  if (!listing) {
    throw new Error("ad-optimizer listing not found - run seedMarketplace first");
  }
  const deployment = await prisma.agentDeployment.findUnique({
    where: {
      organizationId_listingId: { organizationId: args.organizationId, listingId: listing.id },
    },
    select: { id: true, governanceSettings: true },
  });
  if (!deployment) {
    throw new Error(
      `no riley deployment for org ${args.organizationId} - seed it first (seedRileyAdOptimizerDeployment)`,
    );
  }
  const settings = (deployment.governanceSettings as Record<string, unknown> | null) ?? {};
  const previous = settings[args.key] === true;
  // Flip + audit row commit or roll back together: the audit chain-append joins
  // this transaction (ledger.record({ tx }) -> appendAtomic({ externalTx })), so
  // a ledger failure can never leave a money-move capability armed or disarmed
  // with no audit row. Mirrors provisionOrgAgentDeployments + the platform's
  // WorkTrace + AuditEntry binding.
  await prisma.$transaction(async (tx) => {
    await tx.agentDeployment.update({
      where: { id: deployment.id },
      // Read-modify-write preserving every other governanceSettings key. The computed-key spread widens
      // to Record<string, unknown>; the stored governanceSettings is already JSON, so the cast to the
      // Prisma JSON input is sound (a literal-key spread would not need it, but the shared helper does).
      data: {
        governanceSettings: { ...settings, [args.key]: args.enabled } as Prisma.InputJsonValue,
      },
    });
    await ledger.record(
      {
        eventType: "policy.updated",
        actorType: "user",
        actorId: args.actor,
        entityType: "deployment",
        entityId: deployment.id,
        riskCategory: "high",
        summary: `riley ${args.key}: ${previous} -> ${args.enabled} (org ${args.organizationId}, by ${args.actor})`,
        snapshot: {
          flag: args.key,
          previous,
          current: args.enabled,
          organizationId: args.organizationId,
          deploymentId: deployment.id,
        },
      },
      { tx },
    );
  });
  return { previous, current: args.enabled };
}

/**
 * The runtime in-flight kill-switch (governanceSettings.reallocateKillSwitch). Flip ON to halt
 * in-flight + future reallocate self-execution for an org without a redeploy; OFF to re-arm.
 */
export function setRileyReallocateKillSwitch(
  prisma: PrismaClient,
  ledger: CapabilityAuditRecorder,
  args: { organizationId: string; enabled: boolean; actor: string },
): Promise<{ previous: boolean; current: boolean }> {
  return setRileyReallocateFlag(prisma, ledger, {
    ...args,
    key: REALLOCATE_FLAG_KEYS.killSwitch,
  });
}

/**
 * The per-org canary enable flag (governanceSettings.reallocateSelfExecutionEnabled). Flip ON to let
 * the reallocate submitter emit for ONE canary org (still also gated by the env kill switch + every
 * other runbook precondition). ROLLOUT RULE: do not enable for any production org until the full
 * docs/runbooks/riley-reallocation-go-live.md gate is satisfied + exercised.
 */
export function setRileyReallocateSelfExecution(
  prisma: PrismaClient,
  ledger: CapabilityAuditRecorder,
  args: { organizationId: string; enabled: boolean; actor: string },
): Promise<{ previous: boolean; current: boolean }> {
  return setRileyReallocateFlag(prisma, ledger, {
    ...args,
    key: REALLOCATE_FLAG_KEYS.selfExecution,
  });
}
