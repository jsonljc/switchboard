-- AlterTable
ALTER TABLE "WorkTrace" ADD COLUMN "contentHash" TEXT,
ADD COLUMN "traceVersion" INTEGER NOT NULL DEFAULT 0;
