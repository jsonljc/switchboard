-- AlterTable
ALTER TABLE "RobinRecoverySend" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RobinRecoverySend_status_nextRetryAt_idx" ON "RobinRecoverySend"("status", "nextRetryAt");
