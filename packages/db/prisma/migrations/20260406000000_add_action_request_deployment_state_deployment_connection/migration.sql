-- AlterTable
ALTER TABLE "TrustScoreRecord" ADD COLUMN "deploymentId" TEXT;

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "governanceResult" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentState" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentConnection" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'active',
    "credentials" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustScoreRecord_deploymentId_idx" ON "TrustScoreRecord"("deploymentId");

-- CreateIndex
CREATE INDEX "ActionRequest_deploymentId_status_idx" ON "ActionRequest"("deploymentId", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_status_createdAt_idx" ON "ActionRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentState_deploymentId_key_key" ON "DeploymentState"("deploymentId", "key");

-- CreateIndex
CREATE INDEX "DeploymentState_deploymentId_idx" ON "DeploymentState"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentConnection_deploymentId_type_slot_key" ON "DeploymentConnection"("deploymentId", "type", "slot");

-- CreateIndex
CREATE INDEX "DeploymentConnection_deploymentId_idx" ON "DeploymentConnection"("deploymentId");

-- AddForeignKey
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentState" ADD CONSTRAINT "DeploymentState_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentConnection" ADD CONSTRAINT "DeploymentConnection_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
