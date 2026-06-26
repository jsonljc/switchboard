import type { PrismaClient } from "@prisma/client";
import { AD_OPTIMIZER_LISTING_SLUG } from "./seed-riley-ad-optimizer-deployment.js";

/** The slice of AuditLedger this helper needs (structural so the db package does
 * not import core; the CLI composes the REAL AuditLedger over PrismaLedgerStorage
 * so the hash chain stays intact — never write AuditEntry rows raw). */
export interface CapabilityAuditRecorder {
  record(
    params: {
      eventType: "policy.updated";
      actorType: "user";
      actorId: string;
      entityType: string;
      entityId: string;
      riskCategory: "high";
      summary: string;
      snapshot: Record<string, unknown>;
    },
    // When set, the audit chain-append joins the caller's transaction
    // (AuditLedger.record -> appendAtomic({ externalTx })), binding the audit
    // row to the capability flip so neither can commit without the other.
    options?: { tx?: unknown },
  ): Promise<unknown>;
}

/**
 * Auditable per-org toggle for Phase-C pause self-execution
 * (governanceSettings.pauseSelfExecutionEnabled on the org's Riley deployment).
 * The flag is CAPABILITY ASSIGNMENT, not config: every flip writes one
 * AuditLedger row (actor, org, old -> new) through the real chain-hashing
 * ledger, so capability changes are never silent DB mutations. eventType
 * "policy.updated" is deliberate reuse: governanceSettings IS the deployment's
 * governance posture (the closed AuditEventType enum stays untouched).
 *
 * ROLLOUT RULE (design rev 2): do not enable for any production org until
 * strict-truth riley_self ownership (PR-3) is merged and verified.
 */
export async function setRileyPauseSelfExecution(
  prisma: PrismaClient,
  ledger: CapabilityAuditRecorder,
  args: { organizationId: string; enabled: boolean; actor: string },
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
    select: { id: true },
  });
  if (!deployment) {
    throw new Error(
      `no riley deployment for org ${args.organizationId} - seed it first (seedRileyAdOptimizerDeployment)`,
    );
  }
  // Flip + audit row commit or roll back together: the audit chain-append joins this
  // transaction (ledger.record({ tx }) -> appendAtomic({ externalTx })), so a ledger
  // failure can never leave a money-move capability armed or disarmed with no audit row.
  //
  // The governanceSettings read-modify-write happens INSIDE the transaction over a
  // row-locked read (SELECT ... FOR UPDATE). Reading the JSON outside the tx let two
  // concurrent toggles of DIFFERENT keys both merge onto the same pre-tx snapshot, so
  // the second commit silently clobbered the first key's flip (a lost update). The lock
  // serializes the RMW. Mirrors PrismaGovernanceMarketWriter (same FOR UPDATE shape).
  const { previous } = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ governanceSettings: unknown }>>`
      SELECT "governanceSettings" FROM "AgentDeployment"
      WHERE "id" = ${deployment.id}
      FOR UPDATE`;
    const [row] = rows;
    if (!row) {
      throw new Error(`riley deployment ${deployment.id} vanished mid-transaction`);
    }
    const settings = (row.governanceSettings as Record<string, unknown> | null) ?? {};
    const previousValue = settings["pauseSelfExecutionEnabled"] === true;
    await tx.agentDeployment.update({
      where: { id: deployment.id },
      data: {
        // Read-modify-write preserving every other governanceSettings key
        // (trustLevelOverride, spendAutonomy, ...).
        governanceSettings: { ...settings, pauseSelfExecutionEnabled: args.enabled },
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
        summary: `riley pauseSelfExecutionEnabled: ${previousValue} -> ${args.enabled} (org ${args.organizationId}, by ${args.actor})`,
        snapshot: {
          flag: "pauseSelfExecutionEnabled",
          previous: previousValue,
          current: args.enabled,
          organizationId: args.organizationId,
          deploymentId: deployment.id,
        },
      },
      { tx },
    );
    return { previous: previousValue };
  });
  return { previous, current: args.enabled };
}
