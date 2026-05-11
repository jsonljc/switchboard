-- AlterTable
ALTER TABLE "AgentDeployment" ADD COLUMN     "governanceConfig" JSONB;

-- CreateTable
CREATE TABLE "GovernanceVerdict" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "clinicType" TEXT NOT NULL,
    "sourceGuard" TEXT NOT NULL,
    "originalText" TEXT,
    "emittedText" TEXT,
    "auditLevel" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "modelLatencyMs" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovernanceVerdict_deploymentId_decidedAt_idx" ON "GovernanceVerdict"("deploymentId", "decidedAt");

-- CreateIndex
CREATE INDEX "GovernanceVerdict_conversationId_decidedAt_idx" ON "GovernanceVerdict"("conversationId", "decidedAt");

-- CreateIndex
CREATE INDEX "GovernanceVerdict_deploymentId_sourceGuard_decidedAt_idx" ON "GovernanceVerdict"("deploymentId", "sourceGuard", "decidedAt");

-- AddForeignKey
ALTER TABLE "GovernanceVerdict" ADD CONSTRAINT "GovernanceVerdict_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

