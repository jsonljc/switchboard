-- CreateTable
CREATE TABLE "RobinRecoverySend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "campaignKind" TEXT NOT NULL DEFAULT 'no_show',
    "campaignWorkUnitId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "lastError" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobinRecoverySend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RobinRecoverySend_dedupeKey_key" ON "RobinRecoverySend"("dedupeKey");

-- CreateIndex
CREATE INDEX "RobinRecoverySend_organizationId_bookingId_idx" ON "RobinRecoverySend"("organizationId", "bookingId");
