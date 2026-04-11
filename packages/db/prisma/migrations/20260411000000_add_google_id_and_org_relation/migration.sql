-- AlterTable: add googleId to DashboardUser
ALTER TABLE "DashboardUser" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DashboardUser_googleId_key" ON "DashboardUser"("googleId");

-- AddForeignKey: DashboardUser.organizationId -> OrganizationConfig.id
ALTER TABLE "DashboardUser" ADD CONSTRAINT "DashboardUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "OrganizationConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
