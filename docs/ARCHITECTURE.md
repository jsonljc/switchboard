# Switchboard — Architecture Reference

> This is the detailed architecture reference extracted from CLAUDE.md. For rules and conventions, see the root `CLAUDE.md`.

## What Is Switchboard?

Switchboard is a **governance-first AI operations platform**. Think of it as the "brain + safety layer" that sits between an AI agent and the real-world actions it wants to take. When an AI (or human) says "pause this ad campaign" or "refund this customer $500", Switchboard doesn't just blindly do it — it evaluates the risk, checks policies, may require human approval, and keeps a tamper-proof record of everything that happened.

The platform is designed for **lead-generation service businesses** (dental clinics, gyms, aesthetic clinics, interior designers, car resellers, etc.) but the architecture is vertical-agnostic. You configure what kind of business you are via a **Skin** (vertical template) and **Business Profile** (your specific business details), and Switchboard adapts its behavior, vocabulary, and tools accordingly.

---

## Package-by-Package Deep Dive

### 1. `packages/schemas` — The Type Foundation

Defines every data type in the system using [Zod](https://zod.dev/) schemas. Zod gives you both TypeScript types AND runtime validation from a single definition. This package has zero internal dependencies — everything else imports from it.

**Key schemas and what they represent:**

| Schema File             | What It Defines                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `principals.ts`         | **Who** is acting — users, AI agents, service accounts, or system. Each has roles: `requester`, `approver`, `operator`, `admin`, `emergency_responder`                                                                                                                                                                                                                                             |
| `action.ts`             | **What** someone wants to do — action type (e.g. `digital-ads.campaign.pause`), parameters, magnitude (dollar amount, entity count), status lifecycle                                                                                                                                                                                                                                              |
| `risk.ts`               | **How dangerous** an action is — risk categories (`none`/`low`/`medium`/`high`/`critical`), reversibility, blast radius, dollars at risk, entity volatility                                                                                                                                                                                                                                        |
| `policy.ts`             | **Rules** that govern actions — conditions with 13 operators (eq, gt, contains, matches, etc.), recursive AND/OR/NOT composition, effects (allow/deny/modify/require_approval)                                                                                                                                                                                                                     |
| `envelope.ts`           | **The full lifecycle record** of a single action — from initial proposal through evaluation, approval, execution, and audit. Contains proposals, decisions, approval requests, execution results, and audit entry references                                                                                                                                                                       |
| `governance-profile.ts` | **Org-level governance posture** — four profiles (`observe`=auto-execute everything, `guarded`=approve high-risk, `strict`=approve most things, `locked`=approve everything)                                                                                                                                                                                                                       |
| `audit.ts`              | **Immutable audit records** — 37 event types, SHA-256 hash-chained entries (like a private blockchain), evidence pointers, PII redaction tracking                                                                                                                                                                                                                                                  |
| `identity.ts`           | **Identity specs** — risk tolerance levels per risk category, spend limits (daily/weekly/monthly/per-action), trusted/forbidden action types, delegation rules, role overlays                                                                                                                                                                                                                      |
| `data-flow.ts`          | **Multi-step plans** — sequences of actions with binding expressions between steps, execution strategies (atomic/sequential/best_effort), and approval modes                                                                                                                                                                                                                                       |
| `skin.ts`               | **Vertical deployment template** — tool filtering (include/exclude/aliases), governance profile, spend limit overrides, language settings (locale, terminology, reply templates, welcome message), playbooks, channel configs, campaign templates                                                                                                                                                  |
| `business-profile.ts`   | **Per-business knowledge** — business info (name, type, address), service catalog with pricing and duration, team members, customer journey stages with conversion benchmarks, lead scoring weights, objection handling trees, cadence templates, compliance flags (HIPAA, consent gate, medical claim filter), operating hours, policies, FAQ records, LLM context (persona, tone, banned topics) |
| `lead-profile.ts`       | **Lead/contact data** — name, email, phone, service interest, source, UTM tracking, lead score, stage, assigned staff                                                                                                                                                                                                                                                                              |
| `cartridge.ts`          | **Cartridge manifest** — ID, name, version, description, required connections, default policies, action definitions with risk categories and parameter schemas                                                                                                                                                                                                                                     |
| `crm-provider.ts`       | **CRM data types** — contacts, deals, activities, pipeline stages                                                                                                                                                                                                                                                                                                                                  |
| `campaign-plan.ts`      | **Campaign planning** — budget allocation, creative strategy, audience targeting                                                                                                                                                                                                                                                                                                                   |
| `ads-operator.ts`       | **Autonomous ads agent config** — per-account settings, scheduling, thresholds                                                                                                                                                                                                                                                                                                                     |
| `revenue-growth.ts`     | **Revenue growth diagnostics** — constraint types, intervention lifecycle, account learning profiles                                                                                                                                                                                                                                                                                               |

**Action Status Lifecycle** (the core state machine):

```
interpreting → resolving → proposed → evaluating → pending_approval → approved → queued → executing → executed
                                                 ↘ denied                                         ↘ failed
```

---

### 2. `packages/cartridge-sdk` — The Plugin Contract

Defines the interface that every cartridge (domain plugin) must implement, plus builder utilities, validation tools, and a test harness.

**The Cartridge Interface** — every cartridge must implement:

| Method              | Purpose                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `initialize()`      | Boot-time setup (connect to APIs, warm caches)                                                                                   |
| `enrichContext()`   | Before execution — fetch relevant external state (contact history, portfolio value, payment history) to inform policy evaluation |
| `execute()`         | Actually do the action (pause campaign, create invoice, book appointment)                                                        |
| `getRiskInput()`    | Compute how risky this specific action is (dollars at risk, blast radius, reversibility)                                         |
| `getGuardrails()`   | Return static guardrail config (rate limits, spend caps, protected entities)                                                     |
| `healthCheck()`     | Verify external API connectivity                                                                                                 |
| `resolveEntity()`   | _(optional)_ Resolve ambiguous entity references ("that campaign" → campaign ID)                                                 |
| `captureSnapshot()` | _(optional)_ Capture pre-mutation state for undo capability                                                                      |

**Key utilities:**

- `ExecuteResultBuilder` — fluent builder for execution results with success/failure/undo recipes
- `ActionBuilder` — fluent builder for defining manifest actions
- `CartridgeTestHarness` — automated test runner that validates manifest completeness, runs all actions, and checks guardrail consistency
- `SERVICE_REGISTRY` — maps service IDs to metadata (e.g., `meta-ads` → Meta Ads Graph API, `stripe` → Stripe Payments)
- `parseParams()` — type-safe parameter extraction with validation error reporting
- `validateManifest()` / `validateCartridge()` — static analysis of manifest correctness

---

### 3. `packages/core` — The Governance Brain

This is the largest and most important package. It contains all governance logic, the orchestrator, and every subsystem that makes Switchboard more than a simple CRUD app.

#### 3a. LifecycleOrchestrator — The Central Coordinator

**File:** `orchestrator/lifecycle.ts`

The `LifecycleOrchestrator` is the main entry point for all governed operations. It's a thin facade that delegates to three specialized managers:

- **ProposePipeline** — handles `propose()`, `resolveAndPropose()`, `simulate()`
- **ApprovalManager** — handles `respondToApproval()`
- **ExecutionManager** — handles `executeApproved()`, `requestUndo()`

**Configuration** (`OrchestratorConfig`): Wires together ~20 subsystems including storage, ledger, guardrails, routing, risk scoring, competence tracking, SMB tier branching, circuit breakers, idempotency guards, credential resolvers, and cross-cartridge enrichment.

#### 3b. ProposePipeline — The Governance Pipeline

**File:** `orchestrator/propose-pipeline.ts`

When someone wants to do something, this pipeline evaluates whether they should be allowed to. The full enterprise flow is a **10-step sequential evaluation**:

1. **Idempotency check** — reject duplicate proposals (same idempotency key)
2. **Telemetry span** — wrap everything in an OpenTelemetry trace
3. **SMB tier branching** — if this is a small business, use the simplified 5-step pipeline instead
4. **Identity resolution** — resolve WHO is asking: merge base identity spec + active role overlays + competence adjustments
5. **Action type restrictions** — check org-level allowlists/blocklists
6. **Cartridge lookup + enrichment** — load the cartridge, fetch external context (contact history, portfolio value, etc.)
7. **Guardrail hydration** — load guardrail state from Redis (rate limit counters, cooldown timestamps)
8. **Policy loading** — load applicable policies (with caching by cartridgeId + orgId)
9. **Policy engine evaluation** — the big 10-step evaluation (see next section)
10. **Decision handling** — route to approval, auto-approve (observe mode/emergency), or deny. Persist envelope + audit entry.

**`resolveAndPropose()`**: Adds entity resolution on top — resolves ambiguous references (e.g., "that campaign") via cartridge `resolveEntity()`, handles clarification questions and not-found cases.

**`simulate()`**: Dry-run evaluation without persistence — returns what the governance decision would be without actually recording anything.

#### 3c. Policy Engine — The Rule Evaluator

**File:** `engine/policy-engine.ts`

The `evaluate()` function runs a **10-step sequential check** on every action:

| Step                     | What It Checks                                                          | Effect                                              |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------- |
| 1. Forbidden behaviors   | Is this action on the principal's "never do" list?                      | Immediate deny                                      |
| 2. Trust behaviors       | Is this action on the principal's "always allow" list?                  | Skip all remaining checks, auto-allow               |
| 3. Competence trust      | Has this principal proven reliable with this action type?               | Informational only (recorded in trace)              |
| 4. Rate limits           | Has the principal exceeded action frequency limits?                     | Deny if exceeded                                    |
| 5. Cooldowns             | Was this entity recently modified? (prevents rapid-fire changes)        | Deny if cooldown active                             |
| 6. Protected entities    | Is the target entity marked as protected?                               | Deny                                                |
| 7. Spend limits          | Has the principal hit per-action, daily, weekly, or monthly spend caps? | Deny if exceeded                                    |
| 8. Policy rules          | Evaluate custom policy rules (sorted by priority). First `deny` wins.   | Deny or flag for approval                           |
| 9. Risk scoring          | Compute 0-100 risk score with composite adjustments                     | Adjusts approval level                              |
| 10. Approval requirement | Determine approval level from identity risk tolerance + system posture  | Allow, require standard/elevated/mandatory approval |

**Default-deny semantics**: If no policy explicitly allows and the action isn't trusted, the default is DENY.

#### 3d. Risk Scorer

**File:** `engine/risk-scorer.ts`

Computes a **0-100 risk score** from multiple factors:

- **Base risk weight**: low=15, medium=35, high=55, critical=80
- **Dollars at risk**: proportional contribution up to $10K threshold
- **Blast radius**: logarithmic scaling for multi-entity impact
- **Irreversibility penalty**: +15 for irreversible, +7.5 for partially reversible
- **Entity volatility penalty**: +8 if entity is unstable
- **Learning phase penalty**: +10 if target is in learning
- **Recently modified penalty**: +5 if cooldown is active

Score maps to categories: 0-20=none, 21-40=low, 41-60=medium, 61-80=high, 81-100=critical.

**Composite Risk Adjustment** — adjusts the base score using behavioral context:

- **Cumulative exposure**: penalty when total dollars at risk across recent actions approaches threshold
- **Action velocity**: penalty when action count exceeds threshold in time window
- **Concentration risk**: penalty for repeatedly targeting the same entity
- **Cross-cartridge risk**: penalty when actions span multiple cartridges (unusual pattern)

#### 3e. Approval System

A complete approval workflow with tamper-evident binding:

| Component            | File                                  | What It Does                                                                                                                                                                                                |
| -------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State Machine**    | `approval/state-machine.ts`           | States: `pending` → `approved`/`rejected`/`expired`/`patched`. Supports **quorum** (multiple approvers required). Optimistic concurrency via version tracking.                                              |
| **Router**           | `approval/router.ts`                  | Determines approval level, approvers, and expiry (mandatory=4h, elevated=12h, standard=24h) from identity config                                                                                            |
| **Binding**          | `approval/binding.ts`                 | SHA-256 hash over envelope ID, version, action, parameters, decision trace. **Timing-safe comparison** prevents timing attacks. Ensures the approval matches exactly what was proposed.                     |
| **Delegation**       | `approval/delegation.ts` + `chain.ts` | BFS graph traversal through delegation rules. Max depth=5, scope narrowing only (each hop can only narrow permissions, never widen), cycle detection, expiration checks. Returns full chain path for audit. |
| **Approval Manager** | `orchestrator/approval-manager.ts`    | Responds to approvals: validates binding hash, checks authorization (SMB=org owner only, Enterprise=delegation chains), prevents self-approval, executes on approve, re-evaluates on patch.                 |

#### 3f. Execution Guard + Execution Manager

**Execution Guard** (`execution-guard.ts`): Wraps every cartridge to prevent direct execution outside the governance pipeline. Uses a token system — `beginExecution()` creates a unique `Symbol`, the wrapped `execute()` checks for it, `endExecution()` removes it. Also runs the **interceptor chain**: `beforeEnrich` → `beforeExecute` (can block) → `afterExecute`.

**Execution Manager** (`orchestrator/execution-manager.ts`): The post-approval execution flow:

1. Load envelope, verify `approved` status
2. Capture pre-mutation snapshot (for undo capability)
3. Execute via `GuardedCartridge` (optionally through circuit breaker)
4. Update envelope status to `executed` or `failed`
5. Update guardrail state (rate limit counts, cooldown timestamps)
6. Record competence outcome (success/failure)
7. Record audit entry

**Undo**: Finds the undo recipe from the execution result, checks the undo window hasn't expired, proposes the reverse action through the full governance pipeline (undo is itself a governed action).

#### 3g. Audit System

A **hash-chained, tamper-evident audit ledger** (like a private blockchain):

| Component                                      | What It Does                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger** (`audit/ledger.ts`)                 | Records entries with SHA-256 hash over canonicalized JSON + `previousEntryHash`. Supports atomic append (PostgreSQL advisory lock for multi-instance). Provides `verifyChain()` and `deepVerify()`. |
| **Canonical JSON** (`audit/canonical-json.ts`) | RFC 8785 JCS deterministic serialization — same data always produces same JSON regardless of key order                                                                                              |
| **Redaction** (`audit/redaction.ts`)           | Automatic PII scrubbing — regex patterns for emails, phones, API tokens, credit cards. Field-path redaction for passwords, secrets, credentials.                                                    |
| **Evidence** (`audit/evidence.ts`)             | Inline evidence (<10KB, hashed) or pointer evidence (>10KB, stored externally). In-memory or filesystem storage with path traversal protection. Integrity verification via hash recomputation.      |

**37 audit event types** covering: action proposed/approved/denied/executed/failed/undone, policy changes, identity changes, approval lifecycle, system events, and more.

#### 3h. Identity System

| Component                                                 | What It Does                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec Resolution** (`identity/spec.ts`)                  | Merges base identity spec with active role overlays. Overlays can be conditional (cartridge filter, risk category filter, time windows with day-of-week + hour range). Two merge modes: `restrict` (take more restrictive) or `extend` (take more permissive). |
| **Governance Presets** (`identity/governance-presets.ts`) | Four profiles: **observe** (everything auto-executes), **guarded** (approve high-risk), **strict** (approve most things), **locked** (approve everything). Maps automation levels: copilot→locked, supervised→guarded, autonomous→observe.                     |
| **Competence** (`competence/`)                            | Tracks per-principal success/failure counts per action type. Competence score decays over time. High-competence principals can earn "trust" for action types, skipping approval.                                                                               |

#### 3i. Data Flow System — Multi-Step Plans

For actions that require multiple steps across cartridges (e.g., "create a contact in CRM, then send them a welcome message, then create a deal"):

| Component                                | What It Does                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Executor** (`data-flow/executor.ts`)   | Executes multi-step plans with three strategies: `sequential` (stop on first failure), `atomic` (same, future rollback support), `best_effort` (continue despite failures) |
| **Resolver** (`data-flow/resolver.ts`)   | Binding expressions for inter-step data flow: `$step[N].result.path`, `$prev.result.path`, `$entity.cartridgeId.entityType`. Supports string interpolation.                |
| **Condition** (`data-flow/condition.ts`) | Step gating: `"$prev.result.success === true"` — only execute this step if the previous one succeeded                                                                      |

#### 3j. Planning — Goal-to-Action

**File:** `planning/goal-parser.ts` (marked `@experimental`)

Converts natural language into structured `GoalBrief` objects using regex patterns:

- "get more leads" → `optimize` intent
- "why is CPA rising" → `investigate` intent
- "pause campaign X" → `execute` intent
- "how are my ads" → `report` intent
- "keep CPA under $50" → `maintain` intent

Extracts constraints, success metrics, and decomposability flags.

#### 3k. SMB Governance — Simplified Pipeline

A streamlined governance path for small businesses:

| Component                                  | What It Does                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pipeline** (`smb/pipeline.ts`)           | 10-step pipeline, but simplified: no identity resolution, no competence tracking, single-approver routing (org owner), activity log instead of full audit ledger. Non-fatal error handling throughout. |
| **Evaluator** (`smb/evaluator.ts`)         | 5-step policy evaluation: allowlist/blocklist → guardrails → spend caps → simple 3-bucket risk → approval mapping. Default-allow for observe/guarded, default-deny for strict/locked.                  |
| **Tier Resolver** (`smb/tier-resolver.ts`) | Resolves org tier (smb vs enterprise). Unknown orgs default to SMB.                                                                                                                                    |
| **Activity Log** (`smb/activity-log.ts`)   | Simplified audit — no hash chain, but includes PII redaction.                                                                                                                                          |

#### 3l. Other Core Systems

| System                         | File(s)                                            | What It Does                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool Registry**              | `tool-registry/index.ts`                           | Manages available tools. Registers all actions from cartridge manifests. Applies skin-based include/exclude/alias filters. Resolves aliases to canonical action types.                                                                            |
| **Skin Loader/Resolver**       | `skin/loader.ts`, `skin/resolver.ts`               | Loads JSON skin manifests from disk, validates with Zod, resolves tool filters, governance profile presets, and spend limit overrides.                                                                                                            |
| **Profile Loader/Resolver**    | `profile/loader.ts`, `profile/resolver.ts`         | Loads JSON business profiles, applies defaults for scoring/compliance/LLM context, builds composite system prompt from business data.                                                                                                             |
| **Capability Registry**        | `capability/registry.ts`                           | Maps action types to rich metadata — executor type (LLM vs deterministic), step type (fetch/compute/decide/approve), cost tier. Auto-populates from manifests using heuristics.                                                                   |
| **Cross-Cartridge Enrichment** | `enrichment/enricher.ts`, `enrichment/mappings.ts` | Resolves entities across cartridges via entity graph (e.g., CRM contact → payments customer). Fetches context from source cartridge with 2-second timeout. Default mappings: customer-engagement↔crm, customer-engagement↔payments, payments↔crm. |
| **Conversion Event Bus**       | `events/conversion-bus.ts`                         | Pub/sub for CRM-to-ads feedback loop. Events: inquiry→qualified→booked→purchased→completed. Bridges customer-engagement events to Meta CAPI.                                                                                                      |
| **Runtime Adapters**           | `runtime-adapters/`                                | Maps different client formats to the governance pipeline: OpenClaw (agent tool calls), MCP (Model Context Protocol), HTTP (REST API).                                                                                                             |
| **Notifications**              | `notifications/notifier.ts`                        | Approval notification interface with CompositeNotifier (fan-out to Telegram, Slack, WhatsApp simultaneously).                                                                                                                                     |
| **Guardrail State**            | `guardrail-state/store.ts`                         | Interface for external rate limit/cooldown persistence (Redis). Batch load/save operations with TTL.                                                                                                                                              |
| **Telemetry**                  | `telemetry/`                                       | OpenTelemetry tracing + Prometheus-compatible metrics. Counters for proposals/denials/executions, histograms for latency. In-memory fallback for testing.                                                                                         |
| **Circuit Breaker**            | `utils/circuit-breaker.ts`                         | Wraps cartridge execution with circuit breaker pattern — trips after consecutive failures, half-opens after cooldown.                                                                                                                             |
| **Idempotency Guard**          | `idempotency/guard.ts`                             | Prevents duplicate proposal processing using idempotency keys.                                                                                                                                                                                    |
| **Governance Profile**         | `governance/profile.ts`                            | Per-org governance profile management with action type allowlists/blocklists. Maps profiles to system risk posture.                                                                                                                               |

---

### 4. `packages/db` — The Data Layer

All database interactions via Prisma ORM, plus credential encryption and OAuth token management.

**Database:** PostgreSQL 16, 30+ models defined in `prisma/schema.prisma`.

**Key store implementations:**

| Store                            | What It Persists                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PrismaEnvelopeStore**          | Action envelope records — the core audit unit. Stores proposals, decisions, approval requests, execution results as JSON arrays. Org ID extracted from proposal parameters.                 |
| **PrismaApprovalStore**          | Approval request state. **Optimistic concurrency** via `expectedVersion` — uses `updateMany` with version check, throws `StaleVersionError` on conflict.                                    |
| **PrismaLedgerStorage**          | Immutable audit ledger. `appendAtomic()` uses **PostgreSQL advisory lock** (`pg_advisory_xact_lock(900001)`) inside a transaction to serialize hash chain writes across multiple instances. |
| **PrismaConnectionStore**        | Service connections (Meta Ads, Stripe, Google Ads, etc.). **All credentials encrypted at rest** using AES-256-GCM. Org-scoped lookups prevent cross-tenant credential leakage.              |
| **PrismaPolicyStore**            | Guardrail policies with optional Redis caching (key pattern: `switchboard:policies:*`, configurable TTL). Cache invalidated on save.                                                        |
| **PrismaIdentityStore**          | Principals, identity specs, and role overlays.                                                                                                                                              |
| **PrismaCompetenceStore**        | Per-principal success/failure tracking per action type.                                                                                                                                     |
| **PrismaCrmProvider**            | Full CRM implementation — contacts (with ad attribution tracking: sourceAdId, sourceCampaignId, UTM), deals, activities, pipeline aggregation. All operations org-scoped.                   |
| **PrismaCadenceStore**           | Automated follow-up cadence instances — tracks current step, step states, evaluation timestamps.                                                                                            |
| **PrismaGovernanceProfileStore** | Per-org governance profile (observe/guarded/strict/locked) with action type restrictions. Default: `guarded`.                                                                               |
| **PrismaTierStore**              | Org tier resolution (smb vs enterprise).                                                                                                                                                    |
| **PrismaSmbActivityLogStorage**  | Simplified audit log for SMB orgs.                                                                                                                                                          |

**Credential Encryption** (`crypto/credentials.ts`):

- AES-256-GCM with scrypt key derivation
- Random 32-byte salt + 16-byte IV per encryption
- Output: base64-encoded packed buffer (`salt + iv + authTag + ciphertext`)
- Master key from `CREDENTIALS_ENCRYPTION_KEY` env var

**OAuth Token Refresh** (`oauth/token-refresh.ts`):

- Meta Graph API v21.0 token exchange
- Long-lived token exchange (60-day expiry)
- Re-encrypts updated credentials on refresh

**Storage Factory** (`storage/factory.ts`): Creates a complete `StorageContext` wiring all Prisma stores together. Cartridge registry is always in-memory (cartridges are code modules, not DB records).

---

## Cartridge Deep Dives

### 5. `cartridges/customer-engagement` — Lead Management & Conversations

Manages the entire customer journey — from first contact through qualification, appointment booking, follow-up, retention, and win-back. This is the primary cartridge for the lead-bot mode.

**16 actions** organized into four agent domains:

| Agent               | Actions                                                       | Lifecycle Stages                       |
| ------------------- | ------------------------------------------------------------- | -------------------------------------- |
| **IntakeAgent**     | `lead.qualify`, `lead.score`, `conversation.handle_objection` | new_lead, qualified                    |
| **SchedulingAgent** | `appointment.book/cancel/reschedule`, `reminder.send`         | consultation_booked, service_scheduled |
| **FollowupAgent**   | `treatment.log`, `review.request/respond`                     | service_completed, repeat_customer     |
| **RetentionAgent**  | `cadence.start/stop`                                          | dormant, lost                          |

Plus direct actions: `pipeline.diagnose`, `contact.score_ltv`, `conversation.escalate`, `journey.update_stage`

**Conversation Engine** — a deterministic finite-state flow engine (not LLM-based):

- Flows consist of typed steps: `message`, `question`, `branch`, `wait`, `action`, `escalate`, `score`, `objection`
- Supports `{{variable}}` template interpolation
- Branch evaluation with operators (eq, gt, contains, in, etc.)
- Pre-built qualification and booking flows
- NLP adapter for intent classification + FAQ direct-answer matching before flow engagement
- Session management (in-memory or Redis, 30-minute timeout)

**Cadence Engine** — automated multi-step outreach scheduler:

- `CadenceDefinition` = steps with delay, action type, conditions, message templates
- `evaluateCadenceStep()` — pure function that evaluates timing and conditions
- Pre-built templates: no-show follow-up, post-service follow-up, review solicitation, dormant customer win-back

**Compliance Interceptors** (conditionally enabled via business profile):

- **HIPAARedactor** — strips PHI fields (SSN, DOB, insurance, medications) from parameters before enrichment
- **MedicalClaimFilter** — blocks unauthorized medical claims in outputs
- **ConsentGate** — enforces consent requirements before communication

**External APIs:**

- Google Calendar (appointments)
- Twilio SMS (reminders, outreach)
- Google Business Reviews (review management)
- All have mock providers for testing

---

### 6. `cartridges/digital-ads` — Multi-Platform Ad Management

The most feature-rich cartridge. Manages digital advertising across Meta, Google, and TikTok — from campaign creation through optimization, creative management, audience building, and performance analysis.

**60+ actions** organized across 10 manifest fragments:

| Category        | Key Actions                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Core**        | `platform.connect`, `funnel.diagnose`, `portfolio.diagnose`, `snapshot.fetch`, `structure.analyze`, `health.check` |
| **Mutations**   | Campaign/adset/ad `pause`/`resume`/`create`, `adjust_budget`, `targeting.modify`, `guided_setup`                   |
| **Reporting**   | Performance reports, creative reports, signal health checks                                                        |
| **Audiences**   | Custom audience builder, lookalike builder, audience insights                                                      |
| **Budget**      | Budget allocation, bid strategy, dayparting, optimization loop                                                     |
| **Creative**    | Creative analysis, rotation, copy generation, asset management, testing queue                                      |
| **Experiments** | A/B testing (Meta Studies), rules management, strategy engine, media planner                                       |
| **Compliance**  | Review checker, compliance auditor, publisher blocklist, lift studies, attribution                                 |
| **Pacing**      | Flight management, pacing monitor, anomaly detection, budget forecaster, scenario modeler, diminishing returns     |
| **Memory**      | Account memory, geo experiments, custom KPIs, seasonal calendar, notifications                                     |

**Funnel Analysis Engine** — the core diagnostic system:

1. Walk funnel stages, compute period-over-period changes
2. Statistical significance tests (chi-squared, proportion tests, Wilson score intervals)
3. Pluggable `FindingAdvisor` system — detects creative fatigue, auction competition, landing page issues
4. Economic impact estimation with elasticity ranking
5. Seasonal adjustment via `SeasonalCalendar`

**Multi-Platform Orchestrator:**

- Runs diagnostics across all connected platforms simultaneously
- Cross-platform correlation (synchronized drops, budget imbalance detection)
- Portfolio-level budget reallocation recommendations
- LLM-generated executive summaries

**External APIs:**

- **Meta Graph API v21.0** — ad account insights, campaigns, ad sets, ads (read + write)
- **Google Ads API** — campaign management via REST
- **TikTok Ads API** — ad management

---

### 7. `cartridges/crm` — Contact & Deal Management

Manages contacts, deals, activities, and pipeline health. Designed to be the single source of truth for customer relationships.

**10 actions:**

| Action              | Risk | Description                                        |
| ------------------- | ---- | -------------------------------------------------- |
| `contact.search`    | none | Search by name/email/company                       |
| `contact.create`    | low  | Create contact (undo available)                    |
| `contact.update`    | low  | Update contact (pre-mutation snapshot for undo)    |
| `deal.list`         | none | List deals with filters                            |
| `deal.create`       | low  | Create deal (undo available)                       |
| `activity.list`     | none | List activities                                    |
| `activity.log`      | low  | Log activity (irreversible)                        |
| `pipeline.status`   | none | Pipeline overview with deal counts/values          |
| `pipeline.diagnose` | none | Pipeline velocity, conversion rates, stalled deals |
| `activity.analyze`  | none | Dormant contacts, overdue follow-ups               |

**Context Enrichment:** Auto-fetches contact details, deal history, activity count, and last interaction date when `contactId` is present in parameters.

**Diagnostic Advisors:**

- `PipelineHealthAdvisor` — velocity analysis, conversion rates, stalled deal detection, concentration risk
- `ActivityCadenceAdvisor` — dormant contact identification, overdue follow-up detection, unengaged lead flagging

---

### 8. `cartridges/payments` — Stripe-Backed Payments

Manages invoices, charges, refunds, subscriptions, and payment links through Stripe.

**10 actions** with carefully calibrated risk levels:

| Action                | Risk         | Why This Risk Level                    |
| --------------------- | ------------ | -------------------------------------- |
| `invoice.create`      | low          | Doesn't collect money immediately      |
| `invoice.void`        | low          | Only affects open invoices             |
| `charge.create`       | **high**     | Directly charges a payment method      |
| `refund.create`       | **critical** | Irreversible money outflow             |
| `subscription.cancel` | **high**     | Revenue loss, potentially irreversible |
| `subscription.modify` | medium       | Changes recurring billing              |
| `link.create`         | low          | Customer must still click to pay       |
| `link.deactivate`     | low          | Prevents future payments on that link  |
| `credit.apply`        | medium       | Affects customer balance               |
| `batch.invoice`       | **high**     | Mass invoice creation                  |

**Fail-Closed Enrichment:** If Stripe API is unreachable during enrichment, returns worst-case values (`hasOpenDispute: true`, `refundRate: 1`, `previousRefundCount: Infinity`) to ensure deny/escalation policies fire rather than allowing risky actions through.

---

### 9. `cartridges/revenue-growth` — Autonomous Revenue Optimization

Implements a **Theory of Constraints-inspired cyclic diagnostic loop** that continuously identifies and addresses the single biggest bottleneck to revenue growth.

**The Diagnostic Cycle:**

```
Data Collection → 5 Scorers → Constraint Engine → Action Engine → Intervention → Monitoring → Learning
       ↑                                                                                          |
       └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**5 Scorers** (each returns 0-100):

1. `scoreSignalHealth` — tracking pixel/CAPI quality
2. `scoreCreativeDepth` — creative portfolio diversity, fatigue detection
3. `scoreFunnelLeakage` — funnel drop-off analysis
4. `scoreHeadroom` — spend saturation / expansion opportunity
5. `scoreSalesProcess` — CRM follow-up velocity, lead-to-deal match rates

**Constraint Priority:** SIGNAL > CREATIVE > FUNNEL > SALES > SATURATION

The lowest-scoring constraint that falls below its threshold becomes the "binding constraint". The system generates a single intervention to address it (e.g., `FIX_TRACKING`, `REFRESH_CREATIVE`, `OPTIMIZE_FUNNEL`).

**Intervention Lifecycle:** proposed → approved → executing → monitoring → completed/escalated

**Creative Pipeline:** Gap analysis → strategy generation → image generation (OpenAI DALL-E) → ad review checking → campaign deployment

**Autonomous Agent** (`RevenueGrowthAgent`): Runs the full cycle periodically per account — diagnose, check past intervention outcomes, monitor for anomalies, update learning profile, generate weekly digests.

---

### 10. `cartridges/quant-trading` — Trading Operations

Stock and crypto trading with governance guardrails. All market orders are critical risk (irreversible), limit orders are high risk (cancellable before fill).

**8 actions:** market buy/sell, limit buy/sell, cancel order, close position, rebalance portfolio, set stop loss

**Risk Computation:** `quantity * currentPrice` against portfolio percentage. Market orders compute real-time dollars at risk. Limit orders use limit price. Close position uses market value.

**External API:** `TradingProvider` interface with mock provider seeded with portfolio data (AAPL, GOOGL, TSLA, $100K portfolio, $50K cash).

---

## Application Deep Dives

### 11. `apps/api` — The REST API Server

The authoritative governance spine. All actions flow through the `LifecycleOrchestrator`. Built on Fastify.

**Boot Sequence** (`app.ts`):

1. Fastify config (1MB body limit, Helmet security headers, CORS, rate limiting, Swagger/OpenAPI)
2. Storage bootstrap (Prisma or in-memory fallback)
3. System identity creation (upserts `system` principal + default identity spec)
4. Credential resolution for cartridges
5. Cartridge registration (5 cartridges: digital-ads, payments, CRM, customer-engagement, revenue-growth)
6. Business profile resolution
7. Skin loading + tool registry + governance profile
8. ConversionBus wiring (CRM→ads feedback loop)
9. Execution queue (BullMQ with Redis, or inline)
10. Approval notifiers (Telegram, Slack, WhatsApp — CompositeNotifier)
11. LifecycleOrchestrator construction
12. 10+ background jobs (approval expiry, chain verification, diagnostics, token refresh, cadence runner, agent runner, etc.)

**27 route modules:**

| Route                             | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `POST /api/actions/propose`       | Submit an action proposal through the governance pipeline         |
| `POST /api/execute`               | One-shot propose+execute (requires Idempotency-Key header)        |
| `POST /api/approvals/:id/respond` | Respond to pending approval (approve/reject/patch)                |
| `GET /api/approvals/pending`      | List pending approvals (org-scoped)                               |
| `CRUD /api/policies`              | Manage guardrail policies                                         |
| `GET /api/audit`                  | Query audit trail                                                 |
| `CRUD /api/connections`           | Manage service connections (credentials always encrypted at rest) |
| `CRUD /api/organizations`         | Org config, channels, handoff                                     |
| `POST /api/simulate`              | Dry-run policy evaluation                                         |
| `CRUD /api/identity`              | Principal and identity spec management                            |
| `/api/crm/*`                      | CRM operations                                                    |
| `/api/campaigns/*`                | Campaign management                                               |
| `/api/smb/*`                      | SMB tier and activity                                             |
| `/api/governance/*`               | Governance profile management                                     |
| `/api/agents/*`                   | Agent roster management                                           |
| `/api/revenue-growth/*`           | Revenue growth analysis                                           |
| `GET /health`                     | Database + Redis connectivity check                               |
| `GET /metrics`                    | Prometheus metrics                                                |

**Security:**

- Bearer token auth with SHA-256 hashing, timing-safe comparison
- DB fallback for dashboard-generated API keys
- SIGHUP hot-reload for API keys
- Idempotency middleware (Redis or in-memory, 5-minute TTL)
- Trace ID propagation via `X-Request-Id` header

---

### 12. `apps/chat` — Multi-Channel Chat Server

Processes messages from Telegram, WhatsApp, and Slack. Can operate in two modes: **operator mode** (business owner manages operations via chat) or **lead bot mode** (engages prospective customers through qualification/booking flows).

**Architecture:**

- **Single-tenant webhook:** `POST /webhook/telegram` for direct Telegram bot
- **Multi-tenant managed channels:** `POST /webhook/managed/:webhookId` for dynamically provisioned WhatsApp/Slack channels per organization
- **RuntimeRegistry:** Maps webhook paths to per-org `ChatRuntime` instances loaded from database at startup

**ChatRuntime** — the core message processing engine:

1. Parse raw payload via channel adapter
2. Resolve organization from principal
3. Get or create conversation thread
4. Handle consent keywords (opt-out/opt-in)
5. Lead bot mode: route through `ConversationRouter`
6. Record user message to conversation history
7. Skip if `human_override` status
8. Handle commands (help, cockpit, callbacks)
9. Interpret message → governance pipeline → execute

**Channel Adapters:**

| Adapter      | Rate Limit              | Signature Verification                                          | Special Features                                                                                                    |
| ------------ | ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Telegram** | 30 msg/sec token bucket | `X-Telegram-Bot-Api-Secret-Token` (timing-safe)                 | Deep link parsing for ad attribution (`/start ad_{adId}_{campaignId}`), retry with exponential backoff              |
| **WhatsApp** | 80 msg/sec token bucket | HMAC-SHA256 via `X-Hub-Signature-256`                           | Template messages for 24h window enforcement, referral data from Meta Lead Ads (click-to-WhatsApp), Graph API v21.0 |
| **Slack**    | ~1 msg/sec (Tier 1)     | HMAC-SHA256 (`v0:timestamp:body`), anti-replay (5-minute drift) | Block-based approval cards, URL verification challenge handling                                                     |

**Safety Features:**

- Banned phrase filter (from skin config) on all outgoing messages
- Medical claim validation (blocks medical claims in responses)
- WhatsApp 24-hour window enforcement (falls back to template messages)
- Per-principal proposal rate limiting (30/minute)
- Response humanizer (applies skin terminology substitutions)

**Bootstrap modes:**

- **Standalone:** Builds local `LifecycleOrchestrator` with full governance pipeline
- **API-delegated:** Uses `ApiOrchestratorAdapter` to send all governance decisions to the API server
- **Managed:** Lightweight runtime per org/channel, delegates to API

---

### 13. `apps/dashboard` — Admin Dashboard

Next.js 15 App Router application for configuring the AI assistant and monitoring operations.

**Current Features:**

- **Identity configuration page:** Set assistant name, role focus, working style, tone, autonomy level, focus areas, and task scope
- **Visual operator character** that reflects the configuration
- Settings persisted to localStorage + synced across tabs

**Tech Stack:** Radix UI components, Recharts for visualization, React Hook Form + Zod validation, NextAuth for auth, bcryptjs for password hashing, Tailwind CSS.

---

### 14. `apps/mcp-server` — Model Context Protocol Server

Exposes Switchboard capabilities as MCP tools for integration with LLM assistants (Claude, ChatGPT, etc.).

**Two modes:**

- **API mode:** Delegates to Switchboard API via `McpApiClient` (production)
- **In-memory mode:** Local orchestrator for dev/testing

**Tool Registration:**

- Auto-registers tools from cartridge manifests (filtered by skin)
- Manual tool definitions for governance, CRM, and payments operations
- Categories: `SIDE_EFFECT_TOOLS`, `READ_TOOLS`, `GOVERNANCE_TOOLS`, `CRM_*`, `PAYMENTS_*`

**Safety Features:**

- Session guard (rate limiting, mutation count limits)
- Forced escalation when mutation threshold exceeded (injects `_forceApproval`)
- Error sanitization (strips SQL, stack traces, IPs, connection strings, Prisma references)
- Auto-generated idempotency keys from SHA-256(actorId + actionType + args)

**Transport:** StdioServerTransport (stdin/stdout for MCP protocol)

---

## Infrastructure & CI/CD

### Docker

Multi-stage Dockerfile with 4 production targets:

- `api` — Fastify API server (port 3000)
- `chat` — Chat server (port 3001)
- `dashboard` — Next.js standalone (port 3002)
- `mcp-server` — MCP server (stdio)

All run as `USER node` (non-root) with `NODE_ENV=production`.

### Turbo

Build orchestration with dependency-aware task scheduling. Global env awareness for `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `SKIN_ID`, `PROFILE_ID`.

---

## Skins & Profiles — The Customization System

### Skins (Vertical Templates)

| Skin       | Cartridges                                      | Governance | Key Features                                                             |
| ---------- | ----------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `clinic`   | customer-engagement, digital-ads, crm, payments | guarded    | HIPAA compliance, consent gate, medical claim filter, dental terminology |
| `gym`      | customer-engagement, digital-ads, crm           | guarded    | Fitness terminology, class booking flows, trial/membership focus         |
| `generic`  | customer-engagement, digital-ads, crm           | guarded    | Neutral terminology, general service business                            |
| `commerce` | digital-ads, crm, payments                      | guarded    | E-commerce focus, transaction-oriented                                   |

Each skin controls: tool filtering (which actions are available), governance profile, spend limit overrides, language settings (locale, interpreter prompt, reply templates, terminology, welcome message), playbooks, channel configs, campaign templates, funnel mode, and conversion value mapping.

### Business Profiles (Per-Instance Knowledge)

| Profile       | Business            | Key Data                                                                                                                                                                                 |
| ------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clinic-demo` | Bright Smile Dental | 11 dental services with pricing, 4 team members, 9 journey stages with conversion benchmarks, lead scoring weights, 30 FAQ records, HIPAA compliance, objection trees, cadence templates |
| `gym-demo`    | FitLife Gym         | 8 fitness services, 3 team members, membership-focused journey, trial conversion tracking                                                                                                |
