-- CreateTable
CREATE TABLE "ConversationLifecycleSnapshot" (
    "conversationThreadId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "qualificationStatus" TEXT NOT NULL DEFAULT 'unknown',
    "bookingStatus" TEXT NOT NULL DEFAULT 'not_booked',
    "dropoffReason" TEXT,
    "lastTransitionAt" TIMESTAMP(3) NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationLifecycleSnapshot_pkey" PRIMARY KEY ("conversationThreadId")
);

-- CreateTable
CREATE TABLE "ConversationLifecycleTransition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationThreadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "workTraceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationLifecycleTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationLifecycleSnapshot_organizationId_currentState_idx" ON "ConversationLifecycleSnapshot"("organizationId", "currentState");

-- CreateIndex
CREATE INDEX "ConversationLifecycleSnapshot_organizationId_qualificationStatus_bookingStatus_idx" ON "ConversationLifecycleSnapshot"("organizationId", "qualificationStatus", "bookingStatus");

-- CreateIndex
CREATE INDEX "ConversationLifecycleSnapshot_organizationId_currentState_lastTransitionAt_idx" ON "ConversationLifecycleSnapshot"("organizationId", "currentState", "lastTransitionAt");

-- CreateIndex
CREATE INDEX "ConversationLifecycleSnapshot_organizationId_lastEvaluatedAt_idx" ON "ConversationLifecycleSnapshot"("organizationId", "lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "ConversationLifecycleTransition_organizationId_conversationThreadId_occurredAt_idx" ON "ConversationLifecycleTransition"("organizationId", "conversationThreadId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversationLifecycleTransition_organizationId_toState_occurredAt_idx" ON "ConversationLifecycleTransition"("organizationId", "toState", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversationLifecycleTransition_organizationId_trigger_occurredAt_idx" ON "ConversationLifecycleTransition"("organizationId", "trigger", "occurredAt");
