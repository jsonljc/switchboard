-- AlterTable: add slug to AgentDeployment
ALTER TABLE "AgentDeployment" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "AgentDeployment_slug_key" ON "AgentDeployment"("slug");

-- AlterTable: add tokenHash to DeploymentConnection
ALTER TABLE "DeploymentConnection" ADD COLUMN "tokenHash" TEXT;
CREATE UNIQUE INDEX "DeploymentConnection_tokenHash_key" ON "DeploymentConnection"("tokenHash");
