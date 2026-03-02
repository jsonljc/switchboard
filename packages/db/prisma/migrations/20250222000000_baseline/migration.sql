-- CreateTable
CREATE TABLE "Principal" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegationRule" (
    "id" TEXT NOT NULL,
    "grantorId" TEXT NOT NULL,
    "granteeId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentitySpec" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskTolerance" JSONB NOT NULL,
    "globalSpendLimits" JSONB NOT NULL,
    "cartridgeSpendLimits" JSONB NOT NULL,
    "forbiddenBehaviors" TEXT[],
    "trustBehaviors" TEXT[],
    "delegatedApprovers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentitySpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleOverlay" (
    "id" TEXT NOT NULL,
    "identitySpecId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "organizationId" TEXT,
    "cartridgeId" TEXT,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rule" JSONB NOT NULL,
    "effect" TEXT NOT NULL,
    "effectParams" JSONB,
    "approvalRequirement" TEXT,
    "riskCategoryOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionEnvelope" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "incomingMessage" JSONB,
    "conversationId" TEXT,
    "organizationId" TEXT,
    "proposals" JSONB NOT NULL,
    "resolvedEntities" JSONB NOT NULL,
    "plan" JSONB,
    "decisions" JSONB NOT NULL,
    "approvalRequests" JSONB NOT NULL,
    "executionResults" JSONB NOT NULL,
    "auditEntryIds" TEXT[],
    "status" TEXT NOT NULL,
    "parentEnvelopeId" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationState" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentIntent" TEXT,
    "pendingProposalIds" TEXT[],
    "pendingApprovalIds" TEXT[],
    "clarificationQuestion" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "visibilityLevel" TEXT NOT NULL DEFAULT 'public',
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "evidencePointers" JSONB NOT NULL,
    "redactionApplied" BOOLEAN NOT NULL DEFAULT false,
    "redactedFields" TEXT[],
    "chainHashVersion" INTEGER NOT NULL DEFAULT 1,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "entryHash" TEXT NOT NULL,
    "previousEntryHash" TEXT,
    "envelopeId" TEXT,
    "organizationId" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartridgeRegistration" (
    "id" TEXT NOT NULL,
    "cartridgeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartridgeRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "organizationId" TEXT,
    "authType" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "scopes" TEXT[],
    "refreshStrategy" TEXT NOT NULL DEFAULT 'auto',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastHealthCheck" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRecord" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "organizationId" TEXT,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "patchValue" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceRecord" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "rollbackCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDecayAppliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemRiskPosture" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "posture" TEXT NOT NULL DEFAULT 'normal',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemRiskPosture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencePolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionTypePattern" TEXT,
    "thresholds" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetencePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiKeyHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardVerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runtimeType" TEXT NOT NULL DEFAULT 'http',
    "runtimeConfig" JSONB NOT NULL DEFAULT '{}',
    "governanceProfile" TEXT NOT NULL DEFAULT 'guarded',
    "tier" TEXT NOT NULL DEFAULT 'smb',
    "smbOwnerId" TEXT,
    "smbPerActionLimit" DOUBLE PRECISION,
    "smbDailyLimit" DOUBLE PRECISION,
    "smbAllowedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "smbBlockedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedCartridgeId" TEXT,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "managedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provisioningStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmbActivityLogEntry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "envelopeId" TEXT,
    "organizationId" TEXT NOT NULL,
    "redactionApplied" BOOLEAN NOT NULL DEFAULT false,
    "redactedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "SmbActivityLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "botUsername" TEXT,
    "webhookPath" TEXT NOT NULL,
    "webhookRegistered" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "statusDetail" TEXT,
    "lastHealthCheck" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "webhookPath" TEXT,
    "organizationId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "stage" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStack" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "channel" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "phone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "organizationId" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDeal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "pipeline" TEXT NOT NULL DEFAULT 'default',
    "amount" DOUBLE PRECISION,
    "closeDate" TIMESTAMP(3),
    "contactId" TEXT,
    "organizationId" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metricPath" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "platform" TEXT,
    "vertical" TEXT NOT NULL DEFAULT 'commerce',
    "notifyChannels" TEXT[],
    "notifyRecipients" TEXT[],
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastTriggeredAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "reportType" TEXT NOT NULL,
    "platform" TEXT,
    "vertical" TEXT NOT NULL DEFAULT 'commerce',
    "deliveryChannels" TEXT[],
    "deliveryTargets" TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertHistory" (
    "id" TEXT NOT NULL,
    "alertRuleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "findingsSummary" TEXT NOT NULL,
    "notificationsSent" JSONB NOT NULL,

    CONSTRAINT "AlertHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Principal_organizationId_idx" ON "Principal"("organizationId");

-- CreateIndex
CREATE INDEX "DelegationRule_grantorId_idx" ON "DelegationRule"("grantorId");

-- CreateIndex
CREATE INDEX "DelegationRule_granteeId_idx" ON "DelegationRule"("granteeId");

-- CreateIndex
CREATE INDEX "IdentitySpec_principalId_idx" ON "IdentitySpec"("principalId");

-- CreateIndex
CREATE INDEX "IdentitySpec_organizationId_idx" ON "IdentitySpec"("organizationId");

-- CreateIndex
CREATE INDEX "RoleOverlay_identitySpecId_idx" ON "RoleOverlay"("identitySpecId");

-- CreateIndex
CREATE INDEX "Policy_organizationId_idx" ON "Policy"("organizationId");

-- CreateIndex
CREATE INDEX "Policy_cartridgeId_idx" ON "Policy"("cartridgeId");

-- CreateIndex
CREATE INDEX "Policy_priority_idx" ON "Policy"("priority");

-- CreateIndex
CREATE INDEX "ActionEnvelope_status_idx" ON "ActionEnvelope"("status");

-- CreateIndex
CREATE INDEX "ActionEnvelope_conversationId_idx" ON "ActionEnvelope"("conversationId");

-- CreateIndex
CREATE INDEX "ActionEnvelope_parentEnvelopeId_idx" ON "ActionEnvelope"("parentEnvelopeId");

-- CreateIndex
CREATE INDEX "ActionEnvelope_organizationId_idx" ON "ActionEnvelope"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_threadId_key" ON "ConversationState"("threadId");

-- CreateIndex
CREATE INDEX "ConversationState_principalId_idx" ON "ConversationState"("principalId");

-- CreateIndex
CREATE INDEX "ConversationState_status_idx" ON "ConversationState"("status");

-- CreateIndex
CREATE INDEX "AuditEntry_eventType_idx" ON "AuditEntry"("eventType");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_envelopeId_idx" ON "AuditEntry"("envelopeId");

-- CreateIndex
CREATE INDEX "AuditEntry_organizationId_idx" ON "AuditEntry"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEntry_traceId_idx" ON "AuditEntry"("traceId");

-- CreateIndex
CREATE INDEX "AuditEntry_timestamp_idx" ON "AuditEntry"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CartridgeRegistration_cartridgeId_key" ON "CartridgeRegistration"("cartridgeId");

-- CreateIndex
CREATE INDEX "Connection_organizationId_idx" ON "Connection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_serviceId_organizationId_key" ON "Connection"("serviceId", "organizationId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "ProcessedMessage_expiresAt_idx" ON "ProcessedMessage"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRecord_status_idx" ON "ApprovalRecord"("status");

-- CreateIndex
CREATE INDEX "ApprovalRecord_envelopeId_idx" ON "ApprovalRecord"("envelopeId");

-- CreateIndex
CREATE INDEX "ApprovalRecord_organizationId_status_idx" ON "ApprovalRecord"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CompetenceRecord_principalId_idx" ON "CompetenceRecord"("principalId");

-- CreateIndex
CREATE INDEX "CompetenceRecord_score_idx" ON "CompetenceRecord"("score");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRecord_principalId_actionType_key" ON "CompetenceRecord"("principalId", "actionType");

-- CreateIndex
CREATE INDEX "CompetencePolicy_actionTypePattern_idx" ON "CompetencePolicy"("actionTypePattern");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardUser_email_key" ON "DashboardUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardUser_apiKeyHash_key" ON "DashboardUser"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSession_sessionToken_key" ON "DashboardSession"("sessionToken");

-- CreateIndex
CREATE INDEX "DashboardSession_userId_idx" ON "DashboardSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardVerificationToken_token_key" ON "DashboardVerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardVerificationToken_identifier_token_key" ON "DashboardVerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "SmbActivityLogEntry_organizationId_timestamp_idx" ON "SmbActivityLogEntry"("organizationId", "timestamp");

-- CreateIndex
CREATE INDEX "SmbActivityLogEntry_actorId_idx" ON "SmbActivityLogEntry"("actorId");

-- CreateIndex
CREATE INDEX "SmbActivityLogEntry_envelopeId_idx" ON "SmbActivityLogEntry"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedChannel_webhookPath_key" ON "ManagedChannel"("webhookPath");

-- CreateIndex
CREATE INDEX "ManagedChannel_organizationId_idx" ON "ManagedChannel"("organizationId");

-- CreateIndex
CREATE INDEX "ManagedChannel_status_idx" ON "ManagedChannel"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedChannel_organizationId_channel_key" ON "ManagedChannel"("organizationId", "channel");

-- CreateIndex
CREATE INDEX "FailedMessage_status_idx" ON "FailedMessage"("status");

-- CreateIndex
CREATE INDEX "FailedMessage_organizationId_idx" ON "FailedMessage"("organizationId");

-- CreateIndex
CREATE INDEX "FailedMessage_createdAt_idx" ON "FailedMessage"("createdAt");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_idx" ON "CrmContact"("organizationId");

-- CreateIndex
CREATE INDEX "CrmContact_email_idx" ON "CrmContact"("email");

-- CreateIndex
CREATE INDEX "CrmContact_externalId_idx" ON "CrmContact"("externalId");

-- CreateIndex
CREATE INDEX "CrmContact_status_idx" ON "CrmContact"("status");

-- CreateIndex
CREATE INDEX "CrmDeal_organizationId_idx" ON "CrmDeal"("organizationId");

-- CreateIndex
CREATE INDEX "CrmDeal_contactId_idx" ON "CrmDeal"("contactId");

-- CreateIndex
CREATE INDEX "CrmDeal_pipeline_stage_idx" ON "CrmDeal"("pipeline", "stage");

-- CreateIndex
CREATE INDEX "CrmActivity_contactId_idx" ON "CrmActivity"("contactId");

-- CreateIndex
CREATE INDEX "CrmActivity_dealId_idx" ON "CrmActivity"("dealId");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_idx" ON "CrmActivity"("organizationId");

-- CreateIndex
CREATE INDEX "CrmActivity_type_idx" ON "CrmActivity"("type");

-- CreateIndex
CREATE INDEX "CrmActivity_createdAt_idx" ON "CrmActivity"("createdAt");

-- CreateIndex
CREATE INDEX "AlertRule_organizationId_enabled_idx" ON "AlertRule"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledReport_enabled_nextRunAt_idx" ON "ScheduledReport"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledReport_organizationId_idx" ON "ScheduledReport"("organizationId");

-- CreateIndex
CREATE INDEX "AlertHistory_alertRuleId_idx" ON "AlertHistory"("alertRuleId");

-- CreateIndex
CREATE INDEX "AlertHistory_organizationId_triggeredAt_idx" ON "AlertHistory"("organizationId", "triggeredAt");

-- AddForeignKey
ALTER TABLE "DelegationRule" ADD CONSTRAINT "DelegationRule_grantorId_fkey" FOREIGN KEY ("grantorId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationRule" ADD CONSTRAINT "DelegationRule_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleOverlay" ADD CONSTRAINT "RoleOverlay_identitySpecId_fkey" FOREIGN KEY ("identitySpecId") REFERENCES "IdentitySpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEnvelope" ADD CONSTRAINT "ActionEnvelope_parentEnvelopeId_fkey" FOREIGN KEY ("parentEnvelopeId") REFERENCES "ActionEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSession" ADD CONSTRAINT "DashboardSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
