# Architecture Hardening Design Spec

**Date:** 2026-03-22
**Status:** Approved (brainstorming complete)
**Scope:** Comprehensive hardening of the Switchboard AI agent architecture — backend reliability, LLM infrastructure, persistence, escalation, and execution safety.

**Guiding principle:** Sophisticated backend, simple customer surface. No customer-facing token budgets, model selection, or infrastructure knobs. The customer experience stays: connect leads → choose tone → set hours → set services → set booking link → define escalation → go live.

---

## 1. Model Router & LLM Infrastructure

Switchboard owns all LLM inference. No customer API keys.

### Model Router

Three slots plus a critical flag:

| Slot        | Purpose                                                           | Default Model   |
| ----------- | ----------------------------------------------------------------- | --------------- |
| `default`   | Lead qualification, cadence messages, opt-out, simple replies     | Haiku           |
| `premium`   | Sales closing, objection handling, ad optimization, qualification | Sonnet          |
| `embedding` | Knowledge base embeddings                                         | Embedding model |

Routing logic:

```
resolve(slot, { critical?: boolean })
- default + critical → upgrade to premium
- premium + critical → stays premium
- default + non-critical → stays default
```

Config is a simple map in code (not DB). No tier-based model routing at v1.

### Fallback Chain

- Retry: 1-2 attempts on same model (transient failures, timeouts)
- `default → premium` fallback when lightweight model fails
- `premium → default` fallback **only for degradable tasks** (nurture messages, simple replies, tagging)
- Non-degradable tasks (closing, compliance, ad decisions) → safe hold state or escalation
- Timeout: configurable per task class, default 8s

### Task-Appropriate Fail-Safes

Three categories, not one generic message:

1. **Customer-facing** → hold response ("I'll have someone follow up shortly")
2. **Internal classification** → conservative default (`UNKNOWN` / `NEEDS_HUMAN`)
3. **Decision point** → escalate to owner

### Structured Outputs

- All machine decision points (classification, routing, qualification, ad decisions) → JSON validated by Zod schema
- User-facing messages → free text
- Malformed JSON → retry once with stricter prompt, then deterministic safe fallback per task

### Usage Logging

`LlmUsageLog` table — internal only, never exposed to customer:

- orgId, model, inputTokens, outputTokens, taskType, timestamp

Used for: cost monitoring, debugging, future pricing decisions.

---

## 2. Rate Limiting & Cost Guardrails

### Fair-Use Rate Limiting

- Per-org concurrency cap (5 concurrent LLM calls)
- Short queue with bounded wait (30s max)
- Drop or coalesce stale/superseded queued work (newer message from same contact supersedes older)
- 503 with retry hint when queue limit exceeded

### Loop Detection

Detect using: same contact + same event type + same content hash + same workflow trigger + time window (5s). Catches webhook echo loops. Log and break explicitly. Increment per-org/workflow loop counter — trip circuit breaker if repeated, alert ops above threshold.

### Cost Guardrails (Internal Only)

- Soft monthly cost expectation per org
- When exceeded: downgrade degradable workflows first, preserve premium for critical flows
- Alert ops — no customer-facing token system at v1

---

## 3. ConversationRouter & PrismaConversationStore

### PrismaConversationStore

New store in `packages/db/src/stores/prisma-conversation-store.ts`:

- Implements existing `ConversationStore` interface from `packages/core`
- Persists: message history, lifecycle stage, opt-out status
- Backed by new `ConversationMessage` and `ContactLifecycle` Prisma models

### ConversationRouter Wiring

In `apps/api/src/agent-bootstrap.ts`:

- Instantiate `ConversationRouter` with PrismaConversationStore
- Insert before EventLoop: `message.received` → ConversationRouter adds `targetAgentId` → EventLoop processes
- Stage-to-agent mapping (from `lifecycle.ts`): `lead → lead-responder`, `qualified → sales-closer`, `booked/treated/churned → escalate to owner`

### Per-Contact Mutex

In `packages/agents/src/concurrency.ts`:

- In-memory lock map keyed by `orgId:contactId`
- Acquire before processing, queue if locked
- Auto-release after processing or 30s timeout
- Prevents two agents responding to same contact simultaneously

---

## 4. Persistence & Caching

### Agent Registry to DB

New `AgentRegistration` Prisma model:

- Fields: `orgId, agentId, agentRole, executionMode, status, config, configVersion, createdAt, updatedAt`
- Unique constraint: `(orgId, agentId)`
- Status enum: `active | disabled | draft | error`
- `configVersion` incremented on every config write
- Config as JSON blob with Zod validation at app layer

`PrismaAgentRegistry` in `packages/db/src/stores/`:

- Implements existing `AgentRegistry` interface
- Hot cache: in-memory Map, loaded on startup, refreshed on writes
- **DB is source of truth.** Writes go to DB first, cache updated after successful write. Cache can be safely rebuilt anytime.

### ROAS History to DB

New `RoasSnapshot` Prisma model:

- Fields: `orgId, entityType, entityId, platform, adAccountId, roas, spend, revenue, currency, campaignStatus, attributionWindow, dataFreshnessAt, snapshotDate, optimizerRunId, createdAt`
- Daily granularity — one per entity per day, deduplicated on write
- `entityType` + `entityId` instead of just `campaignId` (supports campaign/adset/account level)
- `optimizerRunId` links each snapshot to the run that captured it (audit trail)
- Hot cache: last 7 days in memory per org, older data from DB on demand

### DeliveryStore

Already has `PrismaDeliveryStore` wired in bootstrap (commit `3013b87`). No changes needed.

---

## 5. Escalation Implementation & Dead Code Cleanup

### Dispatcher Cleanup

- Remove `packages/agents/src/dispatcher.ts` and all imports/exports
- Verify EventLoop fully owns: routing, retry semantics, failure capture, dead-letter handoff
- Consolidation, not just file deletion

### escalateToOwner

New module: `packages/agents/src/escalation.ts`

Structured payload:

```typescript
escalateToOwner({
  orgId,
  contactId,
  reason,
  sourceAgent,
  priority,
  conversationSummary,
  metadata,
});
```

**reason** is an enum: `low_confidence | booking_question | pricing_exception | unhappy_lead | compliance_risk | high_value_lead | human_requested | unsupported_intent` — with optional free-text `details`.

**priority**: `low | medium | high | urgent`

**conversationSummary**: structured and concise — who, what they want, why escalated, recommended next step. Max ~500 chars.

**Execution order:**

1. Create durable escalation record in DB first (the real record)
2. Fan out notifications:
   - Dashboard inbox entry via HandoffInbox
   - WhatsApp short alert to owner
3. WhatsApp failure must not block inbox creation

**Deduplication:** same org + same contact + same reason + unresolved existing escalation → skip

**Escalation lifecycle:** `open → acknowledged → snoozed → resolved`

### Clear Separation

- **Escalation inbox** = owner work queue ("customer needs you")
- **DLQ viewer** = operator/admin troubleshooting ("system had an internal failure")
- Never collapsed into one surface

### DLQ Viewer

- Status filter: `retrying | dead-lettered | resolved`
- Default view: dead-lettered only
- Toggle to see in-flight failures

---

## 6. Reliability & Error Handling

### LLM Fallback Chain

- Retry 1-2 times on same model for transient failures/timeouts
- `default → premium` fallback allowed
- `premium → default` fallback **only for degradable tasks**
- Non-degradable tasks → safe hold state or escalation
- Structured failure logging: model, attempt count, error type, latency, taskType

### Loop Detection

- Contact + event type + content hash + workflow trigger + time window
- Log and break explicitly
- Loop counter per org/workflow — circuit breaker if repeated

### Cost Guardrails

- Downgrade degradable workflows first when exceeded
- Preserve premium for critical flows (closing, escalation summaries)
- Internal alert only

### Fair-Use Concurrency

- Per-org cap: 5 concurrent LLM calls
- Short queue with bounded wait (30s)
- Drop/coalesce stale/superseded queued work
- 503 with retry hint on overflow

---

## Non-Goals (Deferred)

- Customer-facing token budgets or billing
- Tier-based model routing (free/standard/premium customer tiers)
- Grace period billing semantics
- Fine-grained per-minute/per-hour quotas by tier
- Elaborate risk-aware routing matrix
- Full config history table (configVersion is sufficient for v1)
- Multi-instance cache invalidation (local cache, single-instance for v1)
