-- AlterTable
ALTER TABLE "PendingActionRecord" ADD COLUMN     "surface" TEXT NOT NULL DEFAULT 'queue',
ADD COLUMN     "undoableUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PendingActionRecord_organizationId_surface_status_idx" ON "PendingActionRecord"("organizationId", "surface", "status");

-- CreateIndex
CREATE INDEX "PendingActionRecord_organizationId_undoableUntil_idx" ON "PendingActionRecord"("organizationId", "undoableUntil");
