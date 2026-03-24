-- CreateTable: AgentRoster
CREATE TABLE "AgentRoster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tier" TEXT NOT NULL DEFAULT 'starter',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentState
CREATE TABLE "AgentState" (
    "id" TEXT NOT NULL,
    "agentRosterId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityStatus" TEXT NOT NULL DEFAULT 'idle',
    "currentTask" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "lastActionSummary" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentDeliveryAttempt
CREATE TABLE "AgentDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AdsOperatorConfig
CREATE TABLE "AdsOperatorConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adAccountIds" TEXT[],
    "platforms" TEXT[],
    "automationLevel" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "notificationChannel" JSONB NOT NULL,
    "principalId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsOperatorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CadenceInstance
CREATE TABLE "CadenceInstance" (
    "id" TEXT NOT NULL,
    "cadenceDefinitionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "stepStates" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3),
    "nextEvaluationAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadenceInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RevenueAccount
CREATE TABLE "RevenueAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platforms" TEXT[],
    "vertical" TEXT NOT NULL DEFAULT 'commerce',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cadenceMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastCycleAt" TIMESTAMP(3),
    "nextCycleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RevGrowthDiagnosticCycle
CREATE TABLE "RevGrowthDiagnosticCycle" (
    "id" TEXT NOT NULL,
    "revenueAccountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dataTier" TEXT NOT NULL,
    "scorerOutputs" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "primaryConstraint" TEXT,
    "previousPrimaryConstraint" TEXT,
    "constraintTransition" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevGrowthDiagnosticCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RevGrowthIntervention
CREATE TABLE "RevGrowthIntervention" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "revenueAccountId" TEXT NOT NULL,
    "constraintType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "estimatedImpact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reasoning" TEXT NOT NULL,
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "outcomeStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "measurementWindowDays" INTEGER,
    "measurementStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevGrowthIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RevGrowthWeeklyDigest
CREATE TABLE "RevGrowthWeeklyDigest" (
    "id" TEXT NOT NULL,
    "revenueAccountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "constraintHistory" TEXT[],
    "interventionOutcomes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevGrowthWeeklyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ConnectorHealthLog
CREATE TABLE "ConnectorHealthLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectorName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchRate" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessConfig
CREATE TABLE "BusinessConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ConfigVersion
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL,
    "businessConfigId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changeDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OutcomeEvent
CREATE TABLE "OutcomeEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT,
    "outcomeType" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ResponseVariantLog
CREATE TABLE "ResponseVariantLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "primaryMove" TEXT NOT NULL,
    "templateId" TEXT,
    "responseText" TEXT NOT NULL,
    "leadReplyReceived" BOOLEAN NOT NULL DEFAULT false,
    "leadReplyPositive" BOOLEAN NOT NULL DEFAULT false,
    "conversationState" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponseVariantLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OptimisationProposal
CREATE TABLE "OptimisationProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentValue" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimisationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Handoff
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "leadSnapshot" JSONB NOT NULL DEFAULT '{}',
    "qualificationSnapshot" JSONB NOT NULL DEFAULT '{}',
    "conversationSummary" JSONB NOT NULL DEFAULT '{}',
    "slaDeadlineAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentSession
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "safetyEnvelope" JSONB NOT NULL,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "mutationCount" INTEGER NOT NULL DEFAULT 0,
    "dollarsAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "toolHistory" JSONB NOT NULL DEFAULT '[]',
    "checkpoint" JSONB,
    "traceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentRun
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runIndex" INTEGER NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'initial',
    "resumeContext" JSONB,
    "outcome" TEXT,
    "stepRange" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentPause
CREATE TABLE "AgentPause" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pauseIndex" INTEGER NOT NULL,
    "approvalId" TEXT NOT NULL,
    "resumeStatus" TEXT NOT NULL DEFAULT 'pending',
    "resumeToken" TEXT NOT NULL,
    "checkpoint" JSONB NOT NULL,
    "approvalOutcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedAt" TIMESTAMP(3),

    CONSTRAINT "AgentPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ToolEvent
CREATE TABLE "ToolEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "result" JSONB,
    "isMutation" BOOLEAN NOT NULL DEFAULT false,
    "dollarsAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "envelopeId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentRoleOverride
CREATE TABLE "AgentRoleOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safetyEnvelopeOverride" JSONB,
    "governanceProfileOverride" TEXT,
    "additionalGuardrails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRoleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ConversationMessage
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ContactLifecycle
CREATE TABLE "ContactLifecycle" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentRegistration
CREATE TABLE "AgentRegistration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentRole" TEXT,
    "executionMode" TEXT NOT NULL DEFAULT 'realtime',
    "status" TEXT NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL DEFAULT '{}',
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RoasSnapshot
CREATE TABLE "RoasSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'campaign',
    "entityId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "adAccountId" TEXT,
    "roas" DOUBLE PRECISION NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "campaignStatus" TEXT,
    "attributionWindow" TEXT,
    "dataFreshnessAt" TIMESTAMP(3),
    "snapshotDate" DATE NOT NULL,
    "optimizerRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoasSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LlmUsageLog
CREATE TABLE "LlmUsageLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "taskType" TEXT NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EscalationRecord
CREATE TABLE "EscalationRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonDetails" TEXT,
    "sourceAgent" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "conversationSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WorkflowExecution
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerRef" TEXT,
    "sourceAgent" TEXT,
    "status" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "safetyEnvelope" JSONB NOT NULL,
    "counters" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "error" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PendingActionRecord
CREATE TABLE "PendingActionRecord" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "workflowId" TEXT,
    "stepIndex" INTEGER,
    "status" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "targetEntities" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "humanSummary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "dollarsAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiredCapabilities" TEXT[],
    "dryRunSupported" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequired" TEXT NOT NULL,
    "fallback" JSONB,
    "sourceAgent" TEXT NOT NULL,
    "sourceWorkflow" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "PendingActionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ApprovalCheckpointRecord
CREATE TABLE "ApprovalCheckpointRecord" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "actionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "options" TEXT[],
    "modifiableFields" TEXT[],
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "notifyChannels" TEXT[],
    "status" TEXT NOT NULL,
    "resolution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalCheckpointRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ScheduledTriggerRecord
CREATE TABLE "ScheduledTriggerRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3),
    "cronExpression" TEXT,
    "eventPattern" JSONB,
    "action" JSONB NOT NULL,
    "sourceWorkflowId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledTriggerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OperatorRequestRecord
CREATE TABLE "OperatorRequestRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorRequestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OperatorCommandRecord
CREATE TABLE "OperatorCommandRecord" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "entities" JSONB NOT NULL DEFAULT '[]',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "parseConfidence" DOUBLE PRECISION NOT NULL,
    "guardrailResult" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'parsed',
    "workflowIds" JSONB NOT NULL DEFAULT '[]',
    "resultSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OperatorCommandRecord_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add missing columns to OrganizationConfig
ALTER TABLE "OrganizationConfig" ADD COLUMN IF NOT EXISTS "skinId" TEXT;

-- AlterTable: Add missing columns to ConversationState
ALTER TABLE "ConversationState" ADD COLUMN IF NOT EXISTS "firstReplyAt" TIMESTAMP(3);
ALTER TABLE "ConversationState" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);

-- AlterTable: Add missing columns to CrmContact
ALTER TABLE "CrmContact" ADD COLUMN IF NOT EXISTS "assignedStaffId" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN IF NOT EXISTS "sourceAdId" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN IF NOT EXISTS "sourceCampaignId" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN IF NOT EXISTS "gclid" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;

-- AlterTable: Add missing columns to CrmDeal
ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "assignedStaffId" TEXT;

-- CreateIndex: AgentRoster
CREATE UNIQUE INDEX "AgentRoster_organizationId_agentRole_key" ON "AgentRoster"("organizationId", "agentRole");
CREATE INDEX "AgentRoster_organizationId_idx" ON "AgentRoster"("organizationId");

-- CreateIndex: AgentState
CREATE UNIQUE INDEX "AgentState_agentRosterId_key" ON "AgentState"("agentRosterId");
CREATE INDEX "AgentState_organizationId_idx" ON "AgentState"("organizationId");

-- CreateIndex: AgentDeliveryAttempt
CREATE UNIQUE INDEX "AgentDeliveryAttempt_eventId_destinationId_key" ON "AgentDeliveryAttempt"("eventId", "destinationId");
CREATE INDEX "AgentDeliveryAttempt_status_idx" ON "AgentDeliveryAttempt"("status");
CREATE INDEX "AgentDeliveryAttempt_eventId_idx" ON "AgentDeliveryAttempt"("eventId");
CREATE INDEX "AgentDeliveryAttempt_createdAt_idx" ON "AgentDeliveryAttempt"("createdAt");

-- CreateIndex: AdsOperatorConfig
CREATE INDEX "AdsOperatorConfig_organizationId_idx" ON "AdsOperatorConfig"("organizationId");
CREATE INDEX "AdsOperatorConfig_active_idx" ON "AdsOperatorConfig"("active");

-- CreateIndex: CadenceInstance
CREATE INDEX "CadenceInstance_status_idx" ON "CadenceInstance"("status");
CREATE INDEX "CadenceInstance_organizationId_idx" ON "CadenceInstance"("organizationId");
CREATE INDEX "CadenceInstance_patientId_idx" ON "CadenceInstance"("patientId");
CREATE INDEX "CadenceInstance_nextEvaluationAt_idx" ON "CadenceInstance"("nextEvaluationAt");

-- CreateIndex: RevenueAccount
CREATE UNIQUE INDEX "RevenueAccount_organizationId_accountId_key" ON "RevenueAccount"("organizationId", "accountId");
CREATE INDEX "RevenueAccount_organizationId_idx" ON "RevenueAccount"("organizationId");
CREATE INDEX "RevenueAccount_active_nextCycleAt_idx" ON "RevenueAccount"("active", "nextCycleAt");

-- CreateIndex: RevGrowthDiagnosticCycle
CREATE INDEX "RevGrowthDiagnosticCycle_revenueAccountId_idx" ON "RevGrowthDiagnosticCycle"("revenueAccountId");
CREATE INDEX "RevGrowthDiagnosticCycle_organizationId_idx" ON "RevGrowthDiagnosticCycle"("organizationId");
CREATE INDEX "RevGrowthDiagnosticCycle_completedAt_idx" ON "RevGrowthDiagnosticCycle"("completedAt");

-- CreateIndex: RevGrowthIntervention
CREATE INDEX "RevGrowthIntervention_cycleId_idx" ON "RevGrowthIntervention"("cycleId");
CREATE INDEX "RevGrowthIntervention_revenueAccountId_idx" ON "RevGrowthIntervention"("revenueAccountId");
CREATE INDEX "RevGrowthIntervention_status_idx" ON "RevGrowthIntervention"("status");
CREATE INDEX "RevGrowthIntervention_outcomeStatus_idx" ON "RevGrowthIntervention"("outcomeStatus");

-- CreateIndex: RevGrowthWeeklyDigest
CREATE INDEX "RevGrowthWeeklyDigest_revenueAccountId_idx" ON "RevGrowthWeeklyDigest"("revenueAccountId");
CREATE INDEX "RevGrowthWeeklyDigest_organizationId_weekStartDate_idx" ON "RevGrowthWeeklyDigest"("organizationId", "weekStartDate");

-- CreateIndex: ConnectorHealthLog
CREATE INDEX "ConnectorHealthLog_organizationId_connectorId_idx" ON "ConnectorHealthLog"("organizationId", "connectorId");
CREATE INDEX "ConnectorHealthLog_checkedAt_idx" ON "ConnectorHealthLog"("checkedAt");

-- CreateIndex: BusinessConfig
CREATE UNIQUE INDEX "BusinessConfig_organizationId_key" ON "BusinessConfig"("organizationId");
CREATE INDEX "BusinessConfig_organizationId_idx" ON "BusinessConfig"("organizationId");

-- CreateIndex: ConfigVersion
CREATE INDEX "ConfigVersion_businessConfigId_idx" ON "ConfigVersion"("businessConfigId");
CREATE INDEX "ConfigVersion_status_idx" ON "ConfigVersion"("status");

-- CreateIndex: OutcomeEvent
CREATE INDEX "OutcomeEvent_organizationId_timestamp_idx" ON "OutcomeEvent"("organizationId", "timestamp");
CREATE INDEX "OutcomeEvent_sessionId_idx" ON "OutcomeEvent"("sessionId");
CREATE INDEX "OutcomeEvent_outcomeType_idx" ON "OutcomeEvent"("outcomeType");

-- CreateIndex: ResponseVariantLog
CREATE INDEX "ResponseVariantLog_organizationId_primaryMove_idx" ON "ResponseVariantLog"("organizationId", "primaryMove");
CREATE INDEX "ResponseVariantLog_sessionId_idx" ON "ResponseVariantLog"("sessionId");
CREATE INDEX "ResponseVariantLog_timestamp_idx" ON "ResponseVariantLog"("timestamp");

-- CreateIndex: OptimisationProposal
CREATE INDEX "OptimisationProposal_organizationId_status_idx" ON "OptimisationProposal"("organizationId", "status");

-- CreateIndex: Handoff
CREATE INDEX "Handoff_organizationId_status_idx" ON "Handoff"("organizationId", "status");
CREATE INDEX "Handoff_sessionId_idx" ON "Handoff"("sessionId");
CREATE INDEX "Handoff_slaDeadlineAt_idx" ON "Handoff"("slaDeadlineAt");

-- CreateIndex: AgentSession
CREATE INDEX "AgentSession_organizationId_status_idx" ON "AgentSession"("organizationId", "status");
CREATE INDEX "AgentSession_principalId_idx" ON "AgentSession"("principalId");
CREATE INDEX "AgentSession_traceId_idx" ON "AgentSession"("traceId");

-- CreateIndex: AgentRun
CREATE UNIQUE INDEX "AgentRun_sessionId_runIndex_key" ON "AgentRun"("sessionId", "runIndex");
CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");

-- CreateIndex: AgentPause
CREATE UNIQUE INDEX "AgentPause_sessionId_pauseIndex_key" ON "AgentPause"("sessionId", "pauseIndex");
CREATE UNIQUE INDEX "AgentPause_approvalId_key" ON "AgentPause"("approvalId");
CREATE INDEX "AgentPause_sessionId_idx" ON "AgentPause"("sessionId");

-- CreateIndex: ToolEvent
CREATE UNIQUE INDEX "ToolEvent_sessionId_stepIndex_key" ON "ToolEvent"("sessionId", "stepIndex");
CREATE INDEX "ToolEvent_sessionId_idx" ON "ToolEvent"("sessionId");
CREATE INDEX "ToolEvent_runId_idx" ON "ToolEvent"("runId");

-- CreateIndex: AgentRoleOverride
CREATE UNIQUE INDEX "AgentRoleOverride_organizationId_roleId_key" ON "AgentRoleOverride"("organizationId", "roleId");

-- CreateIndex: ConversationMessage
CREATE INDEX "ConversationMessage_contactId_orgId_idx" ON "ConversationMessage"("contactId", "orgId");
CREATE INDEX "ConversationMessage_createdAt_idx" ON "ConversationMessage"("createdAt");

-- CreateIndex: ContactLifecycle
CREATE UNIQUE INDEX "ContactLifecycle_contactId_orgId_key" ON "ContactLifecycle"("contactId", "orgId");
CREATE INDEX "ContactLifecycle_orgId_idx" ON "ContactLifecycle"("orgId");

-- CreateIndex: AgentRegistration
CREATE UNIQUE INDEX "AgentRegistration_orgId_agentId_key" ON "AgentRegistration"("orgId", "agentId");
CREATE INDEX "AgentRegistration_orgId_idx" ON "AgentRegistration"("orgId");
CREATE INDEX "AgentRegistration_status_idx" ON "AgentRegistration"("status");

-- CreateIndex: RoasSnapshot
CREATE UNIQUE INDEX "RoasSnapshot_orgId_entityType_entityId_snapshotDate_key" ON "RoasSnapshot"("orgId", "entityType", "entityId", "snapshotDate");
CREATE INDEX "RoasSnapshot_orgId_platform_idx" ON "RoasSnapshot"("orgId", "platform");
CREATE INDEX "RoasSnapshot_snapshotDate_idx" ON "RoasSnapshot"("snapshotDate");
CREATE INDEX "RoasSnapshot_optimizerRunId_idx" ON "RoasSnapshot"("optimizerRunId");

-- CreateIndex: LlmUsageLog
CREATE INDEX "LlmUsageLog_orgId_createdAt_idx" ON "LlmUsageLog"("orgId", "createdAt");
CREATE INDEX "LlmUsageLog_model_idx" ON "LlmUsageLog"("model");

-- CreateIndex: EscalationRecord
CREATE INDEX "EscalationRecord_orgId_status_idx" ON "EscalationRecord"("orgId", "status");
CREATE INDEX "EscalationRecord_contactId_idx" ON "EscalationRecord"("contactId");
CREATE INDEX "EscalationRecord_createdAt_idx" ON "EscalationRecord"("createdAt");

-- CreateIndex: WorkflowExecution
CREATE INDEX "WorkflowExecution_organizationId_status_idx" ON "WorkflowExecution"("organizationId", "status");
CREATE INDEX "WorkflowExecution_traceId_idx" ON "WorkflowExecution"("traceId");
CREATE INDEX "WorkflowExecution_sourceAgent_idx" ON "WorkflowExecution"("sourceAgent");

-- CreateIndex: PendingActionRecord
CREATE UNIQUE INDEX "PendingActionRecord_idempotencyKey_key" ON "PendingActionRecord"("idempotencyKey");
CREATE INDEX "PendingActionRecord_organizationId_status_idx" ON "PendingActionRecord"("organizationId", "status");
CREATE INDEX "PendingActionRecord_workflowId_idx" ON "PendingActionRecord"("workflowId");
CREATE INDEX "PendingActionRecord_sourceAgent_idx" ON "PendingActionRecord"("sourceAgent");

-- CreateIndex: ApprovalCheckpointRecord
CREATE UNIQUE INDEX "ApprovalCheckpointRecord_workflowId_stepIndex_key" ON "ApprovalCheckpointRecord"("workflowId", "stepIndex");
CREATE INDEX "ApprovalCheckpointRecord_status_idx" ON "ApprovalCheckpointRecord"("status");

-- CreateIndex: ScheduledTriggerRecord
CREATE INDEX "ScheduledTriggerRecord_organizationId_status_idx" ON "ScheduledTriggerRecord"("organizationId", "status");
CREATE INDEX "ScheduledTriggerRecord_status_type_idx" ON "ScheduledTriggerRecord"("status", "type");
CREATE INDEX "ScheduledTriggerRecord_sourceWorkflowId_idx" ON "ScheduledTriggerRecord"("sourceWorkflowId");
CREATE INDEX "ScheduledTriggerRecord_fireAt_idx" ON "ScheduledTriggerRecord"("fireAt");

-- CreateIndex: OperatorRequestRecord
CREATE INDEX "OperatorRequestRecord_organizationId_idx" ON "OperatorRequestRecord"("organizationId");

-- CreateIndex: OperatorCommandRecord
CREATE INDEX "OperatorCommandRecord_organizationId_idx" ON "OperatorCommandRecord"("organizationId");
CREATE INDEX "OperatorCommandRecord_requestId_idx" ON "OperatorCommandRecord"("requestId");
CREATE INDEX "OperatorCommandRecord_status_idx" ON "OperatorCommandRecord"("status");

-- CreateIndex: CrmContact (missing from baseline)
CREATE INDEX IF NOT EXISTS "CrmContact_sourceAdId_idx" ON "CrmContact"("sourceAdId");

-- AddForeignKey
ALTER TABLE "AgentState" ADD CONSTRAINT "AgentState_agentRosterId_fkey" FOREIGN KEY ("agentRosterId") REFERENCES "AgentRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfigVersion" ADD CONSTRAINT "ConfigVersion_businessConfigId_fkey" FOREIGN KEY ("businessConfigId") REFERENCES "BusinessConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevGrowthDiagnosticCycle" ADD CONSTRAINT "RevGrowthDiagnosticCycle_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "RevenueAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevGrowthIntervention" ADD CONSTRAINT "RevGrowthIntervention_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "RevGrowthDiagnosticCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevGrowthIntervention" ADD CONSTRAINT "RevGrowthIntervention_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "RevenueAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentPause" ADD CONSTRAINT "AgentPause_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolEvent" ADD CONSTRAINT "ToolEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingActionRecord" ADD CONSTRAINT "PendingActionRecord_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovalCheckpointRecord" ADD CONSTRAINT "ApprovalCheckpointRecord_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduledTriggerRecord" ADD CONSTRAINT "ScheduledTriggerRecord_sourceWorkflowId_fkey" FOREIGN KEY ("sourceWorkflowId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
