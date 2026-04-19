-- AlterTable
ALTER TABLE "WorkTrace" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkTrace_idempotencyKey_key" ON "WorkTrace"("idempotencyKey");
