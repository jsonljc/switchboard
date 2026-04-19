-- CreateTable
CREATE TABLE "InteractionSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "contactId" TEXT,
    "summary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'info_request',
    "extractedFacts" JSONB NOT NULL DEFAULT '[]',
    "questionsAsked" JSONB NOT NULL DEFAULT '[]',
    "duration" INTEGER NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionTrace" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "skillSlug" TEXT NOT NULL,
    "skillVersion" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'chat_message',
    "sessionId" TEXT NOT NULL,
    "inputParametersHash" TEXT NOT NULL,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "governanceDecisions" JSONB NOT NULL DEFAULT '[]',
    "tokenUsage" JSONB NOT NULL DEFAULT '{}',
    "durationMs" INTEGER NOT NULL,
    "turnCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "responseSummary" TEXT NOT NULL,
    "linkedOutcomeId" TEXT,
    "linkedOutcomeType" TEXT,
    "linkedOutcomeResult" TEXT,
    "writeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPersona" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "productService" TEXT NOT NULL,
    "valueProposition" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "qualificationCriteria" JSONB NOT NULL DEFAULT '{}',
    "disqualificationCriteria" JSONB NOT NULL DEFAULT '{}',
    "bookingLink" TEXT,
    "escalationRules" JSONB NOT NULL DEFAULT '{}',
    "customInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorIdentity" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identityRefIds" TEXT[],
    "heroImageAssetId" TEXT NOT NULL,
    "identityDescription" TEXT NOT NULL,
    "identityObjects" JSONB,
    "voice" JSONB NOT NULL,
    "personality" JSONB NOT NULL,
    "appearanceRules" JSONB NOT NULL,
    "environmentSet" TEXT[],
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bibleVersion" TEXT NOT NULL DEFAULT '1.0',
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "creatorId" TEXT,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersion" TEXT,
    "seed" INTEGER,
    "inputHashes" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "qaMetrics" JSONB,
    "qaHistory" JSONB,
    "identityDriftScore" DOUBLE PRECISION,
    "baselineAssetId" TEXT,
    "latencyMs" INTEGER,
    "costEstimate" DOUBLE PRECISION,
    "attemptNumber" INTEGER,
    "approvalState" TEXT NOT NULL DEFAULT 'pending',
    "lockedDerivativeOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTrace" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "parentWorkUnitId" TEXT,
    "intent" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "governanceOutcome" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "matchedPolicies" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "modeMetrics" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "governanceCompletedAt" TIMESTAMP(3) NOT NULL,
    "executionStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InteractionSummary_organizationId_deploymentId_idx" ON "InteractionSummary"("organizationId", "deploymentId");
CREATE INDEX "InteractionSummary_createdAt_idx" ON "InteractionSummary"("createdAt");

-- CreateIndex
CREATE INDEX "DeploymentMemory_organizationId_deploymentId_idx" ON "DeploymentMemory"("organizationId", "deploymentId");
CREATE INDEX "DeploymentMemory_confidence_idx" ON "DeploymentMemory"("confidence");

-- CreateIndex
CREATE INDEX "ExecutionTrace_deploymentId_createdAt_idx" ON "ExecutionTrace"("deploymentId", "createdAt");
CREATE INDEX "ExecutionTrace_organizationId_createdAt_idx" ON "ExecutionTrace"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersona_organizationId_key" ON "AgentPersona"("organizationId");

-- CreateIndex
CREATE INDEX "CreatorIdentity_deploymentId_idx" ON "CreatorIdentity"("deploymentId");

-- CreateIndex
CREATE INDEX "AssetRecord_jobId_idx" ON "AssetRecord"("jobId");
CREATE INDEX "AssetRecord_creatorId_idx" ON "AssetRecord"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTrace_workUnitId_key" ON "WorkTrace"("workUnitId");
CREATE INDEX "WorkTrace_organizationId_intent_idx" ON "WorkTrace"("organizationId", "intent");
CREATE INDEX "WorkTrace_traceId_idx" ON "WorkTrace"("traceId");
CREATE INDEX "WorkTrace_requestedAt_idx" ON "WorkTrace"("requestedAt");

-- AddForeignKey
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CreativeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
