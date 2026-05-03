import type { PrismaClient } from "@prisma/client";
import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";

/**
 * Seeds OrgAgentEnablement rows for every day-one agent for a freshly created org.
 * Idempotent — safe to call multiple times. Mira (day-thirty) is intentionally
 * not seeded; she's enabled in a follow-up backfill 30 days post-launch.
 *
 * Call this from every site that creates an OrganizationConfig:
 *   - packages/db/prisma/seed.ts (dev seed)
 *   - apps/api/src/routes/organizations.ts (signup/upsert path)
 */
export async function seedOrgDayOneAgents(prisma: PrismaClient, orgId: string): Promise<void> {
  const dayOneKeys = (Object.keys(AGENT_REGISTRY) as AgentKey[]).filter(
    (key) => AGENT_REGISTRY[key].launchTier === "day-one",
  );
  await Promise.all(
    dayOneKeys.map((agentKey) =>
      prisma.orgAgentEnablement.upsert({
        where: { orgId_agentKey: { orgId, agentKey } },
        create: { orgId, agentKey, status: "enabled" },
        update: {}, // no-op on re-run
      }),
    ),
  );
}
