-- Add marketplace models: AgentListing, AgentDeployment, AgentTask, TrustScoreRecord
-- Remove dead SMB fields from OrganizationConfig

-- ── Remove SMB fields from OrganizationConfig ──

ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "tier";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "smbOwnerId";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "smbPerActionLimit";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "smbDailyLimit";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "smbAllowedActions";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "smbBlockedActions";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "selectedCartridgeId";
ALTER TABLE "OrganizationConfig" DROP COLUMN IF EXISTS "skinId";

-- ── AgentListing (global marketplace catalog) ──

CREATE TABLE "AgentListing" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'switchboard_native',
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "taskCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "autonomyLevel" TEXT NOT NULL DEFAULT 'supervised',
    "priceTier" TEXT NOT NULL DEFAULT 'free',
    "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "vettingNotes" TEXT,
    "sourceUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentListing_slug_key" ON "AgentListing"("slug");
CREATE INDEX "AgentListing_status_idx" ON "AgentListing"("status");
CREATE INDEX "AgentListing_type_idx" ON "AgentListing"("type");

-- ── AgentDeployment (founder's instance of a listing) ──

CREATE TABLE "AgentDeployment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "inputConfig" JSONB NOT NULL DEFAULT '{}',
    "governanceSettings" JSONB NOT NULL DEFAULT '{}',
    "outputDestination" JSONB,
    "connectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDeployment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentDeployment_organizationId_listingId_key" ON "AgentDeployment"("organizationId", "listingId");
CREATE INDEX "AgentDeployment_organizationId_idx" ON "AgentDeployment"("organizationId");
CREATE INDEX "AgentDeployment_status_idx" ON "AgentDeployment"("status");

ALTER TABLE "AgentDeployment" ADD CONSTRAINT "AgentDeployment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "AgentListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── AgentTask (units of work) ──

CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "acceptanceCriteria" TEXT,
    "reviewResult" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentTask_deploymentId_idx" ON "AgentTask"("deploymentId");
CREATE INDEX "AgentTask_organizationId_idx" ON "AgentTask"("organizationId");
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");
CREATE INDEX "AgentTask_listingId_category_idx" ON "AgentTask"("listingId", "category");

ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "AgentDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "AgentListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── TrustScoreRecord (per-listing per-category) ──

CREATE TABLE "TrustScoreRecord" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "taskCategory" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "totalApprovals" INTEGER NOT NULL DEFAULT 0,
    "totalRejections" INTEGER NOT NULL DEFAULT 0,
    "consecutiveApprovals" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustScoreRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrustScoreRecord_listingId_taskCategory_key" ON "TrustScoreRecord"("listingId", "taskCategory");
CREATE INDEX "TrustScoreRecord_listingId_idx" ON "TrustScoreRecord"("listingId");

ALTER TABLE "TrustScoreRecord" ADD CONSTRAINT "TrustScoreRecord_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "AgentListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
