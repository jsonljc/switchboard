-- CreateTable
CREATE TABLE "ConversationThread" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "assignedAgent" TEXT NOT NULL DEFAULT 'lead-responder',
    "agentContext" JSONB NOT NULL DEFAULT '{}',
    "currentSummary" TEXT NOT NULL DEFAULT '',
    "followUpSchedule" JSONB NOT NULL DEFAULT '{"nextFollowUpAt":null,"reason":null,"cadenceId":null}',
    "lastOutcomeAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationThread_organizationId_idx" ON "ConversationThread"("organizationId");

-- CreateIndex
CREATE INDEX "ConversationThread_stage_idx" ON "ConversationThread"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationThread_contactId_organizationId_key" ON "ConversationThread"("contactId", "organizationId");
