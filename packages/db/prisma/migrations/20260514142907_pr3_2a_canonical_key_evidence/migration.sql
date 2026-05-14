-- AlterTable
ALTER TABLE "DeploymentMemory" ADD COLUMN     "canonicalKey" TEXT;

-- CreateTable
CREATE TABLE "DeploymentMemoryEvidence" (
    "id" TEXT NOT NULL,
    "deploymentMemoryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT,
    "conversionRecordId" TEXT,
    "workTraceId" TEXT,
    "attributionTier" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentMemoryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeploymentMemoryEvidence_deploymentMemoryId_idx" ON "DeploymentMemoryEvidence"("deploymentMemoryId");

-- CreateIndex
CREATE INDEX "DeploymentMemoryEvidence_deploymentMemoryId_bookingId_idx" ON "DeploymentMemoryEvidence"("deploymentMemoryId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentMemoryEvidence_deploymentMemoryId_bookingId_key" ON "DeploymentMemoryEvidence"("deploymentMemoryId", "bookingId");

-- CreateIndex
CREATE INDEX "DeploymentMemory_organizationId_deploymentId_category_canon_idx" ON "DeploymentMemory"("organizationId", "deploymentId", "category", "canonicalKey");

