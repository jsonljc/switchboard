-- CreateTable
CREATE TABLE "ReceiptedBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributionConfidence" TEXT NOT NULL,
    "attributionUpdatedAt" TIMESTAMP(3) NOT NULL,
    "expectedValueAtIssue" INTEGER,
    "currency" TEXT,
    "exceptions" JSONB NOT NULL,
    "overriddenBy" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptedBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptedBooking_bookingId_key" ON "ReceiptedBooking"("bookingId");

-- CreateIndex
CREATE INDEX "ReceiptedBooking_organizationId_issuedAt_idx" ON "ReceiptedBooking"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "ReceiptedBooking_organizationId_attributionConfidence_idx" ON "ReceiptedBooking"("organizationId", "attributionConfidence");
