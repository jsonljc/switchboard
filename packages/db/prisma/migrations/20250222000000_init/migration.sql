-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
    "proposals" JSONB NOT NULL,
    "resolvedEntities" JSONB NOT NULL,
    "plan" JSONB,
    "decisions" JSONB NOT NULL,
    "approvalRequests" JSONB NOT NULL,
    "executionResults" JSONB NOT NULL,
    "auditEntryIds" TEXT[],
    "status" TEXT NOT NULL,
    "parentEnvelopeId" TEXT,
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
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "patchValue" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRecord_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "DelegationRule" ADD CONSTRAINT "DelegationRule_grantorId_fkey" FOREIGN KEY ("grantorId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationRule" ADD CONSTRAINT "DelegationRule_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleOverlay" ADD CONSTRAINT "RoleOverlay_identitySpecId_fkey" FOREIGN KEY ("identitySpecId") REFERENCES "IdentitySpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEnvelope" ADD CONSTRAINT "ActionEnvelope_parentEnvelopeId_fkey" FOREIGN KEY ("parentEnvelopeId") REFERENCES "ActionEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
