-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_idempotencyKey_key" ON "Contact"("organizationId", "idempotencyKey");
