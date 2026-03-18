CREATE TABLE "RevenueEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reference" TEXT,
    "recordedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevenueEvent_contactId_idx" ON "RevenueEvent"("contactId");
CREATE INDEX "RevenueEvent_organizationId_idx" ON "RevenueEvent"("organizationId");
CREATE INDEX "RevenueEvent_timestamp_idx" ON "RevenueEvent"("timestamp");
