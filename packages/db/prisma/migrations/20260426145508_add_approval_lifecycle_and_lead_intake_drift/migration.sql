-- Backfill migration: schema additions that previously landed in
-- packages/db/prisma/schema.prisma without their generated migrations.
-- Brings a fresh DB to the same state as one running this branch's schema.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "leadgenId" TEXT;

-- AlterTable
ALTER TABLE "ConversationThread" ADD COLUMN     "firstAgentMessageAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApprovalLifecycle" (
    "id" TEXT NOT NULL,
    "actionEnvelopeId" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentRevisionId" TEXT,
    "currentExecutableWorkUnitId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pausedSessionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRevision" (
    "id" TEXT NOT NULL,
    "lifecycleId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "parametersSnapshot" JSONB NOT NULL,
    "approvalScopeSnapshot" JSONB NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "rationale" TEXT,
    "supersedesRevisionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutableWorkUnit" (
    "id" TEXT NOT NULL,
    "lifecycleId" TEXT NOT NULL,
    "approvalRevisionId" TEXT NOT NULL,
    "actionEnvelopeId" TEXT NOT NULL,
    "frozenPayload" JSONB NOT NULL,
    "frozenBinding" JSONB NOT NULL,
    "frozenExecutionPolicy" JSONB NOT NULL,
    "executableUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutableWorkUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRecord" (
    "id" TEXT NOT NULL,
    "executableWorkUnitId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'dispatching',
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "DispatchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEventLog" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "PendingLeadRetry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PendingLeadRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLifecycle_actionEnvelopeId_key" ON "ApprovalLifecycle"("actionEnvelopeId");

-- CreateIndex
CREATE INDEX "ApprovalLifecycle_status_idx" ON "ApprovalLifecycle"("status");

-- CreateIndex
CREATE INDEX "ApprovalLifecycle_organizationId_status_idx" ON "ApprovalLifecycle"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalLifecycle_expiresAt_idx" ON "ApprovalLifecycle"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRevision_lifecycleId_idx" ON "ApprovalRevision"("lifecycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRevision_lifecycleId_revisionNumber_key" ON "ApprovalRevision"("lifecycleId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutableWorkUnit_approvalRevisionId_key" ON "ExecutableWorkUnit"("approvalRevisionId");

-- CreateIndex
CREATE INDEX "ExecutableWorkUnit_lifecycleId_idx" ON "ExecutableWorkUnit"("lifecycleId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchRecord_idempotencyKey_key" ON "DispatchRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DispatchRecord_executableWorkUnitId_idx" ON "DispatchRecord"("executableWorkUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchRecord_executableWorkUnitId_attemptNumber_key" ON "DispatchRecord"("executableWorkUnitId", "attemptNumber");

-- CreateIndex
CREATE INDEX "PendingLeadRetry_organizationId_resolvedAt_idx" ON "PendingLeadRetry"("organizationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "PendingLeadRetry_nextRetryAt_resolvedAt_idx" ON "PendingLeadRetry"("nextRetryAt", "resolvedAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_leadgenId_idx" ON "Contact"("organizationId", "leadgenId");
