-- AlterTable: add createdAt to ConversationState with a default of CURRENT_TIMESTAMP
-- Existing rows will receive the current timestamp (backfill is intentional — all
-- historical rows are treated as "created now" for latency reporting purposes, which
-- means they will appear in today's stats only if they were genuinely created today).
ALTER TABLE "ConversationState" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ConversationState_organizationId_createdAt_idx" ON "ConversationState"("organizationId", "createdAt");
