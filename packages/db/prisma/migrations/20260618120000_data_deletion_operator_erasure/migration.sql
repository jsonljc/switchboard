-- AlterTable
-- Add the operator-erasure producer discriminator + org-scope/provenance columns to the
-- data-erasure request log. All columns are additive and nullable/defaulted, so existing Meta
-- Data Deletion Callback rows keep their semantics (requestType defaults to "meta_data_deletion").
ALTER TABLE "DataDeletionRequest"
  ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'meta_data_deletion',
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "requestedByActorId" TEXT;

-- CreateIndex
CREATE INDEX "DataDeletionRequest_organizationId_idx" ON "DataDeletionRequest"("organizationId");
