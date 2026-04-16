-- AlterTable
ALTER TABLE "AgentDeployment" ADD COLUMN "allowedModelTiers" TEXT[] DEFAULT ARRAY[]::TEXT[];
