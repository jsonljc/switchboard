import type { PrismaClient } from "@prisma/client";
import { AD_OPTIMIZER_LISTING_SLUG } from "./seed-riley-ad-optimizer-deployment.js";

/** The slice of AuditLedger this helper needs (structural so the db package does
 * not import core; the CLI composes the REAL AuditLedger over PrismaLedgerStorage
 * so the hash chain stays intact — never write AuditEntry rows raw). */
export interface CapabilityAuditRecorder {
  record(params: {
    eventType: "policy.updated";
    actorType: "user";
    actorId: string;
    entityType: string;
    entityId: string;
    riskCategory: "high";
    summary: string;
    snapshot: Record<string, unknown>;
  }): Promise<unknown>;
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
    select: { id: true, governanceSettings: true },
  });
  if (!deployment) {
    throw new Error(
      `no riley deployment for org ${args.organizationId} - seed it first (seedRileyAdOptimizerDeployment)`,
    );
  }
  const settings = (deployment.governanceSettings as Record<string, unknown> | null) ?? {};
  const previous = settings["pauseSelfExecutionEnabled"] === true;
  await prisma.agentDeployment.update({
    where: { id: deployment.id },
    data: {
      // Read-modify-write preserving every other governanceSettings key
      // (trustLevelOverride, spendAutonomy, ...).
      governanceSettings: { ...settings, pauseSelfExecutionEnabled: args.enabled },
    },
  });
  await ledger.record({
    eventType: "policy.updated",
    actorType: "user",
    actorId: args.actor,
    entityType: "deployment",
    entityId: deployment.id,
    riskCategory: "high",
    summary: `riley pauseSelfExecutionEnabled: ${previous} -> ${args.enabled} (org ${args.organizationId}, by ${args.actor})`,
    snapshot: {
      flag: "pauseSelfExecutionEnabled",
      previous,
      current: args.enabled,
      organizationId: args.organizationId,
      deploymentId: deployment.id,
    },
  });
  return { previous, current: args.enabled };
}
