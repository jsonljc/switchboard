# Switchboard Architecture Rebalance — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-04-12
**Status:** Draft
**Goal:** Simplify over-engineered governance to essentials. Build three-tier deployment memory and compounding loop. Shift Switchboard from "governance platform that happens to have agents" to "agent platform where every action is safe."

---

## 1. Problem

Switchboard has ~3,350 lines of governance code across 6 subsystems (approval, policy engine, risk scorer, competence, audit, identity) plus ~3,270 lines of governance orchestration. This delivers enterprise-grade features — delegation chains with BFS, quorum approvals, composite risk adjustments, hash-chained audit, competence decay curves — for a product with zero deployed customers.

Meanwhile, the features that would make an SMB owner say "this is magic" don't exist:

- **No deployment memory** — agents forget everything between sessions
- **No compounding** — the 100th conversation isn't smarter than the 1st
- **No context routing** — no system for managing what the agent knows at each step
- **No learned preferences** — agent can't adapt to "this business prefers SMS over email"

A `KnowledgeChunk` model and RAG ingestion pipeline exist in the codebase (`packages/agents/src/knowledge/`, `packages/db/`), scoped per org+agent with vector search. But nothing feeds conversation outcomes back into this store, and there's no tiered architecture for different types of memory.

### The Imbalance

| Capability                  | Lines of Code | Customer Value                             |
| --------------------------- | ------------- | ------------------------------------------ |
| Delegation chains + BFS     | 251           | Zero (no multi-approver orgs exist)        |
| Composite risk adjustments  | ~130          | Zero (no baseline behavioral data)         |
| Competence tracking + decay | 268           | Zero (no agents with enough history)       |
| Hash-chained audit ledger   | 337           | Near-zero (simple audit log sufficient)    |
| Per-deployment memory       | 0             | High (agent that remembers = retention)    |
| Compounding loop            | 0             | High (agent that improves = word-of-mouth) |
| Context routing             | 0             | Medium (cheaper, faster, more accurate)    |

---

## 2. Design: Governance Simplification

### 2.1 What Stays (The Doctrine Core)

These deliver the trust promise: "every action is approved, reversible, and audited."

| Component                  | Files                                               | Lines | Why Keep                                                                                              |
| -------------------------- | --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Sealed approvals           | approval/state-machine.ts, binding.ts               | ~200  | Propose → approve/reject → execute. Core trust.                                                       |
| Snapshot + undo            | execution-manager.ts (captureSnapshot, requestUndo) | ~100  | Reversibility is the product.                                                                         |
| Basic audit log            | audit/ledger.ts (simplified)                        | ~100  | Append-only table. Who/what/when/result.                                                              |
| Trust score                | marketplace/trust-score-engine.ts                   | ~150  | Drives autonomy tiers. Already works.                                                                 |
| Governance profile         | identity/governance-presets.ts                      | ~80   | observe/guarded/strict/locked per org.                                                                |
| Risk scorer (simplified)   | engine/risk-scorer.ts (base only)                   | ~80   | Base risk weight + dollars at risk. No composite adjustments.                                         |
| Policy engine (simplified) | engine/policy-engine.ts (4 steps)                   | ~200  | Forbidden check, spend limits, policy rules (4 operators: eq, gt, lt, contains), risk-based approval. |

**Simplified policy engine — 4 steps instead of 10:**

1. Forbidden behaviors → deny
2. Spend limits → deny if exceeded
3. Policy rules (4 operators, first deny wins) → deny or flag
4. Risk-based approval requirement → allow or require approval

**Cut steps:** trusted behaviors auto-allow, competence trust, rate limits (move to infra), cooldowns (move to infra), protected entities (fold into policy rules).

### 2.2 What Gets Cut

| Component                           | Lines Cut | Replacement                                                                                               |
| ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Delegation chains + BFS             | 251       | Single approver per org. Add back when needed.                                                            |
| Quorum (multi-approver)             | ~80       | Single approver.                                                                                          |
| Composite risk adjustments          | ~130      | Base risk score only. Cumulative/velocity/concentration/cross-cartridge removed.                          |
| Competence tracking + decay         | 268       | Trust score already handles reputation.                                                                   |
| Hash-chained audit                  | ~200      | Simple append-only audit table. SHA chain adds complexity with no current consumer.                       |
| 39 audit event types                | —         | Compress to 8: proposed, approved, rejected, executed, failed, undone, policy_changed, connection_changed |
| 13 condition operators              | —         | Keep 4: eq, gt, lt, contains                                                                              |
| Role overlays with time windows     | ~131      | Single identity spec per principal. No conditional overlays.                                              |
| Delegation rules in DB              | —         | Remove DelegationRule model.                                                                              |
| CompetenceRecord + CompetencePolicy | —         | Remove both models.                                                                                       |

**Estimated lines removed:** ~1,060 from packages/core + related orchestrator simplification.

### 2.3 What Stays Untouched

- Cartridge system (cartridge-sdk, all cartridges)
- Marketplace (listings, deployments, tasks)
- Channel gateway + chat runtime
- All apps (api, chat, dashboard, mcp-server)
- Data flow system (multi-step plans)
- Cross-cartridge enrichment
- All external integrations (Meta, Google, Stripe, Telegram, WhatsApp)

---

## 3. Design: Three-Tier Deployment Memory

Build on the existing `KnowledgeChunk` model and `IngestionPipeline`. The three tiers correspond to different trust levels and update cadences.

### 3.1 Architecture

```
┌─────────────────────────────────────────────────┐
│              Per-Deployment Memory               │
│                                                  │
│  Tier 1: Session Context (ephemeral)             │
│  ├── Current conversation thread                 │
│  ├── Active entities being discussed             │
│  └── Cleared after conversation ends             │
│                                                  │
│  Tier 2: Business Knowledge (curated)            │
│  ├── Website scan results (sourceType: document) │
│  ├── Setup wizard answers (sourceType: wizard)   │
│  ├── Owner corrections (sourceType: correction)  │
│  ├── Extracted preferences (sourceType: learned) │ ← NEW
│  └── Updated on owner correction or extraction   │
│                                                  │
│  Tier 3: Interaction Patterns (accumulated)      │
│  ├── Conversation summaries                      │
│  ├── Common questions + best answers             │
│  ├── Objection patterns + what worked            │
│  ├── Temporal patterns (busy days, quiet hours)  │
│  └── Updated after every conversation            │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 3.2 Data Model Changes

**Extend existing KnowledgeChunk:**

1. Add `sourceType` value: `"learned"` — for patterns extracted from conversations.
2. Add `deploymentId` column (nullable for backward compatibility with existing org+agent scoped chunks). New `learned` chunks always have `deploymentId` set. Search interface extended with optional `deploymentId` filter.

**New model: InteractionSummary**

```prisma
model InteractionSummary {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  channelType     String   // telegram, whatsapp, web_widget
  contactId       String?  // link to Contact if identified
  summary         String   // LLM-generated conversation summary
  outcome         String   // booked, qualified, lost, info_request, escalated
  extractedFacts  Json     @default("[]")  // [{fact, confidence, category}]
  questionsAsked  Json     @default("[]")  // common questions for FAQ building
  duration        Int      // seconds
  messageCount    Int
  createdAt       DateTime @default(now())

  @@index([organizationId, deploymentId])
  @@index([createdAt])
}
```

**New model: DeploymentMemory**

```prisma
model DeploymentMemory {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  category        String   // preference, faq, objection, pattern, fact
  content         String   // the learned insight
  confidence      Float    @default(0.5)  // 0-1, increases with confirmation
  sourceCount     Int      @default(1)    // how many conversations support this
  lastSeenAt      DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // No unique constraint on content — dedup is handled in the compounding
  // service by embedding both the new fact and existing entries on-the-fly,
  // computing cosine similarity (threshold > 0.92). No embedding column on
  // this model — embeddings are computed transiently per upsert, not stored.
  // This trades compute cost (re-embed on each upsert) for storage simplicity.
  @@index([organizationId, deploymentId])
  @@index([confidence])
}
```

**Entry cap enforcement:** On each upsert, the compounding service checks `count(organizationId, deploymentId)`. If >= 500, skip the insert. A weekly cron job prunes entries below the surfacing threshold that haven't been seen in 90+ days.

````

### 3.3 Conversation Lifecycle Hook

**Problem:** There is no conversation state machine. `ConversationThread.stage` is set directly with no transitions or events. The session state machine (`AgentSession`) manages runtime sessions, not conversations.

**Solution:** Build a `ConversationLifecycleTracker` in the channel gateway layer. No changes to `ThreadStage` needed — the tracker works independently by detecting inactivity timeouts and explicit close signals. It hooks into the existing `onMessageRecorded` callback already on `ChannelGatewayConfig`.

```typescript
// packages/core/src/channel-gateway/conversation-lifecycle.ts

export type ConversationEndReason = "inactivity" | "explicit_close" | "won" | "lost";

export interface ConversationEndEvent {
  deploymentId: string;
  organizationId: string;
  contactId: string | null;
  channelType: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  duration: number;      // seconds
  messageCount: number;
  endReason: ConversationEndReason;
}

export type ConversationEndHandler = (event: ConversationEndEvent) => Promise<void>;
````

**Triggering:** The `ChannelGateway` already has an `onMessageRecorded` callback. We add a parallel `onConversationEnd` callback to `ChannelGatewayConfig`. The chat app wires this to the compounding loop.

**When does a conversation "end"?**

- Inactivity timeout (configurable per deployment, default 30 minutes)
- Thread stage transitions to `won` or `lost`
- Explicit close signal from channel (e.g., Telegram `/end` command)

### 3.4 Relationship to ConversationThread.agentContext

`ConversationThread` already has an `agentContext` JSON field (typed as `AgentContextData`) tracking:

- `objectionsEncountered: string[]`
- `preferencesLearned: Record<string, string>`
- `offersMade: OfferMade[]`
- `topicsDiscussed: string[]`
- `sentimentTrend: SentimentTrend`

**Decision:** `agentContext` is **input to** the compounding loop, not replaced by it.

- `agentContext` stays as per-thread ephemeral state (Tier 1) — it tracks what happened in _this_ conversation
- The compounding loop reads `agentContext` on conversation end and feeds relevant data into `DeploymentMemory` (Tier 3) — e.g., preferences and objections that repeat across threads become learned facts
- This avoids a migration/breaking change to `ConversationThread` while getting the compounding benefit

**Package ownership:**

- Types (`ConversationEndEvent`, `ConversationLifecycleTracker`) live in `packages/core/src/channel-gateway/` (Layer 3)
- `KnowledgeSourceType` extension (`"learned"`) lives in `packages/core/src/knowledge-store.ts` (Layer 3)
- `ConversationCompoundingService` and `ContextBuilder` live in `packages/agents/src/memory/` (Layer 5.5) — they import from `@switchboard/core` and `@switchboard/schemas`, respecting dependency layers
- New exports added to `packages/agents/src/index.ts` barrel (no subpath exports — `@switchboard/agents` only has a root export)

**Message source:** The `ConversationLifecycleTracker` accumulates messages as they flow through `onMessageRecorded`. The `ConversationEndEvent.messages` array is built from this in-memory accumulation, not from `ConversationThread`. This means messages are available without any DB query at conversation end.

### 3.5 Compounding Loop

After every conversation ends (via the lifecycle hook), a background job runs:

```
Conversation ends (ConversationEndEvent)
  │
  ├── 1. Summarize conversation (LLM)
  │     → Store InteractionSummary
  │     → Input: messages array from event
  │
  ├── 2. Extract facts (LLM)
  │     → "Client's most popular service is teeth whitening"
  │     → "They prefer SMS over email for reminders"
  │     → "They're closed on Sundays"
  │     → Upsert DeploymentMemory:
  │       - Vector similarity check (cosine > 0.92) against existing entries
  │       - If similar exists: increment sourceCount, update confidence, update lastSeenAt
  │       - If new: insert with confidence 0.5
  │
  ├── 3. Extract FAQ patterns
  │     → If same question asked 3+ times → auto-add to Tier 2 knowledge
  │     → Ingest via existing IngestionPipeline (sourceType: "learned")
  │
  └── 4. Read agentContext from ConversationThread
        → Merge preferencesLearned into DeploymentMemory (category: "preference")
        → Merge objectionsEncountered into DeploymentMemory (category: "objection")
```

**Confidence scoring formula:**

```
confidence(sourceCount, ownerConfirmed) =
  if ownerConfirmed: 1.0
  else: min(0.95, 0.5 + 0.15 * ln(sourceCount))
```

| sourceCount | confidence |
| ----------- | ---------- |
| 1           | 0.50       |
| 2           | 0.60       |
| 3           | 0.66       |
| 5           | 0.74       |
| 10          | 0.85       |
| 20          | 0.95 (cap) |

- Confirmed by owner correction: confidence = 1.0
- Contradicted by owner: **delete and replace** — owner always wins
- Owner corrections (`sourceType: correction`) are never subject to decay
- Not seen for 90 days: confidence decays by 0.1 (except `category: pattern` — seasonal patterns use 180-day window)
- **Surfacing threshold:** `sourceCount >= 3 AND confidence >= 0.66` — prevents hallucinated facts from reaching customers

### 3.6 Context Routing

Before each agent response, build a context budget:

```
buildContext(deployment, conversation):
  1. Always include: business profile (from setup wizard — Tier 2)
  2. Always include: owner corrections (Tier 2, sourceType: correction)
  3. Retrieve: top-5 relevant knowledge chunks via vector search (Tier 2)
     → Use deploymentId filter for "learned" chunks, org+agent for others
  4. Include: high-confidence DeploymentMemory entries (sourceCount >= 3, confidence >= 0.66)
  5. Include: recent interaction summaries if repeat customer (Tier 3)
  6. Budget: cap total context at configurable token limit (default 4000, per deployment)
  7. Priority: corrections > wizard > learned > document > patterns
  8. Cold start: Tier 2 wizard/document data is sufficient until Tier 3 populates
  9. Token counting: use character-based estimate (1 token ≈ 4 chars) — good enough
     for budgeting; exact counting not worth the dependency
```

This uses the existing `KnowledgeStore.search()` for retrieval (extended with optional `deploymentId`). The priority ordering maps to the existing `correction > wizard > document` boosting, extended with `learned` (boost 1.1x).

---

## 4. Implementation Approach

### Phase 1: Memory Foundation (low risk, high impact — 1 sprint)

**Goal:** Agent gets smarter after every conversation. Zero governance changes.

1. **Prisma models:** Add `InteractionSummary`, `DeploymentMemory`. Add `deploymentId` column to `KnowledgeChunk`. Run migration.
2. **Extend KnowledgeSourceType:** Add `"learned"` to source type union. Add `deploymentId` to `KnowledgeChunk` interface, `KnowledgeSearchOptions`, and `PrismaKnowledgeStore`.
3. **Add `"learned"` source boost:** 1.1x in retrieval layer.
4. **Conversation lifecycle hook:** Add `onConversationEnd` callback to `ChannelGatewayConfig`. Implement inactivity timeout detection.
5. **Build compounding loop:** `ConversationCompoundingService` — on conversation end: summarize (LLM) → extract facts (LLM) → upsert DeploymentMemory (with vector similarity dedup) → merge agentContext → ingest FAQ patterns via existing IngestionPipeline.
6. **Wire knowledge into context:** Add `ContextBuilder` — calls `KnowledgeStore.search()` + loads high-confidence `DeploymentMemory` entries. Assembles tiered context with token budget.
7. **Owner correction API:** Endpoint to view/correct/delete learned facts (DeploymentMemory entries).
8. **Prisma stores:** `PrismaInteractionSummaryStore`, `PrismaDeploymentMemoryStore`.

### Phase 2: Memory Intelligence (1 sprint)

**Goal:** Agent visibly gets smarter.

1. **FAQ auto-builder** — 3+ same question → auto-add to Tier 2 knowledge.
2. **Temporal patterns** — learn busy hours, common inquiry types by day.
3. **Repeat customer recognition** — "Welcome back, Sarah."
4. **Owner dashboard UI** — show what the agent has learned, let owner correct/delete.
5. **Memory metrics** — track facts learned per deployment, confidence distribution.

### Phase 3: Governance Simplification (higher risk, lower urgency — 1 sprint)

**Goal:** Cut complexity one subsystem at a time. One PR per removal.

**Order (least coupled → most coupled):**

0. **Interface audit** — grep all callers of cut APIs. List every call site. Confirm each has a safe fallback or is also being removed.
1. **Remove competence tracker + simplify policy engine** — delete `competence/`, remove policy engine step 3 (competence trust), remove API route, remove `CompetenceRecord` + `CompetencePolicy` Prisma models. **Bundled** because removing competence without updating the policy engine that calls it would break the pipeline.
2. **Remove composite risk adjustments** — simplify `risk-scorer.ts` to base scoring only. Remove `compositeContext` from `shared-context.ts`.
3. **Remove hash-chained audit** — simplify ledger to append-only (remove `canonical-json.ts`, `canonical-hash.ts`, `previousEntryHash`, `verifyChain`).
4. **Remove role overlays** — simplify `identity/spec.ts` to single identity. Remove `RoleOverlay` model.
5. **Remove delegation + quorum** — simplify approval to single-approver. Replace `canApprove()` with direct principal check. Remove `QuorumState` from state-machine. Remove `DelegationRule` model.
6. **Simplify remaining policy engine steps** — remove rate limit and protected entity steps (move to infra). Reduce to 4 operators.
7. **Compress audit event types** — 39 → 8.

---

## 5. What This Enables

**Before:** "Your agent can book appointments and answer questions."
**After:** "Your agent learned that teeth whitening is your most popular service, that Tuesdays are your busiest day, and that customers who ask about pricing usually book within 48 hours. It handles 73% of inquiries without needing you."

The governance still works (every booking is still approved/reversible/audited). But the agent is no longer stateless. It compounds. And switching to a competitor means losing everything it learned — the memory moat.

---

## 6. Success Criteria

- Governance tests still pass after simplification (minus removed features)
- Policy engine evaluates in 4 steps instead of 10
- After 50 conversations, a deployment has 10+ learned facts with confidence > 0.66
- Context budget stays under 4000 tokens per message
- Owner can see and correct what the agent learned via dashboard
- Agent references learned knowledge in responses ("Based on your pricing...")

---

## 7. Risks

| Risk                                                     | Mitigation                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Governance simplification breaks existing features       | Phase 3 is subtractive — remove code, verify tests. No new logic. Competence + policy engine bundled.                                |
| LLM extraction hallucinates facts                        | Confidence formula + owner correction. Low-confidence facts never surfaced (threshold: sourceCount >= 3, confidence >= 0.66).        |
| Memory bloat over time                                   | 90-day decay, max 500 DeploymentMemory entries per deployment.                                                                       |
| Cut governance features needed later                     | All code in git history. Delegation/quorum/competence can be re-added in <1 sprint if a customer needs it.                           |
| KnowledgeStore search scoped to agentId not deploymentId | Migration adds nullable deploymentId to KnowledgeChunk. Search extended with optional deploymentId filter. Existing data unaffected. |

---

## 8. Knowledge Concepts Applied

| Concept                         | How Applied                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| [[three-tier-memory]]           | Tier 1 (session/agentContext), Tier 2 (curated business knowledge), Tier 3 (accumulated patterns) |
| [[memory-as-moat]]              | DeploymentMemory creates switching cost — accumulated context is not portable                     |
| [[compounding-leverage-engine]] | Post-conversation extraction loop makes every interaction improve the next                        |
| [[context-budget-architecture]] | buildContext() with 4000-token cap and priority-based retrieval                                   |
