-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN "purchasedAgents" TEXT[] DEFAULT ARRAY[]::TEXT[];
