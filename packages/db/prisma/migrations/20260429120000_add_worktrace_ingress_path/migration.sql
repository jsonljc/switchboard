-- AlterTable
ALTER TABLE "WorkTrace"
  ADD COLUMN "ingressPath" TEXT NOT NULL DEFAULT 'platform_ingress',
  ADD COLUMN "hashInputVersion" INTEGER NOT NULL DEFAULT 1;
