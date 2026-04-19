-- CreateIndex
CREATE UNIQUE INDEX "DeploymentMemory_organizationId_deploymentId_category_content_key" ON "DeploymentMemory"("organizationId", "deploymentId", "category", "content");
