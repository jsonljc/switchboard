# Data Models Reference

**Generated**: 2026-05-07  
**Source**: `packages/db/prisma/schema.prisma` (1968 lines)

## How to Use This Doc

This is a quick-reference map of all Prisma models in Switchboard. For each domain, skim the **Fields** and **Relations** to understand shape and coupling. Check **Lifecycle** for state machines. **Zod mirrors** links to runtime validators when they exist.

---

## Enums

```prisma
enum KnowledgeKind {
  playbook
  policy
  knowledge
}
```

---

## Core: Identity & Access Control (Principal, DelegationRule, IdentitySpec, RoleOverlay, Policy)

### Principal

**File**: schema.prisma:10 — `Actor abstraction: users, agents, service accounts, system`

**Fields**:

- id, type, name, organizationId, roles[], createdAt, updatedAt

**Relations**:

- delegationsGiven: DelegationRule[]
- delegationsRecvd: DelegationRule[]

**Indexes**: organizationId

---

### DelegationRule

**File**: schema.prisma:25 — `Time-bound authority delegation between principals`

**Fields**:

- id, grantorId, granteeId, scope, expiresAt?, createdAt

**Relations**:

- grantor: Principal
- grantee: Principal

**Indexes**: grantorId, granteeId

---

### IdentitySpec

**File**: schema.prisma:40 — `Curated identity baseline: risk tolerance, spend limits, trust behaviors`

**Fields**:

- id, principalId, organizationId?, name, description, riskTolerance (Json), globalSpendLimits (Json), cartridgeSpendLimits (Json), forbiddenBehaviors[], trustBehaviors[], delegatedApprovers[] (default: []), createdAt, updatedAt

**Relations**:

- overlays: RoleOverlay[]

**Indexes**: principalId, organizationId

---

### RoleOverlay

**File**: schema.prisma:61 — `Context-aware policy layer: restrict or extend IdentitySpec`

**Fields**:

- id, identitySpecId, name, description, mode ("restrict"/"extend"), priority, active, conditions (Json), overrides (Json), createdAt, updatedAt

**Relations**:

- identitySpec: IdentitySpec

**Indexes**: identitySpecId

---

### Policy

**File**: schema.prisma:79 — `Governance rule: action filtering + approval flow routing`

**Fields**:

- id, name, description, organizationId?, cartridgeId?, priority, active, rule (Json), effect ("allow"/"deny"/"modify"/"require_approval"), effectParams?, approvalRequirement? ("none"/"standard"/"elevated"/"mandatory"), riskCategoryOverride?, createdAt, updatedAt

**Indexes**: organizationId, cartridgeId, priority

---

## Approval & Governance (ActionEnvelope, ApprovalRecord, ApprovalLifecycle, ApprovalRevision, ExecutableWorkUnit)

### ActionEnvelope

**File**: schema.prisma:100 — `Request container: proposals → decisions → approval → execution`

**Fields**:

- id, version, incomingMessage?, conversationId?, organizationId?, proposals (Json: ActionProposal[]), resolvedEntities (Json), plan? (Json: ActionPlan), decisions (Json: DecisionTrace[]), approvalRequests (Json), executionResults (Json), auditEntryIds[], status, parentEnvelopeId?, traceId?, createdAt, updatedAt

**Relations**:

- parentEnvelope: ActionEnvelope?
- childEnvelopes: ActionEnvelope[]

**Status**: pending, approved, rejected, executed, failed, etc. (determined by governance flow)

**Lifecycle**: ActionEnvelope → ApprovalLifecycle (1:1 on approval start)

**Indexes**: status, conversationId, parentEnvelopeId, organizationId

---

### ApprovalRecord

**File**: schema.prisma:232 — `Single approval decision: request sent, response received, expiration`

**Fields**:

- id, envelopeId, organizationId?, request (Json), status ("pending"/"approved"/"rejected"/"expired"), respondedBy?, respondedAt?, patchValue? (Json), expiresAt, version, createdAt, updatedAt

**Indexes**: status, envelopeId, (organizationId, status)

---

### ApprovalLifecycle

**File**: schema.prisma:255 — `Mutable approval authority: tracks revision chain, executable dispatch`

**Fields**:

- id, actionEnvelopeId (unique), organizationId?, status ("pending"/"approved"/"rejected"/"expired"/"superseded"/"recovery_required"), currentRevisionId?, currentExecutableWorkUnitId?, expiresAt, pausedSessionId?, version, createdAt, updatedAt

**Relations**: None explicit; linked via actionEnvelopeId

**Lifecycle**: pending → approved → (superseded)? → executor dispatch

**Indexes**: status, (organizationId, status), expiresAt

---

### ApprovalRevision

**File**: schema.prisma:277 — `Immutable snapshot at approval version`

**Fields**:

- id, lifecycleId, revisionNumber, parametersSnapshot (Json), approvalScopeSnapshot (Json), bindingHash, rationale?, supersedesRevisionId?, createdBy, createdAt

**Constraints**: @@unique([lifecycleId, revisionNumber])

**Indexes**: lifecycleId

---

### ExecutableWorkUnit

**File**: schema.prisma:297 — `Dispatch authority: frozen payload + binding + constraints`

**Fields**:

- id, lifecycleId, approvalRevisionId (unique), actionEnvelopeId, frozenPayload (Json), frozenBinding (Json), frozenExecutionPolicy (Json), executableUntil, createdAt

**Indexes**: lifecycleId

---

## Dispatch & Execution (DispatchRecord, ExecutionTrace, AgentSession, AgentRun, AgentPause, ToolEvent)

### DispatchRecord

**File**: schema.prisma:315 — `Thin durable dispatch record: attempt tracking, idempotency`

**Fields**:

- id, executableWorkUnitId, attemptNumber, idempotencyKey (unique), state ("dispatching"/"succeeded"/"failed"/"terminal_failed"), dispatchedAt, completedAt?, outcome?, errorMessage?, durationMs?

**Constraints**: @@unique([executableWorkUnitId, attemptNumber])

**Indexes**: executableWorkUnitId

---

### ExecutionTrace

**File**: schema.prisma:699 — `Unified telemetry: every platform work unit (skill invocation, governance decision, outcome)`

**Fields**:

- id (cuid), deploymentId, organizationId, skillSlug, skillVersion, trigger ("chat_message" default), sessionId, inputParametersHash, toolCalls (Json), governanceDecisions (Json), tokenUsage (Json), durationMs, turnCount, status, error?, responseSummary, linkedOutcomeId?, linkedOutcomeType?, linkedOutcomeResult?, writeCount (default 0), createdAt

**Indexes**: (deploymentId, createdAt), (organizationId, createdAt), status, sessionId

---

### AgentSession

**File**: schema.prisma:738 — `Session lifecycle: runs, pauses, tool invocations`

**Fields**:

- id, organizationId, roleId, principalId, status ("running" default), safetyEnvelope (Json), toolCallCount, mutationCount, dollarsAtRisk, currentStep, toolHistory (Json), checkpoint?, traceId, startedAt, completedAt?

**Relations**:

- runs: AgentRun[]
- pauses: AgentPause[]
- toolEvents: ToolEvent[]

**Indexes**: (organizationId, status), principalId, traceId

---

### AgentRun

**File**: schema.prisma:764 — `Execution unit within session: resume context, step ranges`

**Fields**:

- id, sessionId, runIndex, triggerType ("initial" default), resumeContext?, outcome?, stepRange (Json)?, startedAt, completedAt?

**Relations**:

- session: AgentSession (onDelete: Cascade)

**Constraints**: @@unique([sessionId, runIndex])

**Indexes**: sessionId

---

### AgentPause

**File**: schema.prisma:781 — `Approval checkpoint: session pause + resume token`

**Fields**:

- id, sessionId, runId, pauseIndex, approvalId, resumeStatus ("pending" default), resumeToken, checkpoint (Json), approvalOutcome?, createdAt, resumedAt?

**Relations**:

- session: AgentSession (onDelete: Cascade)

**Constraints**: @@unique([sessionId, pauseIndex]), @@unique([approvalId])

**Indexes**: sessionId

---

### ToolEvent

**File**: schema.prisma:801 — `Step-level execution record: tool name, params, result, mutation risk`

**Fields**:

- id, sessionId, runId, stepIndex, toolName, parameters (Json), result (Json)?, isMutation, dollarsAtRisk, durationMs?, envelopeId?, timestamp

**Relations**:

- session: AgentSession (onDelete: Cascade)

**Constraints**: @@unique([sessionId, stepIndex])

**Indexes**: sessionId, runId

---

## Competence & Risk (CompetenceRecord, CompetencePolicy, SystemRiskPosture)

### CompetenceRecord

**File**: schema.prisma:331 — `Actor skill tracking: success/failure counts, score decay`

**Fields**:

- id, principalId, actionType, successCount, failureCount, rollbackCount, consecutiveSuccesses, score (Float), lastActivityAt, lastDecayAppliedAt, history (Json), createdAt, updatedAt

**Constraints**: @@unique([principalId, actionType])

**Indexes**: principalId, score

---

### CompetencePolicy

**File**: schema.prisma:358 — `Scoring rules by action type`

**Fields**:

- id, name, description, actionTypePattern?, thresholds (Json), enabled, createdAt, updatedAt

**Indexes**: actionTypePattern

---

### SystemRiskPosture

**File**: schema.prisma:351 — `Singleton risk state: normal | elevated | critical`

**Fields**:

- id (hardcoded "singleton"), posture ("normal"/"elevated"/"critical"), updatedAt, updatedBy?

---

## Audit & Compliance (AuditEntry)

### AuditEntry

**File**: schema.prisma:150 — `Durable immutable ledger: events, actors, entities, risk, hashes`

**Fields**:

- id, eventType, timestamp, actorType, actorId, entityType, entityId, riskCategory, visibilityLevel ("public" default), summary, snapshot (Json), evidencePointers (Json), redactionApplied, redactedFields[], chainHashVersion, schemaVersion, entryHash, previousEntryHash?, envelopeId?, organizationId?, traceId?, createdAt

**Constraints**: Hash chain validation (chainHashVersion, schemaVersion, entryHash)

**Indexes**: eventType, (entityType, entityId), envelopeId, organizationId, traceId, timestamp

---

## Conversation & State (ConversationState, ConversationMessage, ConversationThread, ContactLifecycle)

### ConversationState

**File**: schema.prisma:128 — `Active conversation session tracking`

**Fields**:

- id, threadId (unique), channel, principalId, organizationId?, status, currentIntent?, pendingProposalIds[], pendingApprovalIds[], clarificationQuestion?, messages (Json, default []), firstReplyAt?, lastInboundAt?, lastActivityAt, expiresAt

**Indexes**: principalId, organizationId, status

---

### ConversationMessage

**File**: schema.prisma:839 — `Message persistence: inbound/outbound, channel-agnostic`

**Fields**:

- id, contactId, orgId, direction ("inbound"/"outbound"), content, channel ("whatsapp"/"telegram"/"dashboard"), metadata (Json), createdAt

**Indexes**: (contactId, orgId), createdAt

---

### ConversationThread

**File**: schema.prisma:866 — `Contact conversation lifecycle: stage, agent context, follow-ups`

**Fields**:

- id, contactId, organizationId, stage ("new"/"..." ThreadStage enum), assignedAgent, agentContext (Json: AgentContextData), currentSummary, followUpSchedule (Json), lastOutcomeAt?, messageCount, firstAgentMessageAt?, threadStatus ("open"/"closed"), opportunityId?, createdAt, updatedAt

**Relations**:

- lifecycleContact: Contact?

**Constraints**: @@unique([contactId, organizationId])

**Indexes**: organizationId, stage

---

### ContactLifecycle

**File**: schema.prisma:853 — `Contact funnel stage + opt-out flag`

**Fields**:

- id, contactId, orgId, stage ("lead"/"qualified"/"booked"/"churned"), optedOut, updatedAt, createdAt

**Constraints**: @@unique([contactId, orgId])

**Indexes**: orgId

---

## Lifecycle: Contacts, Opportunities, Revenue (Contact, Opportunity, LifecycleRevenueEvent, OwnerTask)

### Contact

**File**: schema.prisma:1471 — `Funnel identity: phone, email, stage, lead source`

**Fields**:

- id, organizationId, name?, phone?, email?, primaryChannel ("whatsapp" default), firstTouchChannel?, stage ("new" default), source?, sourceType? ("ctwa"/"instant_form"/"organic"/"web"), attribution?, qualificationData (Json)?, roles[] (default: ["lead"]), leadgenId?, idempotencyKey?, firstContactAt, lastActivityAt, createdAt, updatedAt

**Relations**:

- opportunities: Opportunity[]
- revenueEvents: LifecycleRevenueEvent[]
- ownerTasks: OwnerTask[]
- threads: ConversationThread[]

**Constraints**: @@unique([organizationId, idempotencyKey])

**Indexes**: organizationId, (organizationId, stage), (organizationId, phone), (organizationId, lastActivityAt), (organizationId, leadgenId), (organizationId, sourceType, createdAt)

**Mirrored in @switchboard/schemas?** Yes, `lifecycle.ts`

---

### Opportunity

**File**: schema.prisma:1506 — `Deal tracking: service, qualification, revenue total`

**Fields**:

- id, organizationId, contactId, contact: Contact, serviceId, serviceName, stage ("interested" default), timeline?, priceReadiness?, objections (Json), qualificationComplete, estimatedValue?, revenueTotal (default 0), assignedAgent?, assignedStaff?, lostReason?, notes?, openedAt, closedAt?, createdAt, updatedAt

**Relations**:

- contact: Contact
- revenueEvents: LifecycleRevenueEvent[]
- ownerTasks: OwnerTask[]

**Indexes**: organizationId, (organizationId, stage), contactId

---

### LifecycleRevenueEvent

**File**: schema.prisma:1537 — `Attributed funnel event: deal stage, payment, attribution`

**Fields**:

- id, organizationId, contactId, contact: Contact, opportunityId, opportunity: Opportunity, amount (Int), currency ("SGD" default), type, status ("confirmed" default), recordedBy, externalReference?, verified, sourceCampaignId?, sourceAdId?, recordedAt, createdAt

**Relations**:

- contact: Contact
- opportunity: Opportunity

**Indexes**: organizationId, opportunityId, (organizationId, recordedAt)

---

### OwnerTask

**File**: schema.prisma:1561 — `Action item: follow-up, escalation, nudge`

**Fields**:

- id, organizationId, contactId?, contact: Contact?, opportunityId?, opportunity: Opportunity?, type, title, description, suggestedAction?, status ("pending" default), priority ("medium" default), triggerReason, sourceAgent?, fallbackReason?, dueAt?, completedAt?, createdAt

**Relations**:

- contact: Contact?
- opportunity: Opportunity?

**Indexes**: (organizationId, status), (organizationId, priority)

---

## Booking & Calendar (Booking)

### Booking

**File**: schema.prisma:1677 — `Calendar event binding: contact, service, datetime, status`

**Fields**:

- id, organizationId, contactId, opportunityId?, calendarEventId?, service, startsAt, endsAt, timezone ("Asia/Singapore" default), status ("pending_confirmation" default), attendeeName?, attendeeEmail?, connectionId?, createdByType ("agent" default), sourceChannel?, workTraceId?, rescheduledAt?, rescheduleCount (default 0), createdAt, updatedAt

**Constraints**: @@unique([organizationId, contactId, service, startsAt])

**Indexes**: (organizationId, startsAt), contactId, status

---

## Channel & Connectivity (ManagedChannel, Connection, FailedMessage, OperatorChannelBinding)

### ManagedChannel

**File**: schema.prisma:502 — `Managed chat integration: Telegram, Slack, WhatsApp`

**Fields**:

- id, organizationId, channel ("telegram"/"slack"/"whatsapp"), connectionId, botUsername?, webhookPath (unique), webhookRegistered, status ("provisioning"/"active"/"error"/"disabled"), statusDetail?, lastHealthCheck?, createdAt, updatedAt

**Constraints**: @@unique([organizationId, channel])

**Indexes**: organizationId, status

---

### Connection

**File**: schema.prisma:193 — `Service credential store: oauth2, api_key, service_account`

**Fields**:

- id, serviceId, serviceName, organizationId?, authType ("oauth2"/"api_key"/"service_account"), credentials (Json, encrypted), scopes[], refreshStrategy ("auto" default), status ("connected" default), lastHealthCheck?, externalAccountId? (Meta account ID), greetingTemplateName? (WhatsApp), createdAt, updatedAt

**Constraints**: @@unique([serviceId, organizationId])

**Indexes**: organizationId, externalAccountId

---

### FailedMessage

**File**: schema.prisma:521 — `Dead-letter queue: parsing/execution errors, retry loop`

**Fields**:

- id, channel, webhookPath?, organizationId?, rawPayload (Json), stage ("parse"/"interpret"/"propose"/"execute"/"unknown"), errorMessage, errorStack?, retryCount (default 0), maxRetries (default 5), status ("pending"/"exhausted"/"resolved"), resolvedAt?, createdAt, updatedAt

**Indexes**: status, organizationId, createdAt

---

### OperatorChannelBinding

**File**: schema.prisma:1453 — `Surface→Principal auth: chat approval, stable channel identity`

**Fields**:

- id, organizationId, channel ("whatsapp"/"telegram"/"slack"/etc.), channelIdentifier (stable ID: phone/user id), principalId, status ("active"/"revoked"), createdBy, revokedBy?, revokedAt?, createdAt, updatedAt

**Constraints**: @@unique([organizationId, channel, channelIdentifier])

**Indexes**: (organizationId, principalId), (organizationId, status)

---

## Workflow & Pending Actions (WorkflowExecution, PendingActionRecord, ApprovalCheckpointRecord, ScheduledTriggerRecord)

### WorkflowExecution

**File**: schema.prisma:1305 — `Workflow instance: steps, approval checkpoints, scheduled triggers`

**Fields**:

- id, organizationId, triggerType, triggerRef?, sourceAgent?, status, plan (Json), currentStepIndex (default 0), safetyEnvelope (Json), counters (Json), metadata (Json), traceId, error?, errorCode?, startedAt, completedAt?

**Relations**:

- pendingActions: PendingActionRecord[]
- approvalCheckpoints: ApprovalCheckpointRecord[]
- triggers: ScheduledTriggerRecord[]

**Indexes**: (organizationId, status), traceId, sourceAgent

---

### PendingActionRecord

**File**: schema.prisma:1332 — `Action in flight: queue or recommendation with undo deadline`

**Fields**:

- id, idempotencyKey (unique), workflowId?, stepIndex?, status, intent, targetEntities (Json), parameters (Json), humanSummary, confidence, riskLevel, dollarsAtRisk (default 0), requiredCapabilities[], dryRunSupported, approvalRequired, fallback (Json)?, sourceAgent, sourceWorkflow?, organizationId, surface ("queue"/"shadow_action" default), undoableUntil? (shadow_action only), createdAt, expiresAt?, resolvedAt?, resolvedBy?

**Relations**:

- workflow: WorkflowExecution?

**Indexes**: (organizationId, status), (organizationId, surface, status), (organizationId, undoableUntil), workflowId, sourceAgent

---

### ApprovalCheckpointRecord

**File**: schema.prisma:1368 — `Workflow pause: approval decision point`

**Fields**:

- id, workflowId, stepIndex, actionId, reason, options[], modifiableFields[], alternatives (Json), notifyChannels[], status, resolution (Json)?, createdAt, expiresAt

**Relations**:

- workflow: WorkflowExecution

**Constraints**: @@unique([workflowId, stepIndex])

**Indexes**: status

---

### ScheduledTriggerRecord

**File**: schema.prisma:1389 — `Delayed or cron execution: timer, cron, event match`

**Fields**:

- id, organizationId, type ("timer"/"cron"/"event_match"), fireAt?, cronExpression?, eventPattern (Json)?, action (Json), sourceWorkflowId?, status ("active"/"fired"/"cancelled"/"expired"), createdAt, expiresAt?

**Relations**:

- workflow: WorkflowExecution?

**Indexes**: (organizationId, status), (status, type), sourceWorkflowId, fireAt

---

## Operator & Command (OperatorRequestRecord, OperatorCommandRecord)

### OperatorRequestRecord

**File**: schema.prisma:1410 — `Raw inbound operator input`

**Fields**:

- id, organizationId, operatorId, channel, rawInput, receivedAt, createdAt

**Indexes**: organizationId

---

### OperatorCommandRecord

**File**: schema.prisma:1422 — `Parsed intent + entities → guardrail result`

**Fields**:

- id, requestId, organizationId, intent, entities (Json), parameters (Json), parseConfidence, guardrailResult (Json), status ("parsed" default), workflowIds (Json), resultSummary?, createdAt, completedAt?

**Indexes**: organizationId, requestId, status

---

## Agent Roster & Enablement (OrgAgentEnablement, AgentRoster, AgentState)

### OrgAgentEnablement

**File**: schema.prisma:446 — `Per-org agent enablement: alex, riley, mira`

**Fields**:

- id, orgId, agentKey (String, not enum; validated by schema), status ("enabled"/"coming_soon"/"disabled"), enabledAt, updatedAt

**Constraints**: @@unique([orgId, agentKey])

**Indexes**: orgId

---

### AgentRoster

**File**: schema.prisma:468 — `Agent catalog entry per organization`

**Fields**:

- id, organizationId, agentRole ("strategist"/"monitor"/"responder"/"optimizer"/"booker"/"guardian"/"primary_operator"), displayName, description, status ("active"/"locked"/"disabled"), tier ("starter"/"pro"/"business"), config (Json), createdAt, updatedAt

**Relations**:

- agentState: AgentState?

**Constraints**: @@unique([organizationId, agentRole])

**Indexes**: organizationId

---

### AgentState

**File**: schema.prisma:486 — `Live state: current task, activity status, metrics`

**Fields**:

- id, agentRosterId (unique), organizationId, activityStatus ("idle"/"working"/"analyzing"/"waiting_approval"/"error"), currentTask?, lastActionAt?, lastActionSummary?, metrics (Json), updatedAt

**Relations**:

- agentRoster: AgentRoster (onDelete: Cascade)

**Indexes**: organizationId

---

## Agent Role Override (AgentRoleOverride)

### AgentRoleOverride

**File**: schema.prisma:823 — `Per-role guardrail exceptions: tool allowlist, governance override`

**Fields**:

- id, organizationId, roleId, allowedTools[] (default []), safetyEnvelopeOverride (Json)?, governanceProfileOverride?, additionalGuardrails (Json)?, createdAt, updatedAt

**Constraints**: @@unique([organizationId, roleId])

---

## Marketplace: Listings & Deployments (AgentListing, AgentDeployment, AgentTask, TrustScoreRecord, ActionRequest)

### AgentListing

**File**: schema.prisma:910 — `Global agent catalog entry`

**Fields**:

- id (cuid), name, slug (unique), description, type ("switchboard_native"/"open_source"/"third_party"), status ("pending_review"/"listed"/"suspended"/"deprecated"), taskCategories[], trustScore, autonomyLevel ("supervised"/"guided"/"autonomous"), priceTier ("free"/"basic"/"pro"/"elite"), priceMonthly, webhookUrl?, webhookSecret?, vettingNotes?, sourceUrl?, metadata?, createdAt, updatedAt

**Relations**:

- deployments: AgentDeployment[]
- tasks: AgentTask[]
- trustScoreRecords: TrustScoreRecord[]

**Indexes**: status, type

---

### AgentDeployment

**File**: schema.prisma:940 — `Founder's running agent instance`

**Fields**:

- id (cuid), organizationId, listingId, status ("provisioning"/"active"/"paused"/"deactivated"), slug? (unique), inputConfig (Json), governanceSettings (Json), outputDestination (Json)?, connectionIds[], skillSlug? (use skill executor if set), circuitBreakerThreshold?, maxWritesPerHour?, allowedModelTiers[], trustLevel ("observe"/"warn"/"auto_approve"), spendApprovalThreshold, createdAt, updatedAt

**Relations**:

- listing: AgentListing
- tasks: AgentTask[]
- actionRequests: ActionRequest[]
- deploymentStates: DeploymentState[]
- deploymentConnections: DeploymentConnection[]

**Constraints**: @@unique([organizationId, listingId])

**Indexes**: organizationId, status

---

### AgentTask

**File**: schema.prisma:972 — `Unit of work assigned to deployment`

**Fields**:

- id (cuid), deploymentId, organizationId, listingId, category, status ("pending"/"running"/"completed"/"awaiting_review"/"approved"/"rejected"/"failed"/"cancelled"), input (Json), output (Json)?, acceptanceCriteria?, reviewResult?, reviewedBy?, reviewedAt?, completedAt?, createdAt, updatedAt

**Relations**:

- deployment: AgentDeployment
- listing: AgentListing
- creativeJob: CreativeJob?

**Indexes**: deploymentId, organizationId, status, (listingId, category)

---

### TrustScoreRecord

**File**: schema.prisma:1001 — `Per-listing per-category trust metrics`

**Fields**:

- id (cuid), listingId, taskCategory, score, totalApprovals, totalRejections, consecutiveApprovals, lastActivityAt, createdAt, updatedAt, deploymentId?

**Relations**:

- listing: AgentListing

**Constraints**: @@unique([listingId, taskCategory])

**Indexes**: listingId, deploymentId

---

### ActionRequest

**File**: schema.prisma:1023 — `Governance request: send_message, browse_url, write_file, api_call`

**Fields**:

- id (cuid), deploymentId, type, surface ("telegram"/"web_widget"/"google_drive"/"browser"), payload (Json), status ("pending"/"approved"/"rejected"/"executed"/"blocked"), governanceResult (Json)?, reviewedBy?, reviewedAt?, executedAt?, createdAt

**Relations**:

- deployment: AgentDeployment

**Indexes**: (deploymentId, status), (status, createdAt)

---

## Marketplace: State & Connections (DeploymentState, DeploymentConnection)

### DeploymentState

**File**: schema.prisma:1044 — `Per-deployment key-value store`

**Fields**:

- id (cuid), deploymentId, key, value (Json), updatedAt

**Relations**:

- deployment: AgentDeployment

**Constraints**: @@unique([deploymentId, key])

**Indexes**: deploymentId

---

### DeploymentConnection

**File**: schema.prisma:1059 — `Deployment credential slots: type + slot + status`

**Fields**:

- id (cuid), deploymentId, type, slot ("default" default), status ("active"/"expired"/"revoked"), credentials (encrypted), metadata (Json)?, tokenHash? (unique), createdAt, updatedAt

**Relations**:

- deployment: AgentDeployment

**Constraints**: @@unique([deploymentId, type, slot])

**Indexes**: deploymentId

---

## Dashboard & Organizations (OrganizationConfig, DashboardUser, DashboardSession, DashboardVerificationToken)

### OrganizationConfig

**File**: schema.prisma:408 — `Org-level settings: runtime, governance, billing, onboarding`

**Fields**:

- id (orgId), name, runtimeType ("http"/"mcp"/"managed"), runtimeConfig (Json), governanceProfile ("observe"/"guarded"/"strict"/"locked"), onboardingComplete, managedChannels[], provisioningStatus, purchasedAgents[], businessHours (Json)?, onboardingPlaybook (Json)?, onboardingStep, firstRunPhase (Json)?, stripeCustomerId? (unique), stripeSubscriptionId?, stripePriceId?, subscriptionStatus ("none"/"trialing"/"active"/"past_due"/"canceled"), cancelAtPeriodEnd, entitlementOverride (manual paid action override), useAgentFirstNav, trialEndsAt?, currentPeriodEnd?, escalationConfig (Json)?, websiteTrackingToken? (unique, 64 hex chars), createdAt, updatedAt

**Relations**:

- users: DashboardUser[]

**Indexes**: None (id is primary key)

---

### DashboardUser

**File**: schema.prisma:373 — `Console auth: email, password, Google OAuth, API key`

**Fields**:

- id, email (unique), name?, emailVerified?, organizationId, principalId, apiKeyEncrypted, passwordHash?, apiKeyHash? (unique), googleId? (unique), org: OrganizationConfig, createdAt, updatedAt

**Relations**:

- org: OrganizationConfig
- sessions: DashboardSession[]

---

### DashboardSession

**File**: schema.prisma:390 — `Session token persistence`

**Fields**:

- id, sessionToken (unique), userId, expires, user: DashboardUser

**Relations**:

- user: DashboardUser (onDelete: Cascade)

**Indexes**: userId

---

### DashboardVerificationToken

**File**: schema.prisma:400 — `Email verification / password reset`

**Fields**:

- identifier, token (unique), expires

**Constraints**: @@unique([identifier, token])

---

## Business Config & Versions (BusinessConfig, ConfigVersion)

### BusinessConfig

**File**: schema.prisma:544 — `Org business profile container`

**Fields**:

- id, organizationId (unique), config (Json: full BusinessProfile), activeVersionId?, createdAt, updatedAt

**Relations**:

- versions: ConfigVersion[]

**Indexes**: organizationId

---

### ConfigVersion

**File**: schema.prisma:557 — `Immutable business config snapshot`

**Fields**:

- id, businessConfigId, version, config (Json), changedBy, changeDescription?, status ("draft"/"active"/"archived"), createdAt

**Relations**:

- businessConfig: BusinessConfig (onDelete: Cascade)

**Indexes**: businessConfigId, status

---

## Cartridge & Registration (CartridgeRegistration)

### CartridgeRegistration

**File**: schema.prisma:182 — `Executable capability bundle: name, version, manifest`

**Fields**:

- id, cartridgeId (unique), name, version, manifest (Json), active, createdAt, updatedAt

---

## Knowledge & Memory (KnowledgeEntry, KnowledgeChunk, DeploymentMemory, InteractionSummary)

### KnowledgeEntry

**File**: schema.prisma:1595 — `Org-scoped knowledge base: playbooks, policies, knowledge`

**Fields**:

- id (cuid), organizationId, kind (enum: playbook/policy/knowledge), scope, title, content (Text), version, active, priority, createdAt, updatedAt

**Constraints**: @@unique([organizationId, kind, scope, version])

**Indexes**: (organizationId, kind, scope, active)

**Mirrored in @switchboard/schemas?** Yes, `knowledge.ts`

---

### KnowledgeChunk

**File**: schema.prisma:606 — `RAG vector embedding: 1024-dim Claude default`

**Fields**:

- id, organizationId, agentId, deploymentId?, documentId, content, sourceType ("correction"/"wizard"/"document"), embedding (vector(1024)), chunkIndex, metadata (Json), createdAt, updatedAt, draftStatus?, draftExpiresAt?

**Indexes**: (organizationId, agentId), (organizationId, deploymentId), documentId, sourceType

---

### DeploymentMemory

**File**: schema.prisma:646 — `Learned facts: category, confidence, source count`

**Fields**:

- id, organizationId, deploymentId, category, content, confidence, sourceCount, lastSeenAt, createdAt, updatedAt

**Constraints**: @@unique([organizationId, deploymentId, category, content])

**Indexes**: (organizationId, deploymentId), confidence

---

### InteractionSummary

**File**: schema.prisma:628 — `Conversation outcome: info_request, booking, etc.`

**Fields**:

- id, organizationId, deploymentId, channelType, contactId?, summary, outcome ("info_request" default), extractedFacts (Json), questionsAsked (Json), duration, messageCount, createdAt

**Indexes**: (organizationId, deploymentId), createdAt

---

## Events & Activity (AgentEvent, ActivityLog, WebhookEventLog)

### AgentEvent

**File**: schema.prisma:667 — `Pending event queue: status, retry count`

**Fields**:

- id, organizationId, deploymentId, eventType, payload (Json), status ("pending" default), retryCount (default 0), createdAt, processedAt?

**Indexes**: (status, createdAt), (organizationId, deploymentId)

---

### ActivityLog

**File**: schema.prisma:682 — `Immutable activity record`

**Fields**:

- id, organizationId, deploymentId, eventType, description, metadata (Json), createdAt

**Indexes**: (organizationId, deploymentId), createdAt

---

### WebhookEventLog

**File**: schema.prisma:460 — `Webhook idempotency dedupe`

**Fields**:

- eventId (id), eventType, processedAt

---

## Idempotency & Message Tracking (IdempotencyRecord, ProcessedMessage)

### IdempotencyRecord

**File**: schema.prisma:214 — `Request replay protection + response cache`

**Fields**:

- id, response (Json), createdAt, expiresAt

**Indexes**: expiresAt

---

### ProcessedMessage

**File**: schema.prisma:223 — `Webhook deduplication: channel, message id`

**Fields**:

- id, channel, createdAt, expiresAt

**Indexes**: expiresAt

---

## Handoff & Escalation (Handoff, EscalationRecord)

### Handoff

**File**: schema.prisma:577 — `Human takeover session: SLA, lead snapshot, status`

**Fields**:

- id, sessionId, organizationId, leadId?, status ("pending"/"assigned"/"active"/"released"), reason, leadSnapshot (Json), qualificationSnapshot (Json), conversationSummary (Json), slaDeadlineAt, acknowledgedAt?, resolutionNote?, resolvedAt?, createdAt, updatedAt

**Indexes**: (organizationId, status), sessionId, slaDeadlineAt

---

### EscalationRecord

**File**: schema.prisma:1282 — `Escalation queue: reason, priority, timeline`

**Fields**:

- id, orgId, contactId, reason, reasonDetails?, sourceAgent, priority ("low"/"medium"/"high"/"urgent"), conversationSummary?, status ("open"/"acknowledged"/"snoozed"/"resolved"), metadata (Json), acknowledgedAt?, resolvedAt?, createdAt, updatedAt

**Indexes**: (orgId, status), contactId, createdAt

---

## Agent Registration (AgentRegistration)

### AgentRegistration

**File**: schema.prisma:890 — `Agent enablement per org: mode, status, capabilities`

**Fields**:

- id, orgId, agentId, agentRole?, executionMode ("realtime"/"scheduled"/"hybrid"), status ("active"/"disabled"/"draft"/"error"), config (Json), configVersion, capabilities (Json), createdAt, updatedAt

**Constraints**: @@unique([orgId, agentId])

**Indexes**: orgId, status

---

## WhatsApp & SMS (WhatsAppMessageStatus)

### WhatsAppMessageStatus

**File**: schema.prisma:1079 — `Message delivery status: error tracking, billing`

**Fields**:

- id (cuid), messageId, recipientId, status, timestamp, errorCode?, errorTitle?, pricingCategory?, billable?, organizationId?, createdAt

**Constraints**: @@unique([messageId, status])

**Indexes**: messageId, (organizationId, createdAt)

---

## Conversion & Attribution (ConversionRecord, ConversionTrace, DispatchLog, ReconciliationReport, PendingLeadRetry)

### ConversionRecord

**File**: schema.prisma:1726 — `Funnel event: type, value, source attribution`

**Fields**:

- id, eventId (unique), organizationId, contactId, type, value (default 0), sourceAdId?, sourceCampaignId?, sourceChannel?, agentDeploymentId?, bookingId?, metadata (Json), occurredAt, createdAt

**Indexes**: (organizationId, type, occurredAt), (organizationId, sourceCampaignId), contactId, bookingId

**Mirrored in @switchboard/schemas?** Partial, `crm-outcome.ts`

---

### DispatchLog

**File**: schema.prisma:1752 — `Ad platform delivery: Stripe, Meta, etc.`

**Fields**:

- id, eventId, platform, status, errorMessage?, responsePayload (Json)?, attemptedAt

**Indexes**: eventId, (platform, status, attemptedAt)

---

### ReconciliationReport

**File**: schema.prisma:1769 — `Attribution pipeline health check`

**Fields**:

- id, organizationId, dateRangeFrom, dateRangeTo, overallStatus, checks (Json), createdAt

**Indexes**: (organizationId, createdAt)

---

### PendingLeadRetry

**File**: schema.prisma:1785 — `Retry queue: missing token, fetch failure`

**Fields**:

- id, organizationId, leadId, adId, formId, reason ("missing_token"/"fetch_failed"), attempts (default 0), maxAttempts (default 5), nextRetryAt, createdAt, resolvedAt?

**Indexes**: (organizationId, resolvedAt), (nextRetryAt, resolvedAt)

---

## Outbox Pattern (OutboxEvent)

### OutboxEvent

**File**: schema.prisma:1709 — `Transactional outbox: guaranteed event publication`

**Fields**:

- id, eventId (unique), type, payload (Json), status ("pending" default), attempts (default 0), lastAttemptAt?, createdAt

**Indexes**: (status, createdAt)

---

## Usage & Logging (LlmUsageLog, WebhookRegistration)

### LlmUsageLog

**File**: schema.prisma:1267 — `LLM token accounting: input, output, model, task type`

**Fields**:

- id, orgId, model, inputTokens, outputTokens, taskType, durationMs?, error?, createdAt

**Indexes**: (orgId, createdAt), model

---

### WebhookRegistration

**File**: schema.prisma:1253 — `Org webhook subscriptions`

**Fields**:

- id, organizationId, url, events[], secret, active, lastTriggeredAt?, createdAt, updatedAt

**Indexes**: organizationId

---

## PCD Identity Registry: Consent & Products (ConsentRecord, ProductIdentity, ProductImage, ProductQcResult)

### ConsentRecord

**File**: schema.prisma:1806 — `Talent/model release: persona, consent scope, territory, media type`

**Fields**:

- id (cuid), orgId, personName, scopeOfUse[], territory[], mediaTypes[], revocable, revoked, recordingUri?, effectiveAt, expiresAt?, revokedAt?, createdAt, updatedAt

**Relations**:

- creatorIdentities: CreatorIdentity[]

**Indexes**: orgId, revoked

---

### ProductIdentity

**File**: schema.prisma:1828 — `Product catalog entry: SKU, brand, package text, image assets`

**Fields**:

- id (cuid), orgId, sourceUrl?, title, description?, brandName?, sku?, packageType?, canonicalPackageText?, dimensionsMm (Json)?, colorSpec (Json)?, logoAssetId?, qualityTier ("url_imported" default), lockStatus ("draft"/"locked"/"archived"), createdAt, updatedAt

**Relations**:

- images: ProductImage[]
- qcResults: ProductQcResult[]
- creativeJobs: CreativeJob[]
- identitySnapshots: PcdIdentitySnapshot[]

**Constraints**: @@unique([orgId, title])

**Indexes**: orgId, qualityTier, lockStatus

---

### ProductImage

**File**: schema.prisma:1858 — `Product imagery: viewType, OCR, approval status`

**Fields**:

- id (cuid), productIdentityId, productIdentity: ProductIdentity, viewType, uri, resolution (Json)?, hasReadableLabel?, ocrText?, backgroundType?, approvedForGeneration, createdAt

**Relations**:

- productIdentity: ProductIdentity (onDelete: Cascade)

**Indexes**: productIdentityId, viewType

---

### ProductQcResult

**File**: schema.prisma:1875 — `Asset QC: logo, package OCR, color, geometry matches`

**Fields**:

- id (cuid), productIdentityId, productIdentity: ProductIdentity, assetRecordId, logoSimilarityScore?, packageOcrMatchScore?, colorDeltaScore?, geometryMatchScore?, scaleConfidence?, passFail, warnings[], createdAt

**Relations**:

- productIdentity: ProductIdentity (onDelete: Cascade)

**Indexes**: productIdentityId, assetRecordId, passFail

---

## Creative Pipeline (CreativeJob, CreatorIdentity, AssetRecord, PcdIdentitySnapshot)

### CreativeJob

**File**: schema.prisma:1118 — `Creative task: brief, pipeline state, PCD registry links`

**Fields**:

- id (cuid), taskId (unique), organizationId, deploymentId, productDescription, targetAudience, platforms[], brandVoice?, productImages[], references[], pastPerformance (Json)?, generateReferenceImages, currentStage ("trends" default), stageOutputs (Json), stoppedAt?, productionTier?, productIdentityId?, productIdentity: ProductIdentity?, creatorIdentityId?, effectiveTier?, allowedOutputTier?, shotSpecVersion?, registryBackfilled, fidelityTierAtGeneration?, mode ("polished"/"ugc"), ugcPhase?, ugcPhaseOutputs (Json)?, ugcPhaseOutputsVersion ("v1" default)?, ugcConfig (Json)?, ugcFailure (Json)?, createdAt, updatedAt

**Relations**:

- task: AgentTask
- productIdentity: ProductIdentity?
- assets: AssetRecord[]

**Indexes**: organizationId, deploymentId, mode, productIdentityId, creatorIdentityId, registryBackfilled

---

### CreatorIdentity

**File**: schema.prisma:1174 — `Avatar/talent identity: voice, personality, appearance rules`

**Fields**:

- id (cuid), deploymentId, name, identityRefIds[], heroImageAssetId, identityDescription, identityObjects (Json)?, voice (Json), personality (Json), appearanceRules (Json), environmentSet[], approved, isActive, bibleVersion ("1.0" default), previousVersionId?, qualityTier?, consentRecordId?, consentRecord: ConsentRecord?, identityAdapter (Json)?, createdAt, updatedAt

**Relations**:

- consentRecord: ConsentRecord?
- identitySnapshots: PcdIdentitySnapshot[]
- assets: AssetRecord[]

**Indexes**: deploymentId, qualityTier, consentRecordId

---

### AssetRecord

**File**: schema.prisma:1213 — `Generated asset: provider, seed, QA metrics, approval state`

**Fields**:

- id (cuid), jobId, job: CreativeJob, specId, creatorId?, creator: CreatorIdentity?, provider, modelId, modelVersion?, seed?, inputHashes (Json), outputs (Json), qaMetrics (Json)?, qaHistory (Json)?, identityDriftScore?, baselineAssetId?, latencyMs?, costEstimate?, attemptNumber?, approvalState ("pending" default), lockedDerivativeOf?, createdAt

**Relations**:

- job: CreativeJob
- creator: CreatorIdentity?
- identitySnapshot: PcdIdentitySnapshot?

**Constraints**: @@unique([specId, attemptNumber, provider])

**Indexes**: jobId, specId, creatorId, approvalState

---

### PcdIdentitySnapshot

**File**: schema.prisma:1894 — `Immutable PCD binding: product + creator + policy at generation`

**Fields**:

- id (cuid), assetRecordId (unique), assetRecord: AssetRecord, productIdentityId, productIdentity: ProductIdentity, productTierAtGeneration, productImageAssetIds[], productCanonicalTextHash, productLogoAssetId?, creatorIdentityId, creatorIdentity: CreatorIdentity, avatarTierAtGeneration, avatarReferenceAssetIds[], voiceAssetId?, consentRecordId?, policyVersion, providerCapabilityVersion, selectedProvider, providerModelSnapshot, seedOrNoSeed, rewrittenPromptText?, createdAt

**Relations**:

- assetRecord: AssetRecord (onDelete: Cascade)
- productIdentity: ProductIdentity
- creatorIdentity: CreatorIdentity

**Indexes**: productIdentityId, creatorIdentityId, selectedProvider

---

## Agent Persona (AgentPersona)

### AgentPersona

**File**: schema.prisma:1099 — `Sales bot personality: business context, tone, qualification rules`

**Fields**:

- id (cuid), organizationId (unique), businessName, businessType, productService, valueProposition, tone ("professional" default), qualificationCriteria (Json), disqualificationCriteria (Json), bookingLink?, escalationRules (Json), customInstructions?, createdAt, updatedAt

---

## Reports & Caching (ReportCache, PdfCache, PreSwitchboardBaseline)

### ReportCache

**File**: schema.prisma:1931 — `Projection cache: report data payload`

**Fields**:

- id, organizationId, window ("THIS_WEEK"/"THIS_MONTH"/"THIS_QUARTER"), payload (Json: ReportDataV1), computedAt, expiresAt

**Constraints**: @@unique([organizationId, window])

**Indexes**: expiresAt

---

### PdfCache

**File**: schema.prisma:1943 — `PDF generation cache`

**Fields**:

- id, organizationId, window, pdfBytes, computedAt, expiresAt

**Constraints**: @@unique([organizationId, window])

**Indexes**: expiresAt

---

### PreSwitchboardBaseline

**File**: schema.prisma:1955 — `Baseline metrics (pre-Switchboard era) for ROAS/ROI trending`

**Fields**:

- id, organizationId, dimension ("ads"/"conversations"), metric ("spend"/"leads"/"revenue"/"roas"/"reply_minutes"/"lead_conversion_rate"), value, periodStart, periodEnd, capturedAt

**Constraints**: @@unique([organizationId, dimension, metric, periodStart, periodEnd])

**Indexes**: (organizationId, dimension, metric)

---

## Summary

**Total models**: 84 (including join tables, caches, and telemetry)

**Top-level domains**: Core Identity, Approval & Governance, Dispatch & Execution, Competence & Risk, Audit, Conversation, Lifecycle (Contacts/Opportunities/Revenue), Booking, Channel, Workflow, Marketplace, Dashboard, Business Config, Cartridge, Knowledge, Events, Idempotency, Handoff, Agent Roster, Usage Logging, PCD Identity Registry, Creative Pipeline, Reports/Caching

**Key non-obvious shapes**:

- **ApprovalLifecycle + ApprovalRevision + ExecutableWorkUnit**: Three-layer immutable snapshot chain; current state lives in ApprovalLifecycle, revision is frozen, workunit is dispatch authority
- **WorkTrace**: Unified telemetry spanning governance + approval + execution; canonical operational record with hash-based auditability
- **PendingActionRecord**: Dual-surface (queue vs. shadow_action); shadow_action has undo deadline; not all recommendations are queued
- **CreativeJob + PcdIdentitySnapshot**: Product/creator identity binding at generation time; product and creator both have consent/QC layers
- **ConversationThread**: Bridges Contact + Agent execution; holds agentContext, followUpSchedule, and opportunity linking
- **KnowledgeChunk**: Fixed 1024-dim embedding; dimension changes require migration + re-embedding
- **OperatorChannelBinding**: Surface→Principal stable mapping; NOT a customer/lead concept
- **Multi-tenant enforcement**: Most models have organizationId index; some (Contact, Opportunity, Booking) require (organizationId, ...) composite indexes for safe tenant isolation
