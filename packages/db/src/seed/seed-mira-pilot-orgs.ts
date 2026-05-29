import type { PrismaClient } from "@prisma/client";

/**
 * Enables Mira (opt-in) for an explicit list of pilot orgs. Idempotent.
 * Mira is launchTier "day-thirty" and is NOT seeded by seedOrgDayOneAgents —
 * this is the deliberate, per-org pilot path. There is NO global day-one flip.
 */
export async function seedMiraPilotOrgs(
  prisma: PrismaClient,
  pilotOrgIds: string[],
): Promise<void> {
  await Promise.all(
    pilotOrgIds.map((orgId) =>
      prisma.orgAgentEnablement.upsert({
        where: { orgId_agentKey: { orgId, agentKey: "mira" } },
        create: { orgId, agentKey: "mira", status: "enabled" },
        update: { status: "enabled" },
      }),
    ),
  );
}
