# Temporal Entity Memory — SP7 Design

**Date:** 2026-04-17
**Status:** Draft
**Governing sentence:** SP7 gives agents entity-addressable temporal memory so they know what is currently true about an account, campaign, or contact — and what changed.

---

## Problem

Switchboard agents currently have no model of "what is true about this entity right now." The existing memory systems serve different purposes:

- **DeploymentMemory** — operational pattern accumulation (FAQ confidence, objection frequency, learned tendencies). Statistical, deployment-scoped, no temporal supersession.
- **KnowledgeChunk** — vector-searchable knowledge (documents, corrections, learned facts). Similarity-based retrieval, no entity scoping, no versioning.
- **InteractionSummary** — conversation learning records. Contact-scoped summaries, no temporal truth model.

None of these can answer:

- What is the current state of entity X? (campaign config, contact stage, account status)
- When did it change?
- What was it before?
- Where did that information come from?

This affects any agent that operates on real entities over time — ad optimizers, sales closers, nurture agents, revenue trackers. Without temporal entity memory, agents re-recommend outdated actions, reason over stale state, and cannot distinguish "was true" from "is true."

### Which agents need this

Any agent that needs to answer "what is true about this entity right now" is truth-dependent:

| Agent Type                    | Entity Examples   | Truth Examples                                |
| ----------------------------- | ----------------- | --------------------------------------------- |
| Ad optimizer                  | campaign, account | bidding strategy, budget, objective           |
| Sales closer / lead responder | contact, account  | lead stage, preferred channel, last objection |
| Nurture / retention           | contact, account  | cadence status, churn risk, membership state  |
| Revenue tracker               | account, contact  | deal stage, invoice status, booking status    |

Agents doing broad research, document synthesis, or one-off copilot tasks do not need this layer — they benefit from RAG and playbooks instead.

## Design Principles

1. **TemporalFact is not a better DeploymentMemory; it is a different memory primitive with different truth semantics.** DeploymentMemory tracks observed patterns (probabilistic). TemporalFact tracks entity truth (deterministic).
2. **Entity is the address of truth, not metadata.** Facts are entity-scoped, not deployment-scoped with entity tags. Deployment governs access, entity governs identity.
3. **Only structured, attributable inputs write facts.** If it's not structured and attributable, it is not truth. Freeform agent output does not become temporal fact.
4. **Agents consume structured memory lenses, not "search all memory."** The context builder provides distinct retrieval paths: patterns (DeploymentMemory), knowledge (RAG), entity state (TemporalFact).
5. **Newer authoritative fact supersedes older one.** No contradiction tracking in v1 — supersession is the resolution mechanism.

---

## Section 1: Data Model

### Prisma Schema

```prisma
enum FactEntityType {
  account
  campaign
  contact
}

enum FactCategory {
  configuration
  performance
  status
  relationship
  human_assertion
}

enum FactStatus {
  active
  superseded
  retracted
}

enum FactSource {
  system
  agent
  human
  api
}

enum FactValueType {
  string
  number
  boolean
  json
  enum_value
}

model TemporalFact {
  id               String          @id @default(cuid())
  organizationId   String
  deploymentId     String
  entityType       FactEntityType
  entityId         String
  category         FactCategory
  subject          String          // kebab-case key, e.g. "bidding-strategy"
  valueText        String?         // plain text value
  valueJson        Json?           // structured value
  valueType        FactValueType   @default(string)
  status           FactStatus      @default(active)
  confidence       Float           @default(1.0)
  source           FactSource
  sourceDetail     String?         // tool name, user ID, API endpoint
  changeReason     String?         // "api_refresh", "human_correction", "sync_reconciliation"
  supersededById   String?
  validFrom        DateTime
  validUntil       DateTime?       // null = currently valid
  observedAt       DateTime?       // when source observed it (may differ from validFrom and createdAt)
  createdAt        DateTime        @default(now())

  @@unique([organizationId, deploymentId, entityType, entityId, subject, validFrom])
  @@index([organizationId, entityType, entityId, status])
  @@index([organizationId, deploymentId, entityType, status])
  @@index([supersededById])
}
```

### Key Decisions

- **`subject` is the fact's identity over time.** "bidding-strategy" is the thing that changes; `valueText`/`valueJson` is the current value. When a new value arrives for the same subject, the old fact gets `status: superseded` and `validUntil` set.
- **`valueText` + `valueJson` + `valueType`** — supports strings, numbers, booleans, enums, and structured JSON without forcing everything through string parsing.
- **Three timestamps:** `validFrom` (when truth started in the real world), `observedAt` (when the source observed it), `createdAt` (when the DB wrote it). These are often different for delayed syncs and backfills.
- **`source` + `sourceDetail`** — provenance. One system-of-record event beats many fuzzy observations.
- **`confidence`** defaults to 1.0 for `system`/`api`/`human` sources. Different semantics from DeploymentMemory — here it means "how certain are we this is true," not "how many times have we seen this."
- **`supersededById`** — links to the replacement fact, forming a queryable version chain.
- **Entity types for v1:** `account`, `campaign`, `contact` only. No arbitrary entity types.
- **Enums for structural fields** — `entityType`, `category`, `status`, `source`, `valueType` are all enums. Prevents typo-class bugs in core infrastructure.
- **`changeReason`** — lightweight audit trail for why a fact was superseded or retracted.

### Subject Registry

Subjects are kebab-case keys that identify what fact is being tracked. To prevent drift across agents (e.g., `"bidding-strategy"` vs `"bid-strategy"` vs `"biddingStrategy"`), subjects are governed by a central registry — a TypeScript map defining valid subjects per domain.

```typescript
// packages/core/src/memory/subject-registry.ts
interface SubjectDefinition {
  subject: string; // kebab-case
  entityTypes: FactEntityType[]; // which entity types this subject applies to
  valueType: FactValueType;
  description: string;
}

const SUBJECT_REGISTRY: SubjectDefinition[] = [
  // Ads domain
  {
    subject: "bidding-strategy",
    entityTypes: ["campaign"],
    valueType: "enum_value",
    description: "Campaign bidding strategy (manual, CBO, ASC)",
  },
  {
    subject: "daily-budget",
    entityTypes: ["campaign"],
    valueType: "json",
    description: "Daily budget with amount and currency",
  },
  {
    subject: "objective",
    entityTypes: ["campaign", "account"],
    valueType: "enum_value",
    description: "Campaign or account optimization objective",
  },
  // CRM / sales domain
  {
    subject: "lead-stage",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Current stage in sales pipeline",
  },
  {
    subject: "preferred-channel",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Contact's preferred communication channel",
  },
  {
    subject: "booking-status",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Whether contact has a booked appointment",
  },
  // Retention domain
  {
    subject: "subscription-status",
    entityTypes: ["contact", "account"],
    valueType: "enum_value",
    description: "Active, paused, churned",
  },
  {
    subject: "churn-risk",
    entityTypes: ["account"],
    valueType: "enum_value",
    description: "Low, medium, high churn risk assessment",
  },
  // General
  {
    subject: "vertical",
    entityTypes: ["account"],
    valueType: "string",
    description: "Business vertical / industry",
  },
  {
    subject: "optimization-goal",
    entityTypes: ["account"],
    valueType: "enum_value",
    description: "Primary optimization goal (ROAS, CPA, volume)",
  },
];
```

The `recordFact` write path validates `subject` against the registry. Unknown subjects are rejected. New domains register their subjects by adding to the registry — same engine, different subjects.

For v1, the registry is a static TypeScript constant. Later it can become org-configurable or database-backed.

### Write-Path Invariant

For a given `(org, deployment, entityType, entityId, subject)`, at most one row may have `status: active` and `validUntil: null`. Enforced transactionally in the store via `SELECT ... FOR UPDATE`.

---

## Section 2: Store and Write Semantics

### TemporalFactStore Interface

```typescript
interface TemporalFactStore {
  recordFact(fact: RecordFactInput): Promise<TemporalFact>;
  retractFact(id: string, orgId: string, reason: string): Promise<void>;
  getActiveFacts(
    orgId: string,
    deploymentId: string,
    entityType: FactEntityType,
    entityId: string,
  ): Promise<TemporalFact[]>;
  getActiveFactBySubject(
    orgId: string,
    deploymentId: string,
    entityType: FactEntityType,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact | null>;
  getFactHistory(
    orgId: string,
    deploymentId: string,
    entityType: FactEntityType,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact[]>;
  getFactsAsOf(
    orgId: string,
    deploymentId: string,
    entityType: FactEntityType,
    entityId: string,
    asOf: Date,
  ): Promise<TemporalFact[]>;
}
```

### `recordFact()` Transactional Logic

1. `SELECT ... FOR UPDATE` the current active fact for `(org, deployment, entityType, entityId, subject)` where `status = active` and `validUntil IS NULL`
2. If found and value is **canonically identical**: update `observedAt` only, return existing fact. No supersession for redundant observations.
3. If found and value **differs**: set `status = superseded`, `validUntil = now`, `supersededById = newFact.id`, `changeReason` from input
4. Insert new fact with `status = active`, `validFrom` from input (fallback to `now`), `validUntil = null`
5. All in one transaction

### Canonical Equality

Values are normalized before comparison based on `valueType`:

- `string` — trimmed, lowercased
- `number` — parsed to number, compared numerically
- `boolean` — parsed to boolean
- `json` — stable JSON stringify with sorted keys
- `enum_value` — trimmed, lowercased

This prevents fake supersessions from formatting differences (e.g., `"ASC"` vs `"asc"`, `{"amount":100}` vs `{"amount": 100}`).

### `validFrom` Input

`validFrom` is explicit in `RecordFactInput`, not defaulted silently:

- If provided — trust it (system/API/human sources often know when truth started)
- If omitted — fallback to `now`

### Retraction Semantics

`retractFact()` means "we no longer assert any value for this subject." It does not mean "the opposite is true." The result is a null-state — no active fact exists for that subject on that entity.

- Sets `status = retracted`, `validUntil = now`, `changeReason = reason`
- No replacement fact created

### Source Precedence (v1)

A lower-trust source cannot supersede a higher-trust source. Trust order:

```
system > api > human > agent
```

If an `agent`-sourced fact attempts to supersede a `system`-sourced fact, the write is rejected. In v1, `agent` does not write to TemporalFact at all (see Section 4), so this is a structural guarantee.

---

## Section 3: Retrieval Contract

### How Agents Consume Temporal Facts

The context builder provides distinct retrieval paths. No "search all memory."

**Current flow:**

```
build() → retrievedChunks (RAG) + learnedFacts (DeploymentMemory) + recentSummaries
```

**New flow:**

```
build() → retrievedChunks + learnedFacts + recentSummaries + entityFacts
```

### Entity Facts in Agent Context

For each referenced entity, the context builder calls `getActiveFacts()` and formats them as a distinct section:

```
ENTITY STATE (campaign camp_123) — Current known configuration and status:
  bidding-strategy: ASC (since 2026-03-28, source: api)
  daily-budget: {"amount": 500, "currency": "USD"} (since 2026-04-10, source: system)
  objective: conversions (since 2026-01-15, source: human)
```

**What the agent sees:**

- Current values with "since" dates and source attribution
- Category-ordered: configuration > status > performance > relationship > human_assertion
- No confidence scores in prompt (anti-regurgitation policy)
- No superseded facts in default context (history available via tools, not injected)

**Context builder guards:**

- Max **15 facts per entity** (ordered by category priority)
- Max **3 entities per context build** (prioritized: explicitly referenced > conversation state > action parameters)
- Reserved **500-token allocation** for entity facts (does not compete with RAG or DeploymentMemory budgets)
- **Fact header per entity** includes grounding cue: "Current known configuration and status"

### Entity Reference Resolution

The context builder accepts entity refs as input. Three sources in v1:

1. **Explicit in message** — user references a campaign/account/contact ID
2. **Conversation state** — stored in `ConversationThread.agentContext`
3. **Action parameters** — `workUnit.parameters` may contain entity IDs

The context builder does **not** do entity extraction from free text in v1. Entities must be explicitly referenced.

### Memory Type Separation (epistemological clarity)

| Memory Type          | What It Answers                             | Semantics                      |
| -------------------- | ------------------------------------------- | ------------------------------ |
| DeploymentMemory     | "What patterns have we observed?"           | Probabilistic, frequency-based |
| KnowledgeChunk (RAG) | "What does our knowledge base say?"         | Document retrieval             |
| TemporalFact         | "What is true about this entity right now?" | Deterministic, temporal        |

The context builder enforces this separation. Agents receive structured lenses, not blended search results.

---

## Section 4: Write Path

### Core Rule

**Only structured, attributable inputs write temporal facts.** Agent inference does NOT write to TemporalFact in v1. Agent-inferred facts route to DeploymentMemory where they belong.

### Authoritative Write Sources (v1)

| Source                 | `FactSource` | Confidence | When                                   |
| ---------------------- | ------------ | ---------- | -------------------------------------- |
| Platform API sync      | `system`     | 1.0        | Daily campaign config refresh          |
| Human entry via API    | `human`      | 1.0        | Account manager sets entity attributes |
| Structured tool output | `api`        | 1.0        | Tool returns configuration change      |

### Why Agent Inference Is Excluded

Agent-inferred facts are speculative, context-dependent, and sometimes wrong but plausible. Storing them as TemporalFacts would:

- Pollute "current truth" with guesses
- Create false supersessions (agent guess overrides real data)
- Blur the line between pattern and truth

Agent observations belong in DeploymentMemory (probabilistic, reinforcement-based). TemporalFact stays authoritative.

### Write Entry Points (v1)

1. **API route** — `POST /api/orgs/:orgId/entities/:entityType/:entityId/facts` — for human and system writes
2. **Scheduled sync** — external API sync jobs call `recordFact()` with `source: system` (e.g., daily campaign config refresh from ad platform)
3. **Structured tool post-hook** — after tool execution, if the tool returns structured fact claims with `source: api`, they are recorded

### What Does NOT Write Temporal Facts

- Free-form agent conversation summaries
- RAG ingestion
- Unstructured LLM output
- Agent inference of any confidence level (in v1)

### Sync Canonicalization

For `system`/`api` writes from periodic syncs:

- Values are canonicalized before comparison (see Section 2)
- Identical canonical values update `observedAt` only — no version churn
- Non-material formatting differences (JSON key order, whitespace, number precision) do not trigger supersession

---

## Section 5: Wiring, Testing, and Scope

### New Files

| File                                                   | Responsibility                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `packages/schemas/src/temporal-fact.ts`                | Zod schemas for create/update/query inputs                                |
| `packages/db/prisma/schema.prisma`                     | `TemporalFact` model + 5 enums                                            |
| `packages/db/src/stores/prisma-temporal-fact-store.ts` | Store with transactional supersession, `FOR UPDATE`                       |
| `packages/core/src/memory/temporal-fact-service.ts`    | Business logic: canonical equality, source precedence, subject validation |
| `packages/core/src/memory/subject-registry.ts`         | Central subject registry with domain definitions                          |
| `apps/api/src/routes/entity-facts.ts`                  | CRUD API for facts                                                        |

### Modified Files

| File                                            | Change                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/agents/src/memory/context-builder.ts` | Add `entityFacts` retrieval path with reserved token budget, category ordering, per-entity cap, max entities |
| `apps/chat/src/gateway/gateway-bridge.ts`       | Pass entity refs from conversation state to context builder                                                  |
| `apps/api/src/bootstrap/services.ts`            | Wire `TemporalFactStore` into dependency graph                                                               |

### Testing Strategy

| Test                               | Validates                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temporal-fact-store.test.ts`      | Supersession transaction, idempotency (same value = observedAt update only), retraction, history query, as-of query, concurrency (`FOR UPDATE`), source precedence rejection |
| `temporal-fact-service.test.ts`    | Canonical equality (JSON normalization, string trimming, number comparison), write source validation, subject registry validation (unknown subjects rejected)                |
| `context-builder.test.ts` (extend) | Entity facts formatting with header, per-entity cap (15), max entities (3), token budget (500), category ordering                                                            |
| `entity-facts.test.ts`             | API CRUD, org scoping, validation, kebab-case subject enforcement                                                                                                            |

### Proving Milestone

> Given a sequence of state changes over time, the agent avoids re-recommending outdated actions and reasons from the latest valid state by default.

**Test scenario 1 (ad optimizer):** Seed campaign `camp_123` with fact history:

1. `bidding-strategy: manual` (validFrom: Jan 1, superseded)
2. `bidding-strategy: CBO` (validFrom: Feb 15, superseded)
3. `bidding-strategy: ASC` (validFrom: Mar 28, active)

Ask the agent: "What bidding strategy should we use for campaign camp_123?"

Expected: Agent references ASC as current. Does not recommend switching to Manual or CBO.

**Test scenario 2 (sales closer):** Seed contact `contact_456` with fact history:

1. `lead-stage: cold` (validFrom: Mar 1, superseded)
2. `lead-stage: qualified` (validFrom: Mar 20, superseded)
3. `lead-stage: proposal-sent` (validFrom: Apr 5, active)
4. `preferred-channel: whatsapp` (validFrom: Mar 20, active)

Ask the agent: "Should I reach out to contact_456?"

Expected: Agent knows a proposal is already sent (does not re-qualify). Suggests follow-up via WhatsApp (preferred channel), not cold outreach.

**The milestone is met when:** any truth-dependent agent, given entity state from TemporalFact, reasons from current truth and avoids contradicting its own fact history.

### What This SP Does NOT Include

- Agent inference writing to TemporalFact (routes to DeploymentMemory instead)
- Dashboard UI for fact management
- Auto entity extraction from free text
- Cross-deployment fact sharing or visibility
- Entity relationship graph or cross-entity reasoning
- Contradiction detection (supersession only — newer authoritative fact wins)
- Fact importance ranking beyond category ordering
- Knowledge marketplace integration
- Bulk import/export
- Write policy engine (v1 uses source precedence only)

---

## Relationship to Other SPs

- **SP5 (Knowledge/Context Layer)** — curated playbooks/policies/catalogs injected into skills. Different concern: SP5 = "what guidance should this skill follow," SP7 = "what is true about this entity right now." No overlap.
- **SP6 (Skill Runtime Unification)** — completed. SP7's context builder changes integrate with the unified skill runtime.
- **Platform Ingress** — SP7 facts can be written via PlatformIngress-governed tool execution. The `recordFact` call from structured tool post-hooks goes through the governed execution path.
