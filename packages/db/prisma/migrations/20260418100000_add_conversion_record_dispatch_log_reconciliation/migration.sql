-- CreateTable
CREATE TABLE "ConversionRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceAdId" TEXT,
    "sourceCampaignId" TEXT,
    "sourceChannel" TEXT,
    "agentDeploymentId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "responsePayload" JSONB,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dateRangeFrom" TIMESTAMP(3) NOT NULL,
    "dateRangeTo" TIMESTAMP(3) NOT NULL,
    "overallStatus" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversionRecord_eventId_key" ON "ConversionRecord"("eventId");

-- CreateIndex
CREATE INDEX "ConversionRecord_organizationId_type_occurredAt_idx" ON "ConversionRecord"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversionRecord_organizationId_sourceCampaignId_idx" ON "ConversionRecord"("organizationId", "sourceCampaignId");

-- CreateIndex
CREATE INDEX "ConversionRecord_contactId_idx" ON "ConversionRecord"("contactId");

-- CreateIndex
CREATE INDEX "DispatchLog_eventId_idx" ON "DispatchLog"("eventId");

-- CreateIndex
CREATE INDEX "DispatchLog_platform_status_attemptedAt_idx" ON "DispatchLog"("platform", "status", "attemptedAt");

-- CreateIndex
CREATE INDEX "ReconciliationReport_organizationId_createdAt_idx" ON "ReconciliationReport"("organizationId", "createdAt");
