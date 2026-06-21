-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "duplicateContactRisk" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Contact_organizationId_email_idx" ON "Contact"("organizationId", "email");
