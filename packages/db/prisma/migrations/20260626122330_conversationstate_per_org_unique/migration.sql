-- Tenant isolation (adversarial audit #2): ConversationState.threadId (the bare
-- customer MSISDN) was globally UNIQUE, so a phone shared across two orgs collapsed
-- to one row — org A's human_override leaked into / clobbered org B. Make threadId
-- unique PER ORG instead.
--
-- organizationId stays nullable: Postgres treats NULLs as DISTINCT in a unique
-- index, so pre-existing org-blind rows are left INERT — NOT backfilled. An
-- org-blind row's org is un-inferable (shared phones are genuinely multi-org and
-- principalId phone shapes vary), and a wrong derivation would itself be a
-- cross-tenant misassignment. Inert rows stop matching org-scoped reads and are
-- reaped by the expiresAt TTL. The compound unique's leading column (organizationId)
-- subsumes the dropped standalone org index.

-- DropIndex
DROP INDEX "ConversationState_threadId_key";

-- DropIndex
DROP INDEX "ConversationState_organizationId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_organizationId_threadId_key" ON "ConversationState"("organizationId", "threadId");
