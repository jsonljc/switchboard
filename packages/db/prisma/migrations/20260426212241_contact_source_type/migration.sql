-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "sourceType" TEXT;

-- CreateIndex
CREATE INDEX "Contact_organizationId_sourceType_createdAt_idx" ON "Contact"("organizationId", "sourceType", "createdAt");
