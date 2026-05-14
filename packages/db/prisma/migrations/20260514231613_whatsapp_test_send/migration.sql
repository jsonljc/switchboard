-- AlterTable
ALTER TABLE "ManagedChannel" ADD COLUMN     "testRecipients" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "WhatsAppTestSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managedChannelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiStatus" TEXT NOT NULL DEFAULT 'sent',
    "lastWebhookStatus" TEXT,
    "lastWebhookAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppTestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTestSend_messageId_key" ON "WhatsAppTestSend"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppTestSend_organizationId_sentAt_idx" ON "WhatsAppTestSend"("organizationId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "WhatsAppTestSend_managedChannelId_sentAt_idx" ON "WhatsAppTestSend"("managedChannelId", "sentAt" DESC);

