-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "KnowledgeChunk" ADD COLUMN "draftStatus" TEXT,
                              ADD COLUMN "draftExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentDeployment" ADD COLUMN "trustLevel" TEXT NOT NULL DEFAULT 'observe',
                               ADD COLUMN "spendApprovalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 50;

-- CreateIndex
CREATE INDEX "AgentEvent_status_createdAt_idx" ON "AgentEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_organizationId_deploymentId_idx" ON "AgentEvent"("organizationId", "deploymentId");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_deploymentId_idx" ON "ActivityLog"("organizationId", "deploymentId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
