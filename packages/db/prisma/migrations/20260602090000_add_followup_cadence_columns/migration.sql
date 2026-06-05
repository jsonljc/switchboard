-- AlterTable
ALTER TABLE "ScheduledFollowUp" ADD COLUMN "touchNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScheduledFollowUp" ADD COLUMN "cadenceId" TEXT;
