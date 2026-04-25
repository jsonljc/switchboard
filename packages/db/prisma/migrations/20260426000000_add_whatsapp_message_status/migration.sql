-- CreateTable
CREATE TABLE "WhatsAppMessageStatus" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "pricingCategory" TEXT,
    "billable" BOOLEAN,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessageStatus_messageId_status_key" ON "WhatsAppMessageStatus"("messageId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppMessageStatus_messageId_idx" ON "WhatsAppMessageStatus"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessageStatus_organizationId_createdAt_idx" ON "WhatsAppMessageStatus"("organizationId", "createdAt");
