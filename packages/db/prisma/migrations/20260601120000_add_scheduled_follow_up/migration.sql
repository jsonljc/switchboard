-- CreateTable
CREATE TABLE "ScheduledFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationThreadId" TEXT,
    "sessionId" TEXT,
    "deploymentId" TEXT,
    "workUnitId" TEXT,
    "channel" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "reason" TEXT NOT NULL,
    "templateIntentClass" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "skipReason" TEXT,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledFollowUp_dedupeKey_key" ON "ScheduledFollowUp"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_status_dueAt_idx" ON "ScheduledFollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_organizationId_contactId_idx" ON "ScheduledFollowUp"("organizationId", "contactId");
