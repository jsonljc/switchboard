-- AlterTable
ALTER TABLE "ConversationThread" ADD COLUMN     "lastWhatsAppInboundAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ConversationThread_organizationId_lastWhatsAppInboundAt_idx" ON "ConversationThread"("organizationId", "lastWhatsAppInboundAt");

