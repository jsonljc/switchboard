-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN "onboardingPlaybook" JSONB;
ALTER TABLE "OrganizationConfig" ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrganizationConfig" ADD COLUMN "firstRunPhase" JSONB;
