-- Receipt: shared calendar|payment proof primitive (spec 1A-3).
-- The partial UNIQUE on (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL
-- dedupes externally-referenced receipts (PSP charge id / external event id) without
-- blocking the many calendar receipts that have a NULL externalRef. Prisma 6 cannot
-- express a partial unique in-schema (same pattern as 20260603120000_booking_partial_unique_active).
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bookingId" TEXT,
    "opportunityId" TEXT,
    "revenueEventId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT,
    "externalRef" TEXT,
    "amount" INTEGER,
    "currency" TEXT,
    "evidence" JSONB NOT NULL,
    "capturedBy" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "workTraceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_organizationId_bookingId_idx" ON "Receipt"("organizationId", "bookingId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_kind_status_idx" ON "Receipt"("organizationId", "kind", "status");

-- Partial unique: dedupe externally-referenced receipts only (NULL externalRef allowed many).
CREATE UNIQUE INDEX "Receipt_org_kind_externalRef_key"
  ON "Receipt" ("organizationId", "kind", "externalRef")
  WHERE "externalRef" IS NOT NULL;
