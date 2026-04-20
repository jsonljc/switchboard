-- DropForeignKey
ALTER TABLE "ContactAlias" DROP CONSTRAINT IF EXISTS "ContactAlias_contactId_fkey";
ALTER TABLE "CrmActivity" DROP CONSTRAINT IF EXISTS "CrmActivity_contactId_fkey";
ALTER TABLE "CrmActivity" DROP CONSTRAINT IF EXISTS "CrmActivity_dealId_fkey";
ALTER TABLE "CrmDeal" DROP CONSTRAINT IF EXISTS "CrmDeal_contactId_fkey";
ALTER TABLE "RevGrowthDiagnosticCycle" DROP CONSTRAINT IF EXISTS "RevGrowthDiagnosticCycle_revenueAccountId_fkey";
ALTER TABLE "RevGrowthIntervention" DROP CONSTRAINT IF EXISTS "RevGrowthIntervention_cycleId_fkey";
ALTER TABLE "RevGrowthIntervention" DROP CONSTRAINT IF EXISTS "RevGrowthIntervention_revenueAccountId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "KnowledgeChunk_embedding_idx";

-- AlterTable
ALTER TABLE "AgentDeployment" ADD COLUMN "circuitBreakerThreshold" INTEGER,
ADD COLUMN "maxWritesPerHour" INTEGER;

-- AlterTable
ALTER TABLE "AgentListing" ALTER COLUMN "trustScore" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN "externalAccountId" TEXT,
ADD COLUMN "greetingTemplateName" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "qualificationData" JSONB;

-- AlterTable
ALTER TABLE "ConversationThread" ALTER COLUMN "assignedAgent" SET DEFAULT '';

-- AlterTable
ALTER TABLE "CreativeJob" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'polished',
ADD COLUMN "ugcConfig" JSONB,
ADD COLUMN "ugcFailure" JSONB,
ADD COLUMN "ugcPhase" TEXT,
ADD COLUMN "ugcPhaseOutputs" JSONB,
ADD COLUMN "ugcPhaseOutputsVersion" TEXT DEFAULT 'v1';

-- AlterTable
ALTER TABLE "KnowledgeChunk" ADD COLUMN "deploymentId" TEXT;

-- AlterTable
ALTER TABLE "TrustScoreRecord" ALTER COLUMN "score" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkTrace" ADD COLUMN "approvalId" TEXT,
ADD COLUMN "approvalOutcome" TEXT,
ADD COLUMN "approvalRespondedAt" TIMESTAMP(3),
ADD COLUMN "approvalRespondedBy" TEXT,
ADD COLUMN "deploymentContext" TEXT,
ADD COLUMN "executionOutputs" TEXT,
ADD COLUMN "executionSummary" TEXT,
ADD COLUMN "governanceConstraints" TEXT,
ADD COLUMN "parameters" TEXT;

-- DropTable
DROP TABLE IF EXISTS "AdsOperatorConfig";
DROP TABLE IF EXISTS "AlertHistory";
DROP TABLE IF EXISTS "AlertRule";
DROP TABLE IF EXISTS "CadenceInstance";
DROP TABLE IF EXISTS "ConnectorHealthLog";
DROP TABLE IF EXISTS "ContactAlias";
DROP TABLE IF EXISTS "ContentCalendarEntry";
DROP TABLE IF EXISTS "ContentDraft";
DROP TABLE IF EXISTS "CrmActivity";
DROP TABLE IF EXISTS "CrmContact";
DROP TABLE IF EXISTS "CrmDeal";
DROP TABLE IF EXISTS "EmployeePerformanceEvent";
DROP TABLE IF EXISTS "EmployeeRegistration";
DROP TABLE IF EXISTS "EmployeeSkill";
DROP TABLE IF EXISTS "OptimisationProposal";
DROP TABLE IF EXISTS "OutcomeEvent";
DROP TABLE IF EXISTS "ResponseVariantLog";
DROP TABLE IF EXISTS "RevGrowthDiagnosticCycle";
DROP TABLE IF EXISTS "RevGrowthIntervention";
DROP TABLE IF EXISTS "RevGrowthWeeklyDigest";
DROP TABLE IF EXISTS "RevenueAccount";
DROP TABLE IF EXISTS "RevenueEvent";
DROP TABLE IF EXISTS "RoasSnapshot";
DROP TABLE IF EXISTS "ScheduledReport";
DROP TABLE IF EXISTS "SmbActivityLogEntry";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssetRecord_specId_idx" ON "AssetRecord"("specId");
CREATE INDEX IF NOT EXISTS "AssetRecord_approvalState_idx" ON "AssetRecord"("approvalState");
CREATE UNIQUE INDEX IF NOT EXISTS "AssetRecord_specId_attemptNumber_provider_key" ON "AssetRecord"("specId", "attemptNumber", "provider");
CREATE INDEX IF NOT EXISTS "Connection_externalAccountId_idx" ON "Connection"("externalAccountId");
CREATE INDEX IF NOT EXISTS "CreativeJob_deploymentId_idx" ON "CreativeJob"("deploymentId");
CREATE INDEX IF NOT EXISTS "CreativeJob_mode_idx" ON "CreativeJob"("mode");
CREATE INDEX IF NOT EXISTS "ExecutionTrace_status_idx" ON "ExecutionTrace"("status");
CREATE INDEX IF NOT EXISTS "ExecutionTrace_sessionId_idx" ON "ExecutionTrace"("sessionId");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_organizationId_deploymentId_idx" ON "KnowledgeChunk"("organizationId", "deploymentId");
CREATE INDEX IF NOT EXISTS "WorkTrace_approvalId_idx" ON "WorkTrace"("approvalId");

-- RenameIndex
ALTER INDEX "DeploymentMemory_organizationId_deploymentId_category_content_k" RENAME TO "DeploymentMemory_organizationId_deploymentId_category_conte_key";
