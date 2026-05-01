-- AlterTable: add createdAt to ConversationState with a default of CURRENT_TIMESTAMP
-- New rows default to now(). Existing rows are backfilled below.
ALTER TABLE "ConversationState" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: set createdAt to the best available creation-time approximation for
-- existing rows. Without this, pre-deploy rows would all receive CURRENT_TIMESTAMP,
-- causing replyTimeStats to misclassify late-replied-to-old-conversations as
-- fast replies for the first 24h post-deploy (firstReplyAt - createdAt would be
-- artificially small). Using lastInboundAt (the first inbound message timestamp)
-- as the proxy; fall back to lastActivityAt if null; fall back to CURRENT_TIMESTAMP
-- if both are null.
UPDATE "ConversationState"
SET "createdAt" = COALESCE("lastInboundAt", "lastActivityAt", CURRENT_TIMESTAMP);

-- CreateIndex
CREATE INDEX "ConversationState_organizationId_createdAt_idx" ON "ConversationState"("organizationId", "createdAt");
