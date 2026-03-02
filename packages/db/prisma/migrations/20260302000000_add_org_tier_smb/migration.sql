-- AlterTable: Add tier and SMB-specific columns to OrganizationConfig
ALTER TABLE "OrganizationConfig" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'smb';
ALTER TABLE "OrganizationConfig" ADD COLUMN "smbOwnerId" TEXT;
ALTER TABLE "OrganizationConfig" ADD COLUMN "smbPerActionLimit" DOUBLE PRECISION;
ALTER TABLE "OrganizationConfig" ADD COLUMN "smbDailyLimit" DOUBLE PRECISION;
ALTER TABLE "OrganizationConfig" ADD COLUMN "smbAllowedActions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OrganizationConfig" ADD COLUMN "smbBlockedActions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Data migration: Set existing onboarded orgs to enterprise to preserve current behavior
UPDATE "OrganizationConfig" SET "tier" = 'enterprise' WHERE "onboardingComplete" = true;

-- CreateTable: SmbActivityLogEntry
CREATE TABLE "SmbActivityLogEntry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "envelopeId" TEXT,
    "organizationId" TEXT NOT NULL,
    "redactionApplied" BOOLEAN NOT NULL DEFAULT false,
    "redactedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "SmbActivityLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmbActivityLogEntry_organizationId_timestamp_idx" ON "SmbActivityLogEntry"("organizationId", "timestamp");
CREATE INDEX "SmbActivityLogEntry_actorId_idx" ON "SmbActivityLogEntry"("actorId");
CREATE INDEX "SmbActivityLogEntry_envelopeId_idx" ON "SmbActivityLogEntry"("envelopeId");
