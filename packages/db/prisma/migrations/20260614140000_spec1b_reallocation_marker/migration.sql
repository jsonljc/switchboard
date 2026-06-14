-- AlterTable
ALTER TABLE "PendingActionRecord" ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "executionWorkUnitId" TEXT;

-- CreateTable
CREATE TABLE "MetaMutationAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "executionWorkUnitId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "heldUntil" TIMESTAMP(3) NOT NULL,
    "observedPriorCents" INTEGER NOT NULL,
    "requestedToCents" INTEGER NOT NULL,
    "workTraceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaMutationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaMutationAttempt_executionWorkUnitId_key" ON "MetaMutationAttempt"("executionWorkUnitId");

-- CreateIndex
CREATE INDEX "MetaMutationAttempt_organizationId_adAccountId_campaignId_s_idx" ON "MetaMutationAttempt"("organizationId", "adAccountId", "campaignId", "status", "heldUntil");

-- CreateIndex
CREATE INDEX "PendingActionRecord_organizationId_status_executedAt_idx" ON "PendingActionRecord"("organizationId", "status", "executedAt");

