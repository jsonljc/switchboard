# Switchboard Product Vision — Full Agent Platform Design

**Date**: 2026-03-20
**Status**: Approved
**Session strategy**: One session per phase. Each session loads this doc, writes an implementation plan, executes, verifies, commits.

---

## 1. Product Vision

Switchboard is a modular AI agent system that automates the full customer journey for med spa businesses — from ad click to post-treatment review collection and ad spend optimization. Each agent is a standalone, installable unit. Owners pick exactly what they need.

The system is WhatsApp-first, runs autonomously, and escalates to the owner via WhatsApp or Telegram only when human judgment is required.

### Design Principles

- **Standalone by default** — each agent works independently, integrates when stacked
- **WhatsApp-native** — every customer interaction happens where they already are
- **Teach, don't configure** — owners train agents with docs, conversations, and forms
- **Opinionated tone** — 3 presets, not infinite dials
- **Fail safely** — uncertain agents escalate, never guess on high-stakes actions
- **Policy-gated** — no real-world action fires without a governance check

### Standalone Agent Model

All 5 agents are always deployed. Only purchased agents are set to `active` in the registry. Unpurchased agents remain `disabled` — events for them route to `manual_queue`. This is a registry/config concern, not a deployment concern. The event bus always runs.

---

## 2. Agent Catalogue

| Agent           | Primary Job                                                 | Listens To                                                           | Emits                                                           |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Lead Responder  | Qualify inbound leads via WhatsApp conversation             | `lead.received`, `message.received`                                  | `lead.qualified`, `lead.disqualified`, `conversation.escalated` |
| Sales Closer    | Convert qualified leads into bookings                       | `lead.qualified`, `message.received`                                 | `stage.advanced`, `conversation.escalated`                      |
| Nurture         | Reminders, winbacks, review requests                        | `stage.advanced`, `lead.disqualified`, `revenue.recorded`            | `lead.qualified`, `conversation.escalated`                      |
| Revenue Tracker | Attribute revenue to ad campaigns, send offline conversions | `revenue.recorded`, `stage.advanced`, `ad.optimized`                 | `revenue.attributed`, `conversation.escalated`                  |
| Ad Optimizer    | Adjust spend, pause failing campaigns automatically         | `revenue.attributed`, `ad.anomaly_detected`, `ad.performance_review` | `ad.optimized`, `conversation.escalated`                        |

### Event Flow (Closed Loop)

```
WhatsApp message arrives
  -> Channel Adapter -> message.received
    -> Conversation Router (checks contact lifecycle stage)
      -> Lead Responder (if stage = lead)
      -> Sales Closer (if stage = qualified)
      -> Nurture (if stage = booked/treated/churned)

lead.received (from ad webhook / ConversionBusBridge)
  -> Lead Responder -> lead.qualified / lead.disqualified
    -> Sales Closer (qualified) -> stage.advanced
      -> Nurture (cadences) + Revenue Tracker (CRM logging)
    -> Nurture (disqualified) -> cold-nurture / requalify

revenue.recorded -> Revenue Tracker -> revenue.attributed + offline conversions
                 -> Nurture -> post-purchase-review cadence

revenue.attributed -> Ad Optimizer -> state update

ScheduledRunner (5 min) -> ad.performance_review
  -> Ad Optimizer -> ad.optimized + budget analysis

ad.anomaly_detected (urgent) -> Ad Optimizer -> pause campaign
```

---

## 3. Technology Decisions

| Layer     | Choice                                                            | Rationale                                                                                                      |
| --------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| LLM       | Claude API with provider-agnostic `LLMAdapter` interface          | Already in Anthropic ecosystem. Adapter allows per-agent or per-org provider swaps.                            |
| Vector DB | pgvector (Postgres extension)                                     | Zero new infrastructure. Stays in existing Prisma/Postgres stack. Sufficient for per-business knowledge bases. |
| WhatsApp  | Meta Cloud API (direct)                                           | Already integrate with Meta for ads/CAPI. One fewer vendor. Free at low volume.                                |
| Embedding | Provider-agnostic `EmbeddingAdapter`. Default: Claude embeddings. | Matches LLM adapter pattern.                                                                                   |

---

## 4. Phase 1: Production Hardening

**Goal**: Close P0/P1 gaps in existing agent infrastructure. No new features.

### Deliverables

1. **Wire PolicyEngine adapter** into `agent-bootstrap.ts`
   - Accept `PolicyEngine` in bootstrap options
   - Connect to existing policy engine from `@switchboard/core`
   - Fail-closed: policy engine errors = deny

2. **Persistent DeliveryStore**
   - New Prisma model: `DeliveryAttempt` (eventId, destinationId, status, attempts, lastAttemptAt, error)
   - `PrismaDeliveryStore` in `packages/db/` implementing `DeliveryStore` interface
   - Replace `InMemoryDeliveryStore` in bootstrap

3. **Retry executor**
   - Exponential backoff on failed deliveries (1s, 2s, 4s, 8s...)
   - Configurable `maxRetries` (default 3)
   - Dead letter sweep runs on `ScheduledRunner` tick

4. **Dead letter alerting**
   - Emit `conversation.escalated` when a delivery is dead-lettered
   - Temporary consumer: log to `console.warn` + record in DB
   - Replaced by WhatsApp notification in Phase 3

5. **Lifecycle stage guard** (logic only — persistence deferred to Phase 2)
   - Define `LifecycleStage` type: `lead | qualified | booked | treated | churned`
   - Add stage check to Nurture's requalify path — `treated` contacts skip requalification
   - In Phase 1, stage is passed via `AgentContext.contactData.lifecycleStage` (populated by the caller)
   - Persistent storage via `ConversationStore.getStage()` is wired in Phase 2

---

## 5. Phase 2: Messaging Cartridge + Conversation Routing

**Goal**: Build the shared conversational infrastructure layer. No LLM yet — just plumbing.

### Architecture

The messaging cartridge follows the existing cartridge pattern — defines actions and interfaces but does NOT import from `@switchboard/db`. Persistence is handled via store interfaces (ports) with Prisma implementations registered at the app layer.

### New Cartridge: `cartridges/messaging/`

**Actions**:

- `messaging.whatsapp.send` — send a WhatsApp message to a contact
- `messaging.whatsapp.send_template` — send a WhatsApp template message
- `messaging.escalation.notify_owner` — notify owner via WhatsApp or Telegram

**Channel Adapter port**: Interface for receiving/normalizing inbound messages. Meta Cloud API implementation lives in `apps/api/`.

### New Infrastructure

**Extend `AGENT_EVENT_TYPES`** in `packages/agents/src/events.ts`:

- Add `message.received`, `message.sent`, `escalation.owner_replied` to the canonical event type array
- Update `AgentEventType` union accordingly

**Update agent port declarations**:

- `LEAD_RESPONDER_PORT.inboundEvents`: add `message.received`
- `SALES_CLOSER_PORT.inboundEvents`: add `message.received`
- Nurture does NOT need `message.received` — it sends cadence messages via actions, not conversations

**Conversation Router** (`packages/agents/src/conversation-router.ts`):

The existing `AgentRouter` routes by event type — if all 3 conversational agents declare `message.received`, the router would send to ALL of them simultaneously. The Conversation Router solves this as a **pre-processing transform**:

1. Intercepts `message.received` events before they reach `AgentRouter`
2. Looks up the contact's lifecycle stage via `ConversationStore.getStage()`
3. Transforms the event's `metadata.targetAgentId` field based on stage:
   - `lead` (or unknown) -> `lead-responder`
   - `qualified` -> `sales-closer`
   - `booked | treated | churned` -> `nurture` (but Nurture doesn't handle `message.received` — escalate to owner instead)
4. The `EventLoop` checks `metadata.targetAgentId` and skips agents that don't match
5. Non-`message.received` events bypass the Conversation Router entirely (existing routing unchanged)

This approach requires no changes to `AgentRouter` — it operates as a filter layer in front of the existing routing.

**EventLoop `targetAgentId` filtering** (dedicated Phase 2 deliverable):

Modify `EventLoop.processRecursive()` to support targeted routing. This is a load-bearing change to the core recursive processor and requires its own test suite.

**Filtering rule**: Only filter when `metadata.targetAgentId` IS present AND does not match the current agent. If `targetAgentId` is absent or undefined, route to ALL matching agents (preserving existing behavior exactly).

```
if targetAgentId is undefined/absent -> route to all (existing behavior, unchanged)
if targetAgentId matches current agent -> route to this agent
if targetAgentId does NOT match current agent -> skip this agent
```

**Required test cases**:

- `message.received` with `targetAgentId: "lead-responder"` -> only Lead Responder processes it
- `message.received` with `targetAgentId: "sales-closer"` -> only Sales Closer processes it
- `lead.received` with NO `targetAgentId` -> routes to all matching agents (existing behavior preserved)
- `message.received` with `targetAgentId: "nonexistent-agent"` -> routes to `manual_queue` (no silent drops)
- Event with `targetAgentId` set but agent is `disabled` -> routes to `manual_queue`
- Recursive output events from a targeted handler -> do NOT inherit `targetAgentId` (output events route normally)

**ConversationStore interface** (in `packages/core/src/conversation-store.ts`):

Placed in `packages/core/` (Layer 3) so that `packages/db/` (Layer 4) can implement it without upward dependency violations.

```typescript
interface ConversationStore {
  getHistory(contactId: string): Promise<Message[]>;
  appendMessage(contactId: string, message: Message): Promise<void>;
  getStage(contactId: string): Promise<LifecycleStage>;
  setStage(contactId: string, stage: LifecycleStage): Promise<void>;
}

type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";
```

Prisma implementation (`PrismaConversationStore`) in `packages/db/`.

**EmbeddingAdapter interface** (in `packages/core/src/embedding-adapter.ts`):

Also placed in `packages/core/` for the same layer compliance reason.

```typescript
interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

**WhatsApp webhook verification**: The Meta Cloud API requires a GET endpoint with challenge token verification before webhooks activate. The Channel Adapter implementation in `apps/api/` must handle this verification handshake as part of route setup.

### WhatsApp Rate Limiting

Meta Cloud API enforces per-number message rate limits and template message restrictions. Without throttling, a Nurture cadence firing for 500 contacts simultaneously will hit these limits and messages will be silently dropped or the number flagged.

**V1 approach**: Queue-based throttling in the Reply Dispatcher:

- All outbound `messaging.whatsapp.send` actions go through a rate-limited queue (not direct dispatch)
- Default rate: 80 messages/second (Meta's Tier 1 limit for verified business numbers)
- Configurable per-org via `whatsappRateLimit` setting
- Template messages (first-contact, 24h+ window re-engagement) count against a separate daily template limit
- If queue depth exceeds threshold (default 1000), log warning and notify owner

**Cadence batch handling**: When Nurture triggers a cadence for multiple contacts (e.g., 500 review requests), the cadence runner staggers message dispatch across a configurable window (default: spread evenly over 1 hour). This prevents burst traffic and keeps the number healthy.

### WhatsApp Opt-Out Handling

Meta will flag or suspend numbers that send messages to opted-out contacts. This is a compliance requirement, not optional.

**Detection**: The Channel Adapter scans inbound messages for opt-out keywords: `STOP`, `UNSUBSCRIBE`, `OPT OUT`, `CANCEL`, and locale-specific equivalents. Detection is case-insensitive and whitespace-tolerant.

**On opt-out**:

1. Immediately suppress the contact from ALL future outbound messages (set `contact.optedOut = true` in `ConversationStore`)
2. Send a single confirmation: "You've been unsubscribed. Reply START to re-subscribe."
3. Log the opt-out event for compliance audit
4. All agents check `optedOut` before sending — opted-out contacts are skipped silently (no error, no manual_queue)

**On re-subscribe**: Contact replies `START` -> clear `optedOut` flag, resume normal messaging.

### Escalation Routing

- Owner gets a dedicated WhatsApp Business account (separate from customer-facing number)
- Escalation messages include a correlation ID (e.g., `[REF:abc123]`)
- Owner reply matching (in priority order):
  1. **WhatsApp reply-to threading** — if the owner uses the reply feature, the API provides a `context.message_id` that maps directly to the escalation message
  2. **Ref ID extraction** — scan the owner's message for `[REF:abc123]` pattern
  3. **Recency fallback** — if neither threading nor ref ID is available (owner just types a reply without hitting "reply"), match to the **most recent open escalation for that org**. If multiple escalations are open, the system replies asking the owner to specify which one (sends a numbered list of open escalations)
  4. **Ambiguity handling** — if the owner replies to a numbered list, extract the selection number and match to the corresponding escalation

- Owner replies injected as `escalation.owner_replied` events -> original agent resumes conversation using owner's reply

---

## 6. Phase 3: Knowledge Base + LLM Adapter

**Goal**: Build RAG infrastructure and provider-agnostic LLM layer.

### pgvector in `packages/db/`

- Prisma migration: `KnowledgeChunk` model with vector column
- Dimensions: 1024 (Claude embeddings default)
- **Dimension lock-in constraint**: The vector column dimension is set via Prisma migration and cannot be changed by config alone. Switching embedding providers with different dimensions requires: (1) a new migration to alter the column, (2) full re-embedding of all existing chunks. This is acceptable — embedding provider changes are rare and deliberate. Document this in the migration file comment so future sessions don't hit it blindly.
- Scoped per `organizationId` + `agentId`
- Three source types with retrieval priority:
  1. `correction` (owner live edits) — highest priority
  2. `wizard` (form wizard responses) — high priority
  3. `document` (uploaded files) — standard priority

### Document Ingestion Pipeline

- Upload endpoint in `apps/api/` accepts PDF, Word, plain text
- Chunking: recursive text splitter, ~500 token chunks with overlap
- Embedding: provider-agnostic `EmbeddingAdapter` interface
- Storage: chunks + vectors in `KnowledgeChunk` table

### LLM Adapter (`packages/agents/src/llm/`)

> **Layer note**: The `LLMAdapter` and `EmbeddingAdapter` interfaces live in `packages/core/` (Layer 3). Implementations (Claude API client) live in `packages/agents/src/llm/`. Agent handlers call LLM through dependency injection — cartridges never call LLM directly. All LLM calls happen within agent handler execution, not within cartridge code.

**Interface**:

```typescript
interface LLMAdapter {
  generateReply(prompt: ConversationPrompt): Promise<LLMReply>;
}

interface ConversationPrompt {
  systemPrompt: string; // tone preset + language + agent role
  conversationHistory: Message[];
  retrievedContext: KnowledgeChunk[];
  agentInstructions: string; // agent-specific behavior rules
}

interface LLMReply {
  reply: string;
  confidence: number; // 0-1, below threshold -> escalate
}
```

- Claude API as default implementation

**Confidence scoring** (v1 — known limitation):

V1 uses LLM self-reported confidence (0-1 scale). This is a pragmatic shortcut with a known weakness: LLMs are notoriously poor at calibrated self-confidence. The 0.6 threshold will behave inconsistently — sometimes over-escalating, sometimes under-escalating.

The confidence signal is composed of two inputs (v1):

1. **Retrieval similarity** (primary): cosine similarity of top-k retrieved chunks to the query. If the best chunk similarity is below `retrievalThreshold` (default 0.7), confidence is capped at 0.4 regardless of LLM self-report. This catches "no relevant knowledge" cases reliably.
2. **LLM self-report** (secondary): the LLM rates its own confidence. Used to catch cases where knowledge exists but the answer requires judgment beyond the KB.

Combined: `confidence = min(retrievalConfidence, llmSelfReport)`. Below `confidenceThreshold` (default 0.6) -> `conversation.escalated`.

**v2 improvement** (deferred): Replace LLM self-report with a separate classification call: "Given this reply and the retrieved context, would a human advisor send this without review?" Binary yes/no is more reliable than a continuous score.

### Retrieval Flow

On each `message.received`:

1. Embed the inbound message
2. Query pgvector for top-k chunks (default k=5) scoped to org + agent
3. Boost `wizard` and `correction` source types
4. Inject into LLM prompt as context
5. LLM generates reply with confidence score

---

## 7. Phase 4: Lead Responder End-to-End

**Goal**: Wire Phases 1-3 together for the first complete agent flow. Validation phase.

### Handler Rewrite

Current handler (score -> qualify/disqualify -> emit event) becomes the **decision layer** inside a larger conversational flow.

**New flow per `message.received`**:

1. Conversation Router confirms Lead Responder owns this contact (stage = `lead`)
2. Retrieve conversation history from `ConversationStore`
3. Retrieve relevant knowledge chunks from pgvector
4. Build `ConversationPrompt` with tone preset + language directive
5. Generate LLM reply via `LLMAdapter`
6. If confidence < threshold -> escalate (don't reply)
7. If qualification signals detected -> run `scoreLead()`:
   - Score >= threshold -> emit `lead.qualified`, transition contact to `qualified` stage
   - Score < threshold -> emit `lead.disqualified`
8. Emit `messaging.whatsapp.send` action with the reply
9. Append message + reply to conversation history

### Tone Presets

3 system prompt templates stored as config:

- `warm-professional`: "You are a friendly, polished front desk receptionist..."
- `casual-conversational`: "You are a warm, knowledgeable friend texting back..."
- `direct-efficient`: "You are concise and helpful. Get to the point..."

### Language Support

System prompt language directive + knowledge base retrieval filtered by language tag.

- `en` — English (default)
- `ms` — Malay
- `zh` — Mandarin
- `en-sg` — Singlish

### Owner Test Chat

Agent runs in `test` mode:

- Messages come from dashboard chat widget (not WhatsApp)
- No real WhatsApp messages sent
- Owner flags incorrect answers -> creates `correction` knowledge entry
- Owner approves -> agent transitions from `draft` to `active`

---

## 8. Phase 5: Remaining Agents

**Goal**: Extend conversational infrastructure to the other 4 agents.

### Port & Manifest Updates

Before enhancing agents, complete these infrastructure items (deferred from Phase 1 since they require cartridge changes):

1. **Offline conversion actions in digital-ads manifest**:
   - `digital-ads.capi.dispatch`
   - `digital-ads.google.offline_conversion`
   - `digital-ads.tiktok.offline_conversion`

2. **Revenue Tracker as blocking destination** for `stage.advanced` events:
   - Revenue Tracker runs as `blocking` sequencing
   - Nurture runs as `after_success` (reminder only fires after CRM confirms booking)

3. **Update Sales Closer port**: add `message.received` to `inboundEvents` (if not done in Phase 2)

4. **Define `cadence.start` action** in `cartridges/customer-engagement/` manifest:
   - Action type: `customer-engagement.cadence.start`
   - Parameters: `contactId`, `cadenceType`, `config`
   - Used by Sales Closer to delegate follow-up to Nurture's cadence engine

### Sales Closer Enhancements

- Triggered when contact transitions to `qualified` stage
- LLM-powered closing sequences with:
  - Urgency triggers (limited slots, promotions, seasonal offers from KB)
  - Social proof injection (testimonials from KB)
  - Booking link delivery at optimal conversation moment (LLM decides when)
- Follow-up cadence: if no booking after initial conversation, delegate to Nurture's cadence engine via `customer-engagement.cadence.start` action (not a separate implementation)
- **Cadence fallback when Nurture is not purchased**: If Nurture is `disabled` (not purchased), Sales Closer falls back to a built-in minimal follow-up — re-sends the booking link at `followUpDays` intervals via `messaging.whatsapp.send` directly. No cadence engine, no LLM-generated messages, just a simple link re-send. The `cadence.start` action is only dispatched when the agent registry confirms Nurture is `active` for this org.
- Config: `bookingUrl` (required), `followUpDays` (1, 3, 7), `urgencyEnabled` (true), `tonePreset`

### Nurture Enhancements

- All cadence messages sent via Messaging Cartridge (WhatsApp)
- 5 cadence types:
  - `consultation-reminder` — 24h + 2h before appointment
  - `no-show-recovery` — same-day + 3-day rebook offer
  - `post-treatment-review` — Day 7 review request with Google/Facebook link
  - `cold-lead-winback` — 30+ day reactivation offer
  - `dormant-client` — 60+ day re-engagement
- Cadence messages are LLM-generated using KB templates (not hardcoded strings)
- Note: Cadence delivery uses actions (`messaging.whatsapp.send`), not event emissions. Nurture does not emit `message.sent` — the messaging cartridge handles delivery confirmation internally.
- Config: `activeCadences`, `dormantThresholdDays` (60), `reviewPlatformLink`, `reviewDelayDays` (7), `requalify` (false), `tonePreset`

### Revenue Tracker Enhancements

- `retryOnFailure`: exponential backoff (leverages Phase 1 retry executor)
- `alertOnDeadLetter`: emits `messaging.escalation.notify_owner` when offline conversion fails permanently
- `platforms`: multi-select (Meta, Google, TikTok) — only dispatch to selected platforms
- Config: `trackPipeline` (true), `platforms`, `retryOnFailure` (true), `alertOnDeadLetter` (true)

### Ad Optimizer Enhancements

- New actions: `digital-ads.budget.increase`, `digital-ads.budget.decrease`
- `approvalThreshold`: dollar amount above which budget changes require owner approval via WhatsApp. Below -> auto-execute. Above -> `conversation.escalated` with approval request
- ROAS tracking: rolling window per campaign, trigger budget increase after 3+ consecutive above-target review cycles
- Config: `anomalyThreshold` (30), `reviewInterval` (5 min), `approvalThreshold`, `platforms`, `alertChannel`

---

## 9. Phase 6: Owner Setup Flow + Dashboard

**Goal**: Onboarding experience and management interface.

### Form Wizard (Dashboard)

Multi-step onboarding:

1. Business basics (name, services, target customer, pricing range)
2. Booking platform (Calendly, Fresha, or custom URL)
3. Agent selection (which agents to activate)
4. Tone & language preferences

Output: org config + agent configs written to DB. Form data ingested as `wizard` knowledge entries with high retrieval priority.

### Knowledge Upload (Dashboard)

- File upload UI -> ingestion pipeline from Phase 3
- Supported formats: PDF, Word (.docx), plain text
- Progress indicator, chunk count, preview of what the agent "learned"

### Agent Test Chat (Dashboard)

- Embedded chat widget calling same handler in `test` mode
- Owner flags bad answers -> creates `correction` knowledge entries
- "Go Live" button transitions agent from `draft` to `active`

### Agent Management (Dashboard)

Per-agent controls:

- Activate / pause / configure
- View event history and delivery status
- Dead letter queue viewer with manual retry button

### Escalation Inbox (Dashboard)

- List of pending escalations with conversation context
- Inline reply (sends via WhatsApp to customer)
- Full conversation history view

### Agent Activation Model

- `purchasedAgents` field on org config in DB
- Registry `register()` checks against purchased list
- Unpurchased agents remain `disabled`, events route to `manual_queue`

---

## 10. Dependency Graph

```
Phase 1 (Production Hardening)
  |
  v
Phase 2 (Messaging Cartridge + Conversation Routing)
  |
  v
Phase 3 (Knowledge Base + LLM Adapter)
  |
  v
Phase 4 (Lead Responder End-to-End)  <-- validates entire architecture
  |
  v
Phase 5 (Remaining 4 Agents)
  |
  v
Phase 6 (Owner Setup + Dashboard)
```

Each phase is a complete, testable deliverable. Phase 4 is the critical validation point.

**Parallelization note**: Phase 6's onboarding flow (Form Wizard, Knowledge Upload UI) can begin development after Phase 4 completes, since it only needs the Lead Responder working. The remaining agent management UI in Phase 6 depends on Phase 5.

---

## 11. Session Strategy

**One session per phase.** Each session:

1. Load this design doc
2. Run writing-plans skill for that phase's implementation plan
3. Execute the plan
4. Verify (tests + typecheck + lint)
5. Commit and end session

This prevents context window degradation over long sessions. The design doc is the continuity mechanism.

---

## 12. Layer Hierarchy (Updated)

The CLAUDE.md dependency layers need updating to include `packages/agents/`:

```
Layer 1: schemas         -> No @switchboard/* imports
Layer 2: cartridge-sdk   -> schemas only
Layer 3: core            -> schemas + cartridge-sdk (includes ConversationStore, LLMAdapter, EmbeddingAdapter interfaces)
Layer 4: db              -> schemas + core
Layer 5: cartridges/*    -> schemas + cartridge-sdk + core
Layer 5.5: agents        -> schemas + core (handler implementations, LLM client, event loop)
Layer 6: apps/*          -> May import anything
```

`packages/agents/` sits between cartridges and apps. It imports from `schemas` and `core` but NOT from `db` or cartridges. Store interfaces (`ConversationStore`, `DeliveryStore`) are defined in `core` so that `db` can implement them without upward dependencies.

**CLAUDE.md update required**: The layer hierarchy in `CLAUDE.md` (lines 34-39) must be updated to include Layer 5.5 for `packages/agents/`. This should be done in Phase 2 when the layer is first exercised with new infrastructure.

**Barrel file management**: As `packages/agents/` grows, use sub-barrels to stay under the 40-export limit:

- `packages/agents/src/llm/index.ts` — LLM adapter implementation
- `packages/agents/src/conversation/index.ts` — Conversation Router, related types
- Main `index.ts` re-exports selectively from sub-barrels

---

## 13. Known Gaps (Deferred Beyond Phase 6)

- SMS / Instagram DM / email channel adapters
- Multi-tenant billing integration
- Analytics dashboard (conversion rates, agent performance metrics)
- A/B testing for tone presets
- Knowledge base versioning (rollback to previous KB state)
- Agent-to-agent direct messaging (currently only via event bus)
- Custom agent marketplace (third-party agents)

---

## 14. Messaging Cartridge Detail

### Components

| Component         | Responsibility                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| Channel Adapter   | Receives inbound WhatsApp messages via webhook, normalizes to `message.received` event |
| LLM Reply Engine  | Generates contextual responses using agent's knowledge base + conversation history     |
| Reply Dispatcher  | Sends outgoing WhatsApp messages via action: `messaging.whatsapp.send`                 |
| Context Manager   | Maintains per-contact conversation state across sessions                               |
| Escalation Router | Routes `conversation.escalated` to owner's WhatsApp or Telegram + dashboard            |

### Knowledge Base Architecture

Each conversational agent has its own knowledge base, built from three sources:

1. **Uploaded documents** — PDFs, Word docs, SOPs, price lists, scripts
2. **Form wizard responses** — structured setup data captured at onboarding
3. **Live corrections** — owner chats directly with the agent to correct answers

Knowledge is chunked, embedded, and retrieved at inference time. The agent cites its knowledge base when answering, and flags low-confidence answers for owner review rather than guessing.

### Escalation Flow

| Trigger                                        | What Happens                                              |
| ---------------------------------------------- | --------------------------------------------------------- |
| Low confidence answer                          | Agent says "Let me check with the team" and pings owner   |
| Sensitive topic (pricing exception, medical Q) | Immediate escalation, no attempt to answer                |
| maxTurns reached                               | Graceful handoff message sent to customer, owner notified |
| Owner replies to escalation                    | Reply injected back into conversation as agent message    |

---

## 15. Owner Setup Flow

Target: under 15 minutes from sign-up to first live conversation.

| Step                | What Happens                                                                           | Time  |
| ------------------- | -------------------------------------------------------------------------------------- | ----- |
| 1. Form Wizard      | Owner fills in business basics: services, target customer, pricing range, booking link | 5 min |
| 2. Knowledge Upload | Upload price list, treatment menu, FAQ doc, objection script (optional)                | 5 min |
| 3. Agent Test Chat  | Owner has a live conversation with the agent to verify answers and adjust tone         | 5 min |

After activation, the agent goes live on WhatsApp immediately. The owner receives a WhatsApp confirmation with a link to the dashboard.

---

## 16. Per-Agent Configuration Reference

### Lead Responder

| Setting                    | Default             | Description                                                      |
| -------------------------- | ------------------- | ---------------------------------------------------------------- |
| `qualificationThreshold`   | 40                  | Score cutoff for qualify vs disqualify                           |
| `maxTurnsBeforeEscalation` | 10                  | Conversation turns before human handoff                          |
| `tonePreset`               | `warm-professional` | `warm-professional`, `casual-conversational`, `direct-efficient` |
| `language`                 | `en`                | `en`, `ms`, `zh`, `en-sg`                                        |
| `escalationChannel`        | `whatsapp`          | `whatsapp` or `telegram`                                         |
| `bookingLink`              | —                   | Optional — sends link instead of direct booking                  |
| `confidenceThreshold`      | 0.6                 | LLM confidence below this triggers escalation                    |

### Sales Closer

| Setting             | Default     | Description                             |
| ------------------- | ----------- | --------------------------------------- |
| `bookingUrl`        | (required)  | Calendly, Fresha, or custom link        |
| `tonePreset`        | inherits    | Inherits from Lead Responder if stacked |
| `followUpDays`      | `[1, 3, 7]` | Days after first contact to re-engage   |
| `urgencyEnabled`    | `true`      | Reference limited slots or promotions   |
| `escalationChannel` | `whatsapp`  | `whatsapp` or `telegram`                |

### Nurture

| Setting                | Default  | Description                                |
| ---------------------- | -------- | ------------------------------------------ |
| `activeCadences`       | all      | Which cadences are enabled                 |
| `reviewDelayDays`      | 7        | Days after treatment for review request    |
| `reviewPlatformLink`   | —        | Google Maps URL or Facebook review link    |
| `requalify`            | `false`  | Whether disqualified leads re-enter funnel |
| `dormantThresholdDays` | 60       | Days of inactivity before dormant cadence  |
| `tonePreset`           | inherits | Inherits from Lead Responder if stacked    |

### Revenue Tracker

| Setting             | Default | Description                                      |
| ------------------- | ------- | ------------------------------------------------ |
| `trackPipeline`     | `true`  | Log stage transitions to CRM                     |
| `platforms`         | all     | Meta, Google, TikTok (any combination)           |
| `retryOnFailure`    | `true`  | Retry failed CAPI dispatches with backoff        |
| `alertOnDeadLetter` | `true`  | Owner notified when conversion drops permanently |

### Ad Optimizer

| Setting             | Default    | Description                                           |
| ------------------- | ---------- | ----------------------------------------------------- |
| `anomalyThreshold`  | 30         | % drop that triggers immediate campaign pause         |
| `reviewInterval`    | `5 min`    | How often scheduled budget review runs                |
| `approvalThreshold` | —          | Dollar amount above which changes need owner approval |
| `platforms`         | all        | Meta, Google, TikTok (any combination)                |
| `alertChannel`      | `whatsapp` | `whatsapp` or `telegram`                              |
