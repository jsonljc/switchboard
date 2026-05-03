-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN     "useAgentFirstNav" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrgAgentEnablement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgAgentEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgAgentEnablement_orgId_idx" ON "OrgAgentEnablement"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAgentEnablement_orgId_agentKey_key" ON "OrgAgentEnablement"("orgId", "agentKey");

-- Backfill: enable Alex + Riley for every existing OrganizationConfig.
-- Mira intentionally not seeded (launchTier = day-thirty per AGENT_REGISTRY).
INSERT INTO "OrgAgentEnablement" ("id", "orgId", "agentKey", "status", "enabledAt", "updatedAt")
SELECT gen_random_uuid(), oc.id, agent_key, 'enabled', NOW(), NOW()
FROM "OrganizationConfig" oc, (VALUES ('alex'), ('riley')) AS agents(agent_key)
ON CONFLICT ("orgId", "agentKey") DO NOTHING;
