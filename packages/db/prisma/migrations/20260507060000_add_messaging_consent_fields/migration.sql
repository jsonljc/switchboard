-- WhatsApp Business API messaging consent — separate from creative-pipeline ConsentRecord.
-- Required for proactive template sends outside the 24hr conversation window.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "messagingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contact" ADD COLUMN "messagingOptInAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "messagingOptInSource" TEXT;
ALTER TABLE "Contact" ADD COLUMN "messagingOptOutAt" TIMESTAMP(3);
