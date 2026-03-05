-- AlterTable: rename patientId to contactId on CadenceInstance
ALTER TABLE "CadenceInstance" RENAME COLUMN "patientId" TO "contactId";

-- RenameIndex (drop old, create new)
DROP INDEX IF EXISTS "CadenceInstance_patientId_idx";
CREATE INDEX "CadenceInstance_contactId_idx" ON "CadenceInstance"("contactId");
