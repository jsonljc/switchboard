-- CreateTable
CREATE TABLE "ApprovedComplianceClaim" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedComplianceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovedComplianceClaim_deploymentId_jurisdiction_claimType_idx" ON "ApprovedComplianceClaim"("deploymentId", "jurisdiction", "claimType");

-- CreateIndex
CREATE INDEX "ApprovedComplianceClaim_deploymentId_validUntil_idx" ON "ApprovedComplianceClaim"("deploymentId", "validUntil");

-- AddForeignKey
ALTER TABLE "ApprovedComplianceClaim" ADD CONSTRAINT "ApprovedComplianceClaim_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
