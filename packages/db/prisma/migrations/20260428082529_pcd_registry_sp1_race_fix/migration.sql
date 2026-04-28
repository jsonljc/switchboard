/*
  Warnings:

  - A unique constraint covering the columns `[orgId,title]` on the table `ProductIdentity` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ProductIdentity_orgId_title_key" ON "ProductIdentity"("orgId", "title");

-- Partial unique index: at most one Tier-1 stock CreatorIdentity per deployment.
-- Prisma 6 schema syntax cannot express partial indexes, so it lives in raw SQL.
CREATE UNIQUE INDEX "CreatorIdentity_deploymentId_stock_unique"
  ON "CreatorIdentity" ("deploymentId")
  WHERE "qualityTier" = 'stock';
