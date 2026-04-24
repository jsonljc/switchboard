-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "OrganizationConfig" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "OrganizationConfig" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "OrganizationConfig" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "OrganizationConfig" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "OrganizationConfig" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConfig_stripeCustomerId_key" ON "OrganizationConfig"("stripeCustomerId");
