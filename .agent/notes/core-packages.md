# Switchboard Core Packages Reference

Generated: 2026-05-07

**How to use this doc:** This is an index of what each `@switchboard/*` package is for and what it exports. It's a map, not a guide — use it to (1) understand package boundaries, (2) find where a type or function lives, (3) spot dependency leaks. Read CLAUDE.md§Dependency Layers alongside this to validate your imports.

---

## @switchboard/schemas

**Layer**: 1

**Imports from**: None

**Purpose**: Zod runtime schemas and TypeScript types for all platform entities (principals, actions, approvals, workflows, CRM events, creative pipelines, marketplace, etc.). Single source of truth for request/response shapes across the platform.

### Top-level exports (from src/index.ts)

- `PrincipalTypeSchema`, `PrincipalRoleSchema`, `Principal`, `DelegationRule` — User, agent, service account identities and delegation rules for policy evaluation
- `AgentManifestSchema`, `CapabilityType`, `ConnectionRequirementSchema` — Agent metadata and connection requirements (from sdk integration)
- `ActionEnvelopeSchema`, `ActionRequestSchema` — Canonical action request shape (what enters PlatformIngress.submit)
- `ApprovalSchema`, `ApprovalStatusSchema`, `QuorumRuleSchema` — Approval state machine inputs and types
- `PolicySchema`, `RoleOverlaySchema`, `GovernanceProfileSchema` — Identity and approval policy definitions
- `RiskCategorySchema`, `RiskRuleSchema`, `RiskAdjustmentSchema` — Risk scoring and mitigation configuration
- `CartridgeSchema`, `CartridgeContextSchema`, `ExecuteResultSchema` — Legacy cartridge interface types
- `AuditSchema`, `AuditLogSchema` — Work trace hashing and integrity evidence
- `EnvelopeSchema`, `ActionPlanSchema`, `DecisionTraceSchema` — Decision tree and action plan serialization
- `ResolverSchema`, `UndoSchema`, `CompetenceSchema` — Entity resolution, undo recipes, executor capabilities
- `MCPToolSchema` — MCP server tool interface shape
- `DataFlowSchema` — Cross-cartridge data dependency graph
- `CapabilitySchema` — Executor routing and step type definitions
- `GoalBriefSchema` — Structured goal decomposition for planning
- `SessionSchema`, `ConversationThreadSchema`, `WorkflowSchema`, `SchedulerSchema`, `OperatorCommandSchema` — Runtime object shapes
- `LifecycleSchema` (Contact, Opportunity, Revenue, OwnerTask) — CRM domain entities
- `RoutedEventEnvelopeSchema`, `createEventEnvelope` — Event bus routing
- `MarketplaceSchema` (AgentListing, Deployment, Task, TrustScore) — Agent marketplace types
- `AgentPersonaSchema` — Sales pipeline business context
- `CreativeJobSchema`, `UgcJobSchema`, `CreatorIdentitySchema`, `AssetRecordSchema`, `IdentityStrategySchema`, `ProviderCapabilitiesSchema`, `RealismScoreSchema`, `FunnelFrictionSchema` — Creative pipeline and UGC types
- `DeploymentMemorySchema` — Three-tier agent memory system (customer, owner, aggregate)
- `ThreeChannelSchema` (TrustLevel, NotificationTier, AgentEvent, ActivityLog) — Three-channel privacy-scoped communication
- `AdOptimizerSchema`, `AdOptimizerV2Schema` — Campaign insights, funnel analysis, audit reports
- `LeadIntakeSchema` — CTWA + Instant Form attributed lead events
- `KnowledgeSchema` — Curated playbooks, policies, domain guidance
- `TemporalFactSchema` — Entity-scoped temporal fact system
- `ConversionSchema`, `CalendarSchema`, `CrmSchema` — Platform integrations
- `CrmOutcomeSchema` — Shared across ad-optimizer and db
- `PlaybookSchema` — Structured onboarding playbook
- `WebsiteScanSchema` — Lightweight homepage extraction
- `DashboardOverviewSchema` — Operator dashboard overview
- `ApprovalLifecycleSchema` — Approval lifecycle authority objects
- `PcdIdentitySchema` — PCD Identity Registry types
- `RecommendationSchema` — Surface, status, action enums + canonical input shape
- `ReportsV1Schema` — Operator deep-dive surface view-model

### Sub-modules (notable directories under src/)

- `/__tests__/` — Schema validation tests. Testing convention: each major schema gets a .test.ts file (schemas.test.ts, cartridge-types.test.ts, agents.test.ts); some inline tests on types with domain-specific validation (lead-intake.test.ts, lifecycle-source-type.test.ts).
- `/reports/` — Report view-model schemas only (v1.ts). Operator-facing surfaces.

### Key services / public APIs

None — this is a schema-only package. Consumers import specific schemas and infer types with `z.infer<typeof SomeSchema>`.

### Tests

- `src/__tests__/*.test.ts` — Zod schema validation (parse success/failure cases)
- `src/lead-intake.test.ts`, `src/lifecycle-source-type.test.ts` — Domain-specific schema tests

---

## @switchboard/sdk

**Layer**: 2

**Imports from**: schemas

**Purpose**: Agent SDK surface — manifest validation, handler types, and test harness for skills and cartridges. Defines the agent interface contract used by app runtime and deployment tools.

### Top-level exports (from src/index.ts)

- `AgentManifestSchema`, `CapabilityType`, `PricingModel`, `ConnectionRequirementSchema`, `AgentManifest`, `ConnectionRequirement` — Agent metadata schema and types for skill registration
- `AgentHandler` — Handler function type (request, context) ⟹ response
- `AgentContext`, `AgentPersona`, `StateStore`, `ChatProvider`, `FileProvider`, `BrowserProvider`, `LLMProvider`, `StructuredNotification` — Runtime context passed to handler (deps, state, APIs)
- `HandoffPayload` — Human handoff message shape
- `ActionType`, `ActionStatus`, `ActionRequestSchema`, `ActionRequest` — Action execution request / response types

### Sub-modules (notable directories under src/)

- `/testing/` — Test harness and utilities. Files: test-harness.ts, helpers.ts. Provides mock agents and test runners for skill validation.
- `/__tests__/` — SDK self-tests: manifest.test.ts, handler.test.ts, test-harness tests.

### Key services / public APIs

Test harness (used by skill dev and verification pipelines) — instantiate with agent manifest + handler, run test cases, assert outputs.

### Tests

- `src/__tests__/manifest.test.ts` — Manifest schema validation and extension
- `src/__tests__/handler.test.ts` — Handler context and return type validation
- `src/testing/__tests__/test-harness.test.ts` — Test harness integration tests

---

## @switchboard/cartridge-sdk

**Layer**: 2

**Imports from**: schemas

**Purpose**: Legacy cartridge runtime interface. Cartridges are stateful integrations (Salesforce, Meta, etc.) that expose actions to the platform. This SDK is pending removal; prefer agents and skills.

### Top-level exports (from src/index.ts)

- `Cartridge`, `CartridgeContext`, `CartridgeInterceptor`, `ExecuteResult` — Cartridge handler types and result shape
- `ExecuteResultBuilder`, `failResult` — Result construction helpers
- `ActionBuilder`, `action` — Action definition helpers for cartridge authors
- `validateConnection` — Connection config validation
- `CartridgeConnectionConfig` — Connection credential shape
- `createConnectionContract` — Connection contract factory
- `ConnectionContract` — Contract type
- `TestCartridge`, `createTestManifest` — Test utilities
- `validateManifest`, `validateCartridge` — Cartridge validation functions
- `ValidationResult`, `ValidationIssue` — Validation result types
- `CartridgeTestHarness`, `HarnessReport`, `HarnessStepResult`, `HarnessOptions` — Test harness for cartridge validation
- `SERVICE_REGISTRY`, `getServiceById`, `getServiceByCartridge` — Service lookup (hard-coded cartridge registry)
- `ServiceRegistryEntry` — Service registry entry type
- `parseParams`, `ParamValidationError` — Parameter parsing and validation

### Sub-modules (notable directories under src/)

- `/__tests__/` — Legacy cartridge self-tests: parse-params, test-harness, sdk, result-builder, validation. Comprehensive test coverage for each SDK component.

### Key services / public APIs

- `CartridgeTestHarness` — Verify cartridge manifest and actions. Class HarnessReport, HarnessStepResult.
- `SERVICE_REGISTRY` — Global cartridge catalog. Hard-coded mappings (pending replacement with database-driven agent registry).

### Tests

- `src/__tests__/*.test.ts` — Comprehensive cartridge SDK tests. Heavy mocking of cartridge contexts and connections.

---

## @switchboard/creative-pipeline

**Layer**: 2

**Imports from**: schemas

**Purpose**: Creative content generation and optimization pipeline (async jobs via Inngest). Handles UGC (user-generated content) planning, scripting, production, and AI-generated content approval. Includes trend analysis, realism scoring, provider routing, and video generation.

### Top-level exports (from src/index.ts)

- `inngestClient`, `CreativePipelineEvents` — Inngest event client and event types
- `createCreativeJobRunner`, `executeCreativePipeline` — Creative job runner factory and execution
- `runStage`, `getNextStage`, `STAGE_ORDER` — Stage execution and ordering (StageName, StageInput types)
- `callClaude`, `extractJson` — LLM integration wrapper and JSON parsing
- `runTrendAnalyzer`, `buildTrendPrompt` — Trend analysis stage
- `runHookGenerator`, `buildHookPrompt` — Hook/copy generation stage
- `runScriptWriter`, `buildScriptPrompt` — Script writing stage
- `runStoryboardBuilder`, `buildStoryboardPrompt` — Storyboard generation stage
- `DalleImageGenerator`, `ImageGenerator` — DALL-E image generation interface and implementation
- `estimateCost` — Cost estimation for pipeline runs
- `createModeDispatcher`, `executeModeDispatch` — Dispatch to creative vs. optimization mode
- `createUgcJobRunner`, `executeUgcPipeline` — UGC-specific job runner
- `shouldRequireApproval`, `DEFAULT_APPROVAL_CONFIG`, `UgcPhase`, `ApprovalConfig` — UGC approval gate logic
- `translateFrictions` — Funnel friction to creative brief translator
- `selectStructures`, `getStructureTemplates`, `StructureTemplate`, `StructureSelection`, `StructureId` — UGC scene structure selection
- `castCreators` — Scene casting and creator assignment
- `CastingAssignment` — Casting result type
- `routeIdentityStrategy` — Identity strategy routing (persona, AAVE, accent, region)
- `executePlanningPhase`, `PlanningInput`, `PlanningOutput` — UGC planning phase
- `generateDirection` — UGC creative direction
- `buildUgcScriptPrompt`, `runUgcScriptWriter` — UGC script writing
- `executeScriptingPhase`, `ScriptingInput`, `ScriptingOutput` — UGC scripting phase
- `rankProviders`, `getDefaultProviderRegistry`, `RankedProvider` — Provider routing and ranking
- `evaluateRealism`, `computeDecision`, `computeWeightedSoftScore`, `DEFAULT_QA_THRESHOLDS`, `QaThresholdConfig`, `RealismScorerInput` — Realism QA scoring
- `executeProductionPhase`, `ProductionInput`, `ProductionOutput` — UGC production phase (provider calls)
- `KlingClient` — Kling video generation client
- `createVideoProvider`, `VideoProvider`, `VideoGenerationRequest`, `VideoGenerationResult` — Video generation abstraction
- `ProviderPerformanceTracker`, `emptyPerformanceHistory`, `ProviderPerformanceHistory`, `PerformanceRecord` — Provider performance tracking

### Sub-modules (notable directories under src/)

- `/stages/` — Creative generation stages. Files: run-stage.ts (orchestrator), call-claude.ts (LLM), trend-analyzer.ts, hook-generator.ts, script-writer.ts, storyboard-builder.ts, image-generator.ts (DALL-E), cost-estimator.ts, kling-client.ts (video).
- `/stages/__tests__/` — Stage unit tests (trend, hook, script, storyboard, image, realism, provider performance).
- `/ugc/` — UGC (user-generated content) pipeline. Files: ugc-job-runner.ts, approval-config.ts, funnel-friction-translator.ts, structure-engine.ts, scene-caster.ts, identity-strategy-router.ts, ugc-director.ts, ugc-script-writer.ts, provider-router.ts, realism-scorer.ts, provider-performance.ts, video-provider.ts.
- `/ugc/phases/` — UGC phase executors: planning.ts, scripting.ts, production.ts.
- `/util/` — Utility functions (if any).
- `/__tests__/` — Creative pipeline tests: creative-job-runner, identity-strategy-router, image-generator, realism-scorer, provider-performance.

### Key services / public APIs

- `createCreativeJobRunner()` — Factory for creative job executors. Mocked Inngest client in tests.
- `executeCreativePipeline()` — Main pipeline orchestrator.
- `createUgcJobRunner()` — UGC job factory.
- `executeUgcPipeline()` — UGC orchestrator (planning ⟹ scripting ⟹ production ⟹ approval).
- `rankProviders()` — Provider selection logic.
- `evaluateRealism()` — QA scoring entry point.

### Tests

- `src/__tests__/*.test.ts` — Integration tests for job runners and key stages
- Mocking convention: Inngest client mocked as `inngest.send()`, LLM calls mocked in test fixtures, image/video providers stubbed

---

## @switchboard/ad-optimizer

**Layer**: 2

**Imports from**: schemas

**Purpose**: Meta (Facebook/Instagram) and Google ad platform integration. Campaign performance analysis, funnel diagnostics, budget optimization, creative performance analysis, saturation detection, and outcome attribution (CRM ⟷ ad platform sync).

### Top-level exports (from src/index.ts)

- `MetaAdsClient` — Meta Ads API HTTP client (campaign insights, ad sets, ads, ROAS)
- `MetaCAPIClient` — Meta Conversions API client (server-side event tracking)
- `analyzeFunnel`, `CrmFunnelData`, `FunnelBenchmarks`, `FunnelInput` — Funnel analysis (CTWA ⟹ form ⟹ lead ⟹ contact ⟹ opportunity ⟹ revenue)
- `comparePeriods`, `MetricSet` — Period-over-period comparison (WoW, MoM, YoY)
- `LearningPhaseGuard`, `CampaignLearningInput`, `PerformanceMetrics`, `PerformanceTargets` — Learning phase detection and guardrails
- `diagnose`, `Diagnosis` — Metric anomaly diagnostician
- `generateRecommendations`, `RecommendationInput` — Recommendation engine (budget, creative, targeting)
- `AuditRunner`, `AuditDependencies`, `AuditConfig`, `AdsClientInterface` — Weekly/daily audit runner (Inngest functions)
- `createWeeklyAuditCron`, `createDailyCheckCron`, `CronDependencies` — Inngest function factories
- `parseLeadWebhook`, `fetchLeadDetail`, `extractFieldValue`, `LeadData` — Meta Lead Ads webhook ingestion
- `buildAuthorizationUrl`, `exchangeCodeForToken`, `exchangeForLongLivedToken`, `listAdAccounts`, `refreshTokenIfNeeded`, `FacebookOAuthConfig`, `TokenResult`, `AdAccount` — OAuth flow (Auth Code ⟹ short-lived ⟹ long-lived token)
- `buildConversionEvent`, `BuildConversionEventParams` — CRM outcome ⟹ CAPI conversion event
- `MetaCAPIDispatcher` — Outbox ⟹ CAPI dispatch (reliability + batching)
- `MetaCampaignInsightsProvider` — Campaign insights data provider (for reports)
- `MetaReportInsightsProvider` — Report insights aggregation
- `LearningPhaseGuardV2` — Improved learning phase detection
- `detectFunnelShape`, `getFunnelStageTemplate` — Funnel topology detection
- `detectTrends`, `projectBreach`, `classifyTrendTier` — Trend detection and projection
- `analyzeBudgetDistribution`, `detectCBO` — Budget analysis (CBO vs. ad-set-level)
- `deduplicateCreatives`, `analyzeCreatives`, `RawAdData` — Creative performance analysis
- `detectSaturation` — Audience saturation detection
- Lead intake exports (from lead-intake/index.js) — Lead intake router
- `RealCrmDataProvider` — Prisma-backed CRM funnel provider (file: crm-data-provider/real-provider.js)
- `compareSources`, `SourceComparisonRow`, `SourceComparisonInput`, `SourceComparisonResult` — Source attribution comparison
- `runRecommendationSink`, `RunRecommendationSinkArgs`, `RunRecommendationSinkResult`, `RecommendationEmitter`, `EmitOutcome` — Recommendation persistence and emission
- Onboarding exports (from onboarding/coverage-validator.js) — Setup completeness validation

### Sub-modules (notable directories under src/)

- `/lead-intake/` — Lead Ads webhook ingestion (Meta lead form + CTWA attributed leads).
- `/crm-data-provider/` — CRM funnel data providers (interface + real Prisma implementation).
- `/analyzers/` — Analysis modules: source-comparator.ts (attribution by source), and others.
- `/onboarding/` — Coverage validator for setup completeness.
- `/__tests__/` — Ad optimizer self-tests. Heavy Meta API mocking. Test files: outcome-dispatcher, meta-capi-dispatcher, meta-report-insights-provider, meta-campaign-insights-provider, wire-ad-dispatchers, google-offline-dispatcher, crm-event-emitter.

### Key services / public APIs

- `MetaAdsClient` — Campaign insights, ad data. Uses Bearer token auth.
- `MetaCAPIClient` — Server-side conversion event dispatch.
- `MetaCAPIDispatcher` — Outbox pattern for reliability; handles batching and retry.
- `AuditRunner` — Weekly audit (recommendations) + daily check (saturation, learning phase, trends).
- Lead intake (webhook ⟹ integration router, also accessible as a skill intent in apps/api).
- `analyzeFunnel()` — Core funnel analysis (CTWA ⟹ revenue).
- `detectTrends()`, `projectBreach()` — Trend detection and forecasting.
- `generateRecommendations()` — Action recommendations (budget, creative rotation, targeting).

### Tests

- `src/__tests__/*.test.ts` — Meta API, CAPI, insights, dispatcher tests
- Mocking convention: Meta API responses mocked in fixtures, Prisma mocked via jest.mock, Inngest client stubbed

---

## @switchboard/core

**Layer**: 3

**Imports from**: schemas, cartridge-sdk, sdk

**Purpose**: Platform orchestration — governance (rule evaluation, risk scoring, policy engine), approval state machine, execution lifecycle (propose ⟹ approve ⟹ execute), cartridge/skill/workflow runtime, audit ledger, notifications, identity and delegation, knowledge RAG, conversations, sessions, workflows, scheduling, marketplace, billing, skill runtime, channel integration, website scanning, and operator command handling.

### Top-level exports (from src/index.ts)

- **Engine** (rule evaluation, risk scoring, policy engine, simulation) — `evaluateRule`, `computeRiskScore`, `createTraceBuilder`, `resolveEntities`, `evaluatePlan`, `formatSimulationResult`, `evaluate`, `simulate`, `createGuardrailState`, risk posture store
- **Identity** (spec resolution, overlays, principals, governance presets) — All identity and principal handling
- **Approval** (state machine, routing, binding, expiry, delegation, patching, chains) — Full approval lifecycle (create, transition, expiry, delegation, patch, respond)
- **Storage** (in-memory stores, interfaces) — Approval, envelope, identity, role override stores (interfaces + in-memory impls)
- **Orchestrator** (lifecycle, propose pipeline, approval/execution managers) — `LifecycleOrchestrator`, `ProposePipeline`, `ExecutionManager`, cartridge circuit breaker, shared execution context
- **Audit** (hashing, canonicalization, redaction, evidence, ledger) — Work trace hashing (v1, v2), evidence collection, ledger (append-only audit trail)
- **Telemetry** (tracing, metrics, LLM cost table) — Observability primitives
- **Observability** (operator alerter, infrastructure failure tracking) — `OperatorAlerter`, infrastructure failure audit event builder
- **Execution Guard** — `GuardedCartridge`, `beginExecution`, `endExecution` (sandbox for cartridge execution)
- **Notifications** (approval notifiers, proactive sender) — Approval notification routing, proactive outbound messaging
- **Guardrail State** — Guardrail state store and helpers
- **Runtime Adapters** (MCP, API) — Tool registry, MCP server scaffolding, API request/response adapters
- **Execution Service** — `ExecutionService` (propose + conditional execute facade), `NeedsClarificationError`, `NotFoundError`
- **Read Adapter** — `CartridgeReadAdapter` (governed read path), `ReadOperation`, `ReadResult`
- **Governance** — `profileToPosture`, `checkActionTypeRestriction`, `DEFAULT_GOVERNANCE_PROFILE`, governance profile store
- **Policy Cache** — `InMemoryPolicyCache`, `DEFAULT_POLICY_CACHE_TTL_MS`
- **Utils** (retry, circuit breaker, pagination, nested value) — Utility functions
- **Data-Flow Plan Execution** — Plan graph execution (cross-cartridge data dependencies)
- **Capability Registry** — Executor capability routing
- **Planning** (goal parsing, plan graph building) — Goal brief ⟹ plan graph AST
- **Idempotency Guard** — `IdempotencyGuard`, in-memory idempotency store
- **Credential Resolution** — `NoOpCredentialResolver`, credential resolver interface
- **Tool Registry** — Tool registration and lookup
- **Event Bus** (conversion feedback loop) — `InMemoryConversionBus`, `RedisStreamConversionBus`, conversion event types
- **Outbox Publisher** — Outbox ⟹ bus relay (Transactional Outbox pattern)
- **LLM Client** — Claude, Voyage adapters and interfaces
- **State Machine** (generic) — `StateMachine` (config, transition, guards, callbacks)
- **Dialogue** — Emotional classification, naturalness packet assembly, localized system prompts, variation pool, language detection, bilingual handling, post-validation
- **Handoff** — `HandoffPackageAssembler`, `HandoffNotifier`, `SlaMonitor`, handoff types (package, reason, status, store, snapshots, conversation summary)
- **Embedding Adapter** — Embedding provider interface
- **Conversation Store** — Conversation storage interface
- **Conversation Thread** — Per-contact derived state (conversation history, context)
- **Knowledge Store** — RAG chunk persistence interface
- **Knowledge** (RAG retrieval, chunking, ingestion) — `chunkText`, `IngestionPipeline`, `KnowledgeRetriever`, confidence scoring, chunk types
- **LLM Adapter** — Conversational LLM interface (agent-facing)
- **Model Router** (slot-based model selection) — `ModelRouter` (slot, tier-based model selection), effort estimation
- **Sessions** (session runtime) — Session execution and state
- **Workflows** (workflow execution runtime) — Workflow definition and execution
- **Scheduler** (trigger registration, state machine, event matching) — Workflow scheduling and event triggers
- **Operator Command Store** — Operator command routing and state
- **Lifecycle** (Contact, Opportunity, Revenue, OwnerTask) — CRM entity lifecycle stores (interfaces; Prisma impls in db)
- **Marketplace** (Trust Score Engine) — Agent listing, deployment, task, trust score types and state
- **Channel Gateway** (channel ⟹ AgentRuntime bridge) — Multi-channel integration (Telegram, WhatsApp, Slack)
- **Website Scanner** — `WebsiteScanner`, URL validation, platform detection (Shopify, WooCommerce, etc.)
- **Context Budget** — Layered context discipline (effort, memory, task, budget types)
- **Memory** (scoped store interfaces for three-channel privacy) — Three-tier memory (customer, owner, aggregate)
- **Intents** — `LeadIntakeHandler`, `buildLeadIntakeWorkflow` (intent-based action handlers)
- **Recommendations** — Recommendation router, types, store interface
- **Decisions** — Decision type, urgency scorers, source adapters
- **Agents** — Org-level agent enablement store interface
- **Reports** — Operator deep-dive surface view-model

### Sub-modules (notable directories under src/)

- `/engine/` — Rule evaluation, risk scoring, policy engine, simulation. Core decision logic.
- `/approval/` — Approval state machine, routing, delegation, expiry, patching, lifecycle service.
- `/orchestrator/` — LifecycleOrchestrator, propose pipeline, execution manager, shared context, circuit breaker.
- `/audit/` — Work trace hashing (v1, v2), canonicalization, redaction, ledger (append-only).
- `/platform/` — Large subsystem containing PlatformIngress, PlatformLifecycle, IntentRegistry, ExecutionModeRegistry, work-trace, work-unit, governance gate, deployment resolver, modes (skill, cartridge, workflow), intent registrars. Files: platform-ingress.ts (submit entry point), platform-lifecycle.ts (approve/execute lifecycle), intent-registry.ts, execution-mode-registry.ts, work-unit.ts, work-trace-recorder.ts, governance/index.ts, modes/index.ts.
- `/skill-runtime/` — Batch skill handler, execution function, governance injector, outcome linker, blast radius limiter, circuit breaker, builder registry, tools, hooks. Batch skill mode runtime.
- `/agent-runtime/` — Agent handler runtime and utilities (new skill-based agents, distinct from legacy cartridges).
- `/identity/` — Identity spec resolution, overlays, principals, governance presets.
- `/storage/` — In-memory stores (approval, envelope, identity, role override) and store interfaces.
- `/notifications/` — Approval notifiers (email, Slack, etc.), proactive sender.
- `/llm/` — Claude client, Voyage embeddings, LLM interfaces.
- `/dialogue/` — Emotional classification, naturalness packet assembly, language detection, bilingual handling, post-validation, system prompt builder, variation pool.
- `/handoff/` — Handoff package assembly, notification routing, SLA monitoring.
- `/knowledge/` — RAG retrieval, chunking, ingestion pipeline.
- `/conversations/` — Per-contact conversation thread state.
- `/sessions/` — Session execution runtime.
- `/workflows/` — Workflow definition and execution.
- `/scheduler/` — Workflow scheduling and event triggers.
- `/operator/` — Operator command routing.
- `/lifecycle/` — CRM entity lifecycle (Contact, Opportunity, Revenue, OwnerTask) store interfaces.
- `/marketplace/` — Agent listing, deployment, task, trust score state and engines.
- `/channel-gateway/` — Multi-channel integration (Telegram, WhatsApp, Slack).
- `/website-scanner/` — URL validation, platform detection, page fetching.
- `/memory/` — Three-tier memory (customer, owner, aggregate) interfaces.
- `/intents/` — Intent-based action handlers (lead intake, etc.).
- `/recommendations/` — Recommendation router, types, persistence interface.
- `/decisions/` — Decision urgency, source adapters.
- `/agents/` — Agent enablement store interface.
- `/reports/` — Operator report view-model.
- `/__tests__/` — Comprehensive test coverage. Test directories mirror source structure. Heavy mocking of Prisma, LLM, OAuth, external APIs.

### Key services / public APIs

- **PlatformIngress.submit(request)** — Entry point for all mutating actions (the Core Invariant). Routes to governance gate, then orchestrator.
- **LifecycleOrchestrator.propose(workUnit)** ⟹ approval request — Phase 1: action validation, risk scoring, policy evaluation.
- **PlatformLifecycle.respondToApproval(decision)** ⟹ execute — Phase 2: conditional execution via ExecutionManager.
- **Engine.evaluate(context, rule)** — Policy rule evaluation (risk, entitlement, spend limits, blacklist/whitelist).
- **ApprovalState.transitionApproval(current, response)** — Approval state machine (pending ⟹ approved/denied/escalated).
- **KnowledgeRetriever.retrieve(query, options)** — RAG search interface.
- **ConversationStore.getThread(contactId)** — Conversation history.
- **SessionManager.createSession(config)** — Session lifecycle.
- **WorkflowExecutor.execute(workflow, input)** — Workflow execution.
- **SchedulerService.registerTrigger(definition)** — Workflow scheduling.
- **ExecutionService.proposeAndExecute(request)** — Propose + conditional execute facade.
- **CartridgeReadAdapter.read(operation)** — Governed read (no mutations, audited).
- **ModelRouter.resolve(slot, tier)** — Model selection (Claude 3.5 Sonnet/Haiku by tier).
- **WebsiteScanner.scan(url)** — Platform detection and page extraction.

### Tests

- `src/__tests__/` and subdirectory `__tests__/` — Heavy test coverage. Each module has co-located tests (e.g., approval/state-machine.test.ts).
- Mocking convention: Prisma mocked via jest.mock, LLM responses stubbed, external APIs (Meta, Google) mocked, Inngest stubbed, Redis stubbed
- Integration tests for full workflows (propose → approve → execute)

---

## @switchboard/db

**Layer**: 4

**Imports from**: schemas, core

**Purpose**: Prisma ORM, store implementations, and credential encryption. Persistent storage for all platform entities (approvals, conversations, workflows, jobs, credentials, CRM data, conversions, metrics, recommendations, etc.). Single source of truth for schema migrations and data model.

### Top-level exports (from src/index.ts)

- `getDb()` — Lazy singleton PrismaClient getter
- `PrismaClient`, `Prisma` — Prisma ORM types
- `createPrismaStorage` — Storage factory for core interfaces (approval, envelope, identity, etc.)
- **Credential Storage** — `encryptCredentials`, `decryptCredentials`, `isEncrypted` (at-rest encryption using node:crypto)
- **OAuth** — `refreshMetaOAuthToken`, `TokenRefreshResult` (Meta token refresh with conditional long-lived re-auth)
- **Ledger Storage** — `PrismaLedgerStorage` (append-only audit trail for engine decisions)
- **Connection Storage** — `PrismaConnectionStore`, `ConnectionRecord` (cartridge connection configs, encrypted)
- **Governance** — `PrismaGovernanceProfileStore` (org-level approval policy)
- **Credential Resolver** — `PrismaCredentialResolver` (connection credential lookup by cartridge/deployment)
- **Work Trace** — `PrismaWorkTraceStore` (canonical persistence for action proposals/executions)
- **Integrity** — `WORK_TRACE_INTEGRITY_CUTOFF_AT` (cutoff date for hash integrity verification v1→v2)
- **Agent State** — `deriveAgentStates`, `DerivedAgentState` (org agent registry projection)
- **Store Classes** (58 Prisma-backed implementations):
  - Handoff: `PrismaHandoffStore` (human handoff state)
  - Conversation: `PrismaConversationStore`, `PrismaConversationStateStore` (messages + thread state), `PrismaConversationThreadStore` (per-contact derived state)
  - Lifecycle: `PrismaDeploymentLifecycleStore` (deployment lifecycle), `PrismaContactStore`, `PrismaOpportunityStore`, `PrismaRevenueStore`, `PrismaOwnerTaskStore`, `PrismaLifecycleStore` (CRM entity DAOs)
  - Knowledge: `PrismaKnowledgeStore` (RAG chunk persistence), `PrismaKnowledgeEntryStore` (playbook entries)
  - Approval: `PrismaApprovalStore` (approval state machine persistence)
  - Sessions: `PrismaSessionStore` (session state)
  - Runs: `PrismaRunStore` (step execution state)
  - Pause: `PrismaPauseStore` (execution pause state)
  - Tools: `PrismaToolEventStore` (tool invocation audit)
  - Role Override: `PrismaRoleOverrideStore` (role delegation overrides)
  - Workflows: `PrismaWorkflowStore` (workflow definitions), `PrismaTriggerStore` (workflow triggers)
  - Commands: `PrismaOperatorCommandStore` (operator command routing)
  - Channels: `PrismaOperatorChannelBindingStore` (channel ⟷ operator binding)
  - Marketplace: `PrismaListingStore`, `PrismaDeploymentStore`, `PrismaAgentTaskStore`, `PrismaTrustScoreStore`, `PrismaAgentPersonaStore` (agent registry and performance)
  - Actions: `PrismaActionRequestStore` (action request lifecycle)
  - Deployment State: `PrismaDeploymentStateStore` (deployment runtime state), `PrismaDeploymentConnectionStore` (deployment ⟷ connection binding), `PrismaDeploymentMemoryStore` (three-tier memory: customer, owner, aggregate)
  - Creative: `PrismaCreativeJobStore` (UGC/creative job state), `PrismaCreatorIdentityStore` (creator personas), `PrismaAssetRecordStore` (generated assets)
  - Interaction: `PrismaInteractionSummaryStore` (contact interaction summaries)
  - Events: `PrismaEventStore` (platform event log)
  - Activity: `PrismaActivityLogStore` (three-channel activity audit)
  - Memory: `PrismaCustomerMemoryStore`, `PrismaOwnerMemoryStore`, `PrismaAggregateMemoryStore` (three-tier scoped memory)
  - Execution Trace: `PrismaExecutionTraceStore` (skill execution traces)
  - Conversion: `PrismaConversionRecordStore` (ad ⟷ CRM conversion attribution)
  - Outbox: `PrismaOutboxStore` (Transactional Outbox for event bus)
  - Dispatch Log: `PrismaDispatchLogStore` (Meta CAPI, Google Offline dispatch audit)
  - Reconciliation: `PrismaReconciliationStore` (data consistency audit)
  - Business Facts: `PrismaBusinessFactsStore` (org-level facts)
  - Managed Channel: `PrismaManagedChannelStore` (channel integrations)
  - CRM Data: `PrismaCrmDataProvider`, `PrismaCrmFunnelStore` (funnel analytics data)
  - Lead Intake: `PrismaLeadIntakeStore` (lead form and CTWA events)
  - Product: `PrismaProductIdentityStore` (product catalog), `PrismaProductImageStore` (implicit via AddProductImageInput)
  - Consent: `PrismaConsentRecordStore` (user consent audit)
  - PCD: `PrismaPcdIdentitySnapshotStore` (PCD identity snapshots)
  - Reader: `PrismaContactReader` (read-only contact projection)
  - Booking: `PrismaBookingStore` (booking state)
  - Recommendations: `PrismaRecommendationStore` (ad-optimizer recommendations)
  - Reports: `PrismaReportCacheStore` (report view-model cache)
  - Baseline: `PrismaBaselineStore` (metric baselines for anomaly detection)
  - Agents: `createInMemoryOrgAgentEnablementStore`, `PrismaOrgAgentEnablementStore` (org agent registry)
- **Seed** — `seedOrgDayOneAgents` (bootstrap org with default agents: Alex, Riley, Mira)

### Sub-modules (notable directories under src/)

- `/storage/` — Core store factories and interfaces. `createPrismaStorage`, connection store, governance store, credential resolver.
- `/stores/` — 58 Prisma-backed store implementations. Each file is one store (prisma-contact-store.ts, prisma-approval-store.ts, etc.).
- `/crypto/` — Credential encryption (AES-256-GCM). File: credentials.ts.
- `/crypto/__tests__/` — Encryption/decryption tests.
- `/oauth/` — OAuth token management. File: token-refresh.ts (Meta long-lived token refresh with Prisma backend).
- `/seed/` — Database seeding. File: seed-org-day-one-agents.ts (bootstrap Org with default agents).
- `/seed/__tests__/` — Seeding tests.
- `/__tests__/` — DB self-tests: recommendation-store, dashboard-client-surface, seed-org-day-one-agents.

### Key services / public APIs

- `getDb()` — Singleton PrismaClient access point
- Store constructors (e.g., `new PrismaApprovalStore(db)`) — Dependency injection pattern. Each store implements a core interface (ApprovalStore, EnvelopeStore, etc.).
- `encryptCredentials(data, secretKey)` ⟹ encrypted string — AES-256-GCM encryption
- `decryptCredentials(encrypted, secretKey)` ⟹ plaintext object — AES-256-GCM decryption
- `refreshMetaOAuthToken(refreshToken, appId, appSecret)` ⟹ new access token — Meta OAuth re-auth
- `seedOrgDayOneAgents(db, orgId)` — Bootstrap org with default agent personas (Alex, Riley, Mira)

### Tests

- `src/__tests__/*.test.ts` — Store integration tests
- `src/crypto/__tests__/*.test.ts` — Encryption/decryption unit tests
- `src/seed/__tests__/*.test.ts` — Seeding and projection tests
- Mocking convention: Prisma mocked via `jest.mock("@prisma/client")` or in-memory SQLite for integration tests; external OAuth (Meta) mocked in token refresh tests

---

## Conventions (All Packages)

**ESM Only** — Explicit `.js` extensions in relative imports (except Next.js in apps/dashboard). All packages use `"type": "module"` in package.json.

**No `any`, No `console.log`** — Use `unknown` for unsafe types, `console.warn` or `console.error` for logging.

**Prettier Formatting** — Semi-colons, double quotes, 2-space indent, trailing commas, 100-char line width.

**Conventional Commits** — Enforced by commitlint. Examples: `feat(core): add circuit breaker`, `fix(db): resolve prisma connection leak`, `test(schemas): add cartridge type validation`.

**Co-Located Tests** — Every module has `*.test.ts` file in the same directory. Test structure mirrors source: `/src/foo.ts` ⟹ `/src/foo.test.ts`.

**Zod for Runtime Validation** — All schemas are Zod objects. No manual string parsing or type-only interfaces used for user input.

**Barrel Files** — Flagged if >40 exported symbols (e.g., core/src/index.ts has 267 lines; considered technical debt; seams exist for splitting).

**File Size** — Error at 600 lines, warn at 400. Some legacy files (e.g., platform-lifecycle.ts) crossed this; tracked for refactoring.

**Coverage Targets** — Global 55/50/52/55 (statements/branches/lines/functions); core 65/65/70/65.

**Turbo Build** — `pnpm build` rebuilds all packages. Single package: `pnpm --filter @switchboard/core build`. Clean rebuild: `pnpm reset` (clears dist/, regenerates Prisma, rebuilds schemas→core→db chain).

**Type Checking** — `pnpm typecheck` verifies all packages. If missing exports from lower layers (schemas, core, db), run `pnpm reset` first (stale generated artifacts cause false alarms).

---
