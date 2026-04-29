-- AlterTable
ALTER TABLE "WorkTrace"
  ADD COLUMN "ingress_path" TEXT NOT NULL DEFAULT 'platform_ingress',
  ADD COLUMN "hash_input_version" INTEGER NOT NULL DEFAULT 1;
