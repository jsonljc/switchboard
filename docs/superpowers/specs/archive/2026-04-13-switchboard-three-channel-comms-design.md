# Switchboard Three-Channel Agent Communication — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Goal:** Define three isolated communication channels (Customer Agent, Owner Surface, Runtime Worker) with scoped privacy enforcement, tiered notifications, and FAQ draft lifecycle. Production-ready architecture that extends existing code rather than duplicating it.
**Predecessor:** `docs/superpowers/specs/2026-04-12-switchboard-governance-rebalance-design.md` (governance simplification + memory foundation)
**Supersedes:** Predecessor's Phase 2 FAQ auto-builder design (item 1) — this spec adds an owner review gate before FAQ answers reach customers. Predecessor's trust levels (`observe/guarded/strict/locked`) are simplified to `observe/guarded/autonomous` — `strict` and `locked` collapse into `guarded`; `autonomous` replaces the implicit full-trust state.

**Type conventions:** `DeploymentMemoryEntry` is the TypeScript DTO type mapped from the `DeploymentMemory` Prisma model, with internal fields (like `updatedAt`) stripped. Similarly, `InteractionSummary` refers to the DTO, `InteractionSummary` (Prisma) to the model.

---

## 1. Problem

Switchboard currently has one communication path: the customer agent in `apps/chat/` handles all conversations through the `ChannelGateway`. The owner interacts only through `apps/api/` CRUD routes and `apps/dashboard/`. The compounding loop in `packages/agents/` runs inline. There is no:

- **Privacy boundary** between what the customer agent can see and what the owner can see
- **Notification system** that proactively surfaces important events to the owner
- **Separate runtime process** for background work (compounding, decay, consolidation)
- **Activity log** showing what the agent learned or forgot autonomously
- **FAQ draft review** before auto-generated answers reach customers
- **Trust-graduated notification behavior** where the agent earns the right to interrupt less as trust grows

Meta's BizAI platform — serving 45K businesses, 370K daily conversations — validates this three-channel separation at scale. A1 Commerce (customer-facing), MAIBA (owner-facing), and BizClaw (aggregate runtime) are separate services with separate configs, separate tool registries, and separate data access scopes. They started separate, not combined.

### The Imbalance

| Capability                    | Current State                             | Customer Value                                   |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Customer ↔ Agent conversation | Built (ChannelGateway, AgentRuntime)      | Core product                                     |
| Owner memory CRUD             | Built (deployment-memory routes)          | Medium                                           |
| Compounding loop              | Built (CompoundingService)                | High — but runs inline, no isolation             |
| Privacy scoping               | Not built — all stores have full access   | High — owner trust requires it                   |
| Owner notifications           | ProactiveSender exists, no classification | High — owner needs to know what matters          |
| Activity log                  | Not built                                 | Medium — transparency builds trust               |
| FAQ draft review              | Not built                                 | High — prevents wrong answers reaching customers |
| Event bus (chat → runtime)    | Not built                                 | Required for runtime worker isolation            |

---

## 2. Architecture Overview

Three channels, mapped to existing + one new process:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLIENT SURFACES                                  │
│   Telegram │ WhatsApp │ Web Widget        Dashboard │ Notification Push   │
│   ─────────────────────────────────       ───────────────────────────────  │
│        Customer channels                      Owner channels              │
└──────┬──────────┬──────────┬──────────────────┬──────────┬───────────────┘
       │          │          │                  │          │
       ▼          ▼          ▼                  ▼          ▼
┌──────────────────────────────┐    ┌───────────────────────────────────┐
│     CUSTOMER AGENT           │    │         OWNER SURFACE             │
│     apps/chat/ (existing)    │    │  apps/api/ + apps/dashboard/      │
│                              │    │         (existing, extended)       │
│ • CustomerScopedMemoryAccess │    │                                   │
│ • Constrained tool registry  │    │ • Full deployment memory CRUD     │
│ • Governed actions via       │    │ • Notification tier dispatcher    │
│   existing approval flow     │    │ • Activity log viewer             │
│ • Emits conversation-end     │    │ • FAQ draft review queue          │
│   events to event bus        │    │ • Trust level configuration       │
│                              │    │ • ProactiveSender (T1/T2/T3)     │
└──────────────┬───────────────┘    └──────────────┬────────────────────┘
               │                                   │
               │       SHARED PACKAGES             │
               │  ┌──────────────────────────┐     │
               ├─▶│ packages/core             │◀───┤
               ├─▶│ packages/db               │◀───┤
               ├─▶│ packages/agents           │◀───┤
               │  │ packages/schemas          │    │
               │  └──────────────────────────┘     │
               │                                   │
               │  ┌──────────────────────────┐     │
               └─▶│   RUNTIME WORKER         │◀───┘
                  │   apps/runtime/ (NEW)     │
                  │                           │
                  │ • Headless — no HTTP      │
                  │ • Polls AgentEvent table  │
                  │ • Runs CompoundingService │
                  │ • Writes ActivityLog      │
                  │ • FAQ draft promotion     │
                  │ • Nightly: decay +        │
                  │   consolidation           │
                  │ • Cheaper/faster LLM      │
                  │ • AggregateScopedAccess   │
                  └──────────────────────────┘
```

**Design principles:**

- No new `apps/owner/` — owner surface is `apps/api` + `apps/dashboard` + `ProactiveSender`, all existing
- `apps/runtime/` is a thin worker (~300 lines), not a Fastify app
- Privacy enforced via scoped store interfaces (TypeScript compiler), not process isolation
- Event bus is a database table + poller, not Kafka/Redis
- DOCTRINE compliance: execution sovereignty, blind agents, sealed approvals, audit non-optional

---

## 3. Privacy Architecture — Scoped Store Interfaces

Each channel gets a store adapter that limits what data it can access. The full store exists in `packages/db` for migrations and tests. Each app instantiates only the scoped interface it needs.

### 3.1 Three Scoped Interfaces

**CustomerScopedMemoryAccess** (used by `apps/chat/`):

```typescript
interface CustomerScopedMemoryAccess {
  getBusinessKnowledge(
    orgId: string,
    deploymentId: string,
    query: string,
  ): Promise<KnowledgeChunk[]>;
  getHighConfidenceFacts(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]>;
  getContactSummaries(
    orgId: string,
    deploymentId: string,
    contactId: string,
  ): Promise<InteractionSummary[]>;
}
```

- Reads only: current contact summaries + business knowledge + high-confidence facts
- No `listAllMemories()`, no `listAllSummaries()`, no write access
- `getBusinessKnowledge()` filters `draftStatus = 'approved' OR draftStatus IS NULL`
- `getHighConfidenceFacts()` filters `WHERE sourceCount >= 3 AND confidence >= 0.7` (from predecessor spec Section 3.4) and strips `sourceCount` and `confidence` from results — customer agent sees the fact, not the metadata

**OwnerMemoryAccess** (used by `apps/api/` + `apps/dashboard/`):

```typescript
interface OwnerMemoryAccess {
  listAllMemories(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]>;
  correctMemory(id: string, content: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  listDraftFAQs(orgId: string, deploymentId: string): Promise<DraftFAQ[]>;
  // DraftFAQ = Pick<KnowledgeChunk, 'id' | 'content' | 'sourceType' | 'draftStatus' | 'draftExpiresAt' | 'createdAt'>
  approveDraftFAQ(id: string): Promise<void>;
  rejectDraftFAQ(id: string): Promise<void>; // deletes the draft KnowledgeChunk
  listActivityLog(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<ActivityLogEntry[]>;
  listAllSummaries(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<InteractionSummary[]>;
}
```

- Full visibility and control over all deployment data
- Can correct, delete, and review draft FAQs
- This is the "business owns their memory" principle from BizAI

**AggregateScopedMemoryAccess** (used by `apps/runtime/`):

```typescript
interface AggregateScopedMemoryAccess {
  upsertFact(
    entry: Omit<DeploymentMemoryEntry, "id" | "createdAt">,
  ): Promise<DeploymentMemoryEntry>;
  writeSummary(entry: Omit<InteractionSummary, "id" | "createdAt">): Promise<void>;
  writeActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<void>;
  findFactsByCategory(
    orgId: string,
    deploymentId: string,
    category: string,
  ): Promise<DeploymentMemoryEntry[]>;
  promoteDraftFAQs(olderThan: Date): Promise<number>;
  decayStale(cutoffDate: Date, decayAmount: number): Promise<number>;
}
```

- Write summaries but can't read them back (no individual conversation data)
- Read/write facts by category (aggregate patterns only)
- No `contactId` access, no conversation content

### 3.2 Anti-Regurgitation

- Customer agent never sees how many conversations confirmed a fact
- Runtime worker processes contact identifiers transiently during summarization but cannot retrieve them afterward via its scoped interface
- Activity log entries use aggregate language ("Learned: busiest day is Tuesday") not individual references ("Sarah said Tuesday is busy")

### 3.3 Implementation

Scoped interfaces live in `packages/core/src/memory/scoped-stores.ts`. Implementations in `packages/db/` wrap the full Prisma stores with access restrictions. Each app instantiates only its scoped adapter at bootstrap.

**Naming convention:** Prisma models use `organizationId` (source of truth). TypeScript interface parameters abbreviate to `orgId` for ergonomics. Store implementations map between the two.

---

## 4. Notification Tier System

### 4.1 Three Tiers

| Tier             | Trigger                                                                     | Delivery                                        | Owner Action             |
| ---------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| **T1 — Act Now** | Pending approval, failed action, angry customer escalation, revenue event   | Push immediately via ProactiveSender            | Required                 |
| **T2 — Confirm** | New fact crosses threshold, draft FAQ ready, agent contradicted by customer | Batched push (max 3 batched notifications/hour) | Optional — auto-resolves |
| **T3 — FYI**     | Weekly summary, milestone, performance stats                                | Dashboard only, optional daily digest           | None                     |

### 4.2 Components

**NotificationClassifier** (~100 lines in `packages/core/src/notifications/notification-classifier.ts`):

- Input: event type + metadata
- Output: T1, T2, or T3
- Pure function, no side effects, easily testable

**NotificationBatcher** (~80 lines in `packages/core/src/notifications/notification-batcher.ts`):

- Accumulates T2 events per deployment
- Flushes every 20 minutes or when 3 events accumulated (whichever comes first) — each flush produces one batched notification message containing all accumulated events, so max 3 batched pushes per hour
- Delivers via existing `ProactiveSender.sendProactive()`

### 4.3 Trust Graduation × Notifications

Trust level is a field on the `Deployment` model, set by the owner via dashboard. It is derived from the numeric trust score (existing `trust-score-engine.ts`): `observe` (score 0-30), `guarded` (score 31-70), `autonomous` (score 71+). The owner can manually override to a lower trust level but not a higher one than the score supports.

| Trust Level  | T1 Triggers                                                                                                          | T2 Triggers                  | FAQ Auto-Publish               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------ |
| `observe`    | All actions need approval                                                                                            | All learned facts            | Blocked — owner must approve   |
| `guarded`    | High-risk only (spend, booking, cancellation)                                                                        | Facts above threshold        | 72h timeout, then auto-publish |
| `autonomous` | Ad publishing + spend above configurable threshold (per-deployment `spendApprovalThreshold` field, default $50) only | Nothing — facts auto-confirm | 24h timeout                    |

### 4.4 Ad Publishing Hard Gate

Ad publishing requires T1 approval **regardless of trust level**. Encoded as `requiresManualApproval: true` on the tool definition. Checked as Step 0 in the policy engine, before all other steps. Cannot be overridden by trust score progression.

Policy engine flow becomes:

1. Step 0: `if (tool.requiresManualApproval) → require approval` (skip remaining steps)
2. Step 1: Forbidden behaviors → deny
3. Step 2: Spend limits → deny if exceeded
4. Step 3: Policy rules (4 operators) → deny or flag
5. Step 4: Risk-based approval → allow or require approval based on trust level

---

## 5. Event Bus

### 5.1 Design

A database table and a polling loop. No Kafka, no Redis. At zero customers, infrastructure should be boring.

**New Prisma model:**

```prisma
model AgentEvent {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  eventType       String   // conversation_end (currently the only emitted type; others may be added as the system evolves)
  payload         Json
  status          String   @default("pending")  // pending, processing, done, failed, dead_letter
  retryCount      Int      @default(0)
  createdAt       DateTime @default(now())
  processedAt     DateTime?

  @@index([status, createdAt])
  @@index([organizationId, deploymentId])
}
```

### 5.2 Chat Side (Emitter)

In `ChannelGateway.handleIncoming()`, after the conversation response is sent, if the conversation is ending:

```typescript
await this.config.eventStore.emit({
  organizationId: info.deployment.organizationId,
  deploymentId: info.deployment.id,
  eventType: "conversation_end",
  payload: { messages, channelType: message.channel, contactId: message.visitor?.name },
});
```

One line change. The `eventStore` is injected via the existing `ChannelGatewayConfig`.

**Conversation end detection:** The `conversation_end` event is emitted when the existing conversation state machine (in `apps/chat/src/conversation/state.ts`) transitions to `complete` — triggered by inactivity timeout (configurable, default 30 minutes) or explicit agent farewell classification.

**Privacy note on event payload:** The `contactId` is included in the event payload because the `CompoundingService` needs it to write the `InteractionSummary.contactId` field (enabling repeat-customer lookups via `CustomerScopedMemoryAccess.getContactSummaries()`). The runtime worker processes contact identifiers transiently during summarization but cannot retrieve them afterward — `AggregateScopedMemoryAccess` has no read methods that return contact data.

### 5.3 Runtime Side (Consumer)

The runtime worker polls every 30 seconds, processes pending events sequentially, marks them done or failed. See Section 8 for the complete worker implementation.

### 5.4 Cleanup

`status = "done"` events older than 7 days deleted by nightly job. Failed events stay for manual review. Events with `retryCount >= 3` are marked `dead_letter` and excluded from processing.

### 5.5 Why a Table

- Zero new infrastructure (already have Prisma + PostgreSQL)
- Events are auditable (DOCTRINE principle #7)
- Failed events persist for retry
- Scales to 1,000+ conversations/day without issues
- Interface stays the same if you swap to a real queue later

---

## 6. Activity Log

### 6.1 Model

```prisma
model ActivityLog {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  eventType       String   // fact_learned, fact_decayed, faq_drafted, faq_promoted,
                           // summary_created, correction_applied, memory_deleted,
                           // consolidation_run
  description     String   // Human-readable
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())

  @@index([organizationId, deploymentId])
  @@index([createdAt])
}
```

### 6.2 Writers

| Writer                       | Event Types                            |
| ---------------------------- | -------------------------------------- |
| Runtime Worker (compounding) | `fact_learned`, `summary_created`      |
| Runtime Worker (nightly)     | `fact_decayed`, `consolidation_run`    |
| Runtime Worker (FAQ)         | `faq_drafted`, `faq_promoted`          |
| Owner API (corrections)      | `correction_applied`, `memory_deleted` |

### 6.3 Readers

- `apps/api` — `GET /api/:orgId/deployments/:deploymentId/activity` endpoint
- `apps/dashboard` — activity feed page
- Notification system — T3 daily digest pulls from this table

### 6.4 Privacy

No individual customer data in activity log entries. The runtime worker that writes these entries uses `AggregateScopedMemoryAccess` which has no access to contact identifiers.

### 6.5 Retention

90 days, cleaned up by nightly job.

---

## 7. FAQ Draft Lifecycle

### 7.1 Trigger

Runtime worker detects the same question asked 3+ times with no satisfactory answer in business knowledge. Generates a draft answer using existing business context.

### 7.2 Storage

Two nullable fields on existing `KnowledgeChunk`:

```prisma
model KnowledgeChunk {
  // ... existing fields ...
  draftStatus    String?   // null (not a draft), "pending", "approved"
  draftExpiresAt DateTime? // when auto-publish kicks in
}
```

No new models. No new tables.

### 7.3 Lifecycle

```
Question asked 3+ times
  → Runtime generates draft answer
  → KnowledgeChunk created: sourceType="learned", draftStatus="pending", draftExpiresAt=now+72h
  → ActivityLog: "Drafted FAQ: [question]"
  → Notification (T2): "New FAQ draft ready for review"

Owner approves   → draftStatus="approved", available to customer agent immediately
Owner edits      → draftStatus="approved", sourceType="correction" (highest priority, never decays)
Owner ignores    → auto-publishes at draftExpiresAt (trust level dependent)
```

### 7.4 Trust Level × Auto-Publish

| Trust Level  | On owner ignore                                     |
| ------------ | --------------------------------------------------- |
| `observe`    | Draft stays pending forever                         |
| `guarded`    | Auto-publishes at 72h, extra T2 notification at 48h |
| `autonomous` | Auto-publishes at 24h                               |

### 7.5 Customer Agent Filtering

`CustomerScopedMemoryAccess.getBusinessKnowledge()` only returns knowledge chunks where `draftStatus = 'approved' OR draftStatus IS NULL`. One WHERE clause addition.

---

## 8. Runtime Worker

### 8.1 Shape

A single `main.ts` file (~300 lines) in `apps/runtime/src/`. Not a Fastify app. No HTTP endpoints. Runs as a separate Node.js process. The worker orchestrates; heavy lifting (summarization, fact extraction) is delegated to `CompoundingService` in `packages/agents`.

### 8.2 Responsibilities

1. **Event consumer** — polls `AgentEvent` table every 30s, processes `conversation_end` events through `CompoundingService`
2. **Activity logger** — writes to `ActivityLog` after each compounding run
3. **FAQ promoter** — runs on the 30s poll cycle, queries `KnowledgeChunk WHERE draftStatus='pending' AND draftExpiresAt < NOW()`, then checks the deployment's trust level: skips `observe` deployments (drafts stay pending indefinitely), promotes `guarded` and `autonomous` deployments
4. **Nightly jobs** — confidence decay (90d facts, 180d patterns), cleanup of processed events (7d), reset stale "processing" events (>1h) back to "pending" with `retryCount` increment

### 8.3 LLM

Uses a cheaper/faster LLM than the customer agent. The compounding loop's extraction prompt doesn't need the same quality as customer-facing responses.

### 8.4 Memory Access

Instantiates only `AggregateScopedMemoryAccess`. Cannot read individual conversations or contact identifiers.

---

## 9. Changes to Existing Code

### 9.1 New Prisma Models (2)

| Model         | Fields                                                                      | Purpose                |
| ------------- | --------------------------------------------------------------------------- | ---------------------- |
| `AgentEvent`  | id, orgId, deploymentId, eventType, payload, status, createdAt, processedAt | Event bus              |
| `ActivityLog` | id, orgId, deploymentId, eventType, description, metadata, createdAt        | Runtime activity diary |

### 9.2 New Fields on Existing Models (5)

| Model            | Field                    | Type                         | Purpose                                                |
| ---------------- | ------------------------ | ---------------------------- | ------------------------------------------------------ |
| `KnowledgeChunk` | `draftStatus`            | `String?`                    | FAQ draft lifecycle                                    |
| `KnowledgeChunk` | `draftExpiresAt`         | `DateTime?`                  | Auto-publish timing                                    |
| `Deployment`     | `trustLevel`             | `String @default("observe")` | Trust graduation (observe/guarded/autonomous)          |
| `Deployment`     | `spendApprovalThreshold` | `Float @default(50)`         | Dollar threshold for auto-approval at autonomous level |
| Tool definition  | `requiresManualApproval` | `boolean`                    | Ad publishing hard gate                                |

### 9.3 New Files (6)

| File                                                         | Lines | Purpose                                                                      |
| ------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------- |
| `packages/core/src/memory/scoped-stores.ts`                  | ~80   | Three scoped interfaces                                                      |
| `packages/core/src/notifications/notification-classifier.ts` | ~100  | Event → T1/T2/T3                                                             |
| `packages/core/src/notifications/notification-batcher.ts`    | ~80   | T2 batching + flush                                                          |
| `packages/db/src/stores/prisma-activity-log-store.ts`        | ~60   | ActivityLog CRUD                                                             |
| `packages/db/src/stores/prisma-event-store.ts`               | ~80   | AgentEvent emit/consume                                                      |
| `apps/runtime/src/main.ts`                                   | ~300  | Entire runtime worker (orchestration only — delegates to CompoundingService) |

### 9.4 Modified Files (6)

| File                                                   | Change                                              | Lines |
| ------------------------------------------------------ | --------------------------------------------------- | ----- |
| `packages/db/prisma/schema.prisma`                     | Add AgentEvent, ActivityLog + KnowledgeChunk fields | ~25   |
| `packages/core/src/channel-gateway/channel-gateway.ts` | Emit conversation_end event                         | ~5    |
| `packages/core/src/engine/policy-engine.ts`            | Add Step 0: requiresManualApproval                  | ~3    |
| `apps/api/src/routes/deployment-memory.ts`             | Add activity log + FAQ draft endpoints              | ~40   |
| `packages/db/src/stores/prisma-knowledge-store.ts`     | Filter draftStatus for customer reads               | ~3    |
| `apps/chat/src/gateway/deployment-lookup.ts`           | Wire CustomerScopedMemoryAccess                     | ~10   |

### 9.5 Intentionally Deferred

| Feature                              | Reason                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| Owner agent LLM (conversational AI)  | No use case needs AI conversation — CRUD + notifications sufficient |
| Dashboard UI for activity log        | API endpoint first, UI later                                        |
| Repeat customer recognition          | Needs contact identity system                                       |
| Temporal patterns (busy hours)       | Phase 2 — compounding handles facts first                           |
| Memory consolidation (nightly dedup) | Phase 2 — needs data volume to consolidate                          |

---

## 10. BizAI Mapping

| Switchboard                                   | BizAI Equivalent                                     | Architectural Parallel                                    |
| --------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| Customer Agent (`apps/chat`)                  | A1 Commerce (SMB Agent)                              | Config-driven, constrained tools, per-conversation memory |
| Owner Surface (`apps/api` + `apps/dashboard`) | MAIBA + BizClaw UI                                   | Full context, analytical, memory CRUD+E                   |
| Runtime Worker (`apps/runtime`)               | BizClaw backend + MemoryWriteHook                    | Aggregate-only, async, compounding                        |
| Scoped store interfaces                       | Three-way privacy walls (Customer/Business/Platform) | TypeScript compiler enforcement                           |
| Notification tiers                            | Pill Service urgency levels                          | T1/T2/T3 = action/confirm/FYI                             |
| FAQ draft lifecycle                           | BizClaw knowledge gap analysis                       | Auto-detect gaps, draft answers, owner review             |
| Activity log                                  | ConvoHub + Scuba observability                       | Transparent runtime behavior                              |
| `requiresManualApproval`                      | Tool-level governance in Omnibot                     | Deterministic gates over model judgment                   |

---

## 11. Success Criteria

- Customer agent cannot call `listAllMemories()` — TypeScript compilation fails
- Runtime worker cannot access `contactId` via its scoped interface (transient access during event processing only)
- Owner receives T1 notification within 30s of a pending approval
- T2 notifications batch correctly (max 3 batched pushes/hour, each containing 1+ events)
- FAQ draft auto-publishes after 72h at `guarded` trust level
- FAQ draft stays pending indefinitely at `observe` trust level
- Ad publishing always requires T1 approval regardless of trust level
- Activity log shows what the agent learned/forgot with no individual customer data
- Compounding loop runs in separate process from customer agent
- Event bus processes conversation-end events within 60s

---

## 12. Risks

| Risk                                                | Mitigation                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scoped interfaces bypassed via direct Prisma access | Code review discipline. Linting rule to flag raw Prisma calls in app code.                                                                                                                                                                                                                                   |
| Event bus poller adds 30s latency to compounding    | Acceptable for v1. Reduce interval or switch to pg LISTEN/NOTIFY if latency matters.                                                                                                                                                                                                                         |
| FAQ auto-publish surfaces wrong answers             | Confidence threshold (3+ sources) + 72h review window + owner notification at 48h.                                                                                                                                                                                                                           |
| Notification spam at `observe` trust level          | ProactiveSender rate limit (20/day) already exists. T2 batcher limits to 3/hour.                                                                                                                                                                                                                             |
| Runtime worker crashes mid-processing               | Event stays in "processing" status. Nightly job resets stale "processing" events (>1h) back to "pending" with `retryCount` increment. Events with `retryCount >= 3` are marked `dead_letter` and excluded.                                                                                                   |
| Near-duplicate facts bypass unique constraint       | If the `@@unique` constraint catches a textually identical duplicate that the vector similarity check missed, the upsert increments `sourceCount` on the existing entry rather than failing. Semantically similar but textually different facts are handled by the similarity check in `CompoundingService`. |

---

## 13. Total Scope

**~700 new lines across 6 files. ~90 modified lines across 6 files. 2 new Prisma models. 5 new fields on existing models. 1 new thin worker process.**

No new infrastructure. No new frameworks. Extends existing code. Production-ready for first deployment.
