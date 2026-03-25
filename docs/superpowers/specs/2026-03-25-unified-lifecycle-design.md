# Unified Contact Lifecycle + Opportunity + Revenue Attribution — Design Spec

**Date:** 2026-03-25
**Status:** Approved (brainstorming complete)
**Scope:** Productization layer that unifies contact identity, commercial pipeline, revenue attribution, and graceful fallback for partial agent bundles.

**Guiding principle:** Leads becoming money. Every architectural decision serves: "can the owner see their leads turning into revenue, with AI doing the work and humans stepping in only when needed?"

---

## 1. Problem Statement

Switchboard has strong agent infrastructure, governance, and routing — but lacks a coherent product layer that customers can feel. Specifically:

1. **Fragmented lifecycle** — two disconnected stage models (`LifecycleStage` in conversation-store.ts and `ThreadStage` in conversation-thread.ts) with no unified view
2. **No revenue attribution** — cannot answer "how much money came from Instagram ads this month?"
3. **Broken partial bundles** — when a customer doesn't buy all agents, unhandled events silently route to `manual_queue` with no owner visibility
4. **No pipeline view** — dashboard cannot show a funnel from lead to revenue
5. **No commercial object** — no entity represents "this person is interested in Botox and we think it's worth $500"

---

## 2. Entity Model

### 2.1 Contact — Relationship Identity

The parent entity for a person interacting with the business. Owns identity, attribution, and rolled-up relationship state.

```typescript
Contact {
  id: string (uuid)
  organizationId: string

  // Identity
  name: string | null
  phone: string | null
  email: string | null
  primaryChannel: "whatsapp" | "telegram" | "dashboard"
  firstTouchChannel: string | null

  // Lifecycle (DERIVED — never directly set)
  stage: "new" | "active" | "customer" | "retained" | "dormant"

  // Attribution (captured at first touch)
  source: string | null           // "instagram_ad", "google_ad", "organic", "referral"
  attribution: AttributionChain | null

  // Metadata
  roles: string[]                 // ["lead", "customer", "operator"]
  firstContactAt: Date
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}
```

**Contact stage derivation rules** (computed by `refreshContactStage()`):

```
hasWon = any opportunity in "won"
hasActive = any opportunity NOT in "won" or "lost"  // nurturing is non-terminal
daysSinceActivity = now - lastActivityAt
thresholdDays = skin-configurable (default 30)

if hasWon AND hasActive         → "retained"
if hasWon AND !hasActive AND daysSinceActivity < threshold → "customer"
if hasWon AND !hasActive AND daysSinceActivity >= threshold → "dormant"
if !hasWon AND hasActive        → "active"
if !hasWon AND !hasActive AND daysSinceActivity < threshold → "active"  // v1 approximation
if !hasWon AND !hasActive AND daysSinceActivity >= threshold → "dormant"
if no opportunities exist       → "new"
```

### 2.2 Opportunity — Commercial Pipeline

One per service interest per contact. This is where business logic lives: qualification, pipeline stage, value tracking.

```typescript
Opportunity {
  id: string (uuid)
  organizationId: string
  contactId: string              // FK → Contact

  // Service interest
  serviceId: string              // FK → service catalog
  serviceName: string            // denormalized for display

  // Sales pipeline
  stage: "interested" | "qualified" | "quoted" | "booked" | "showed" | "won" | "lost" | "nurturing"

  // Qualification (absorbed from LeadProfile)
  timeline: "immediate" | "soon" | "exploring" | "unknown"
  priceReadiness: "ready" | "flexible" | "price_sensitive" | "unknown"
  objections: Array<{ category: string, raisedAt: Date, resolvedAt: Date | null }>
  qualificationComplete: boolean

  // Value
  estimatedValue: number | null  // cents, from service catalog typicalValue
  revenueTotal: number           // cached rollup from SUM(RevenueEvent.amount). Truth lives on RevenueEvent.

  // Ownership
  assignedAgent: string | null   // current primary owner agent (not full history)
  assignedStaff: string | null   // human staff if applicable

  // Metadata
  lostReason: string | null
  notes: string | null
  openedAt: Date
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
```

### 2.3 RevenueEvent — Money Truth

Immutable records of actual revenue. Source of truth for all financial data.

```typescript
RevenueEvent {
  id: string (uuid)
  organizationId: string
  contactId: string              // FK → Contact
  opportunityId: string          // FK → Opportunity

  // Revenue
  amount: number                 // cents
  currency: string               // "SGD", "USD", etc.
  type: "payment" | "deposit" | "invoice" | "refund"
  status: "pending" | "confirmed" | "refunded" | "failed"

  // Source verification
  recordedBy: "owner" | "staff" | "stripe" | "integration"
  externalReference: string | null
  verified: boolean              // true if from integration, false if manual

  // Attribution (inherited from Contact at recording time — not independent re-attribution)
  sourceCampaignId: string | null
  sourceAdId: string | null

  recordedAt: Date
  createdAt: Date
}
```

### 2.4 OwnerTask — Human Intervention

First-class entity for fallback work, approvals, and manual follow-up. This is what makes partial bundles work.

```typescript
OwnerTask {
  id: string (uuid)
  organizationId: string
  contactId: string | null       // FK → Contact
  opportunityId: string | null   // FK → Opportunity

  // Task
  type: "fallback_handoff" | "approval_required" | "manual_action" | "review_needed"
  title: string
  description: string            // context summary
  suggestedAction: string | null

  // Status
  status: "pending" | "in_progress" | "completed" | "dismissed"
  priority: "low" | "medium" | "high" | "urgent"

  // Context
  triggerReason: string          // "no_sales_closer_active", etc.
  sourceAgent: string | null
  fallbackReason: string | null  // "not_configured" | "paused" | "errored"

  dueAt: Date | null
  completedAt: Date | null
  createdAt: Date
}
```

### 2.5 ConversationThread — Changes

Thread retains conversation memory but loses sales pipeline authority.

**Remove:** `stage` field (was `ThreadStage`)
**Add:** `threadStatus: "open" | "waiting_on_customer" | "waiting_on_business" | "stale" | "closed"`
**Add:** `contactId` FK → Contact
**Add:** `opportunityId` FK → Opportunity (links thread to active opportunity)

Everything else stays: `agentContext`, `currentSummary`, `followUpSchedule`, `messageCount`, etc.

---

## 3. Stage Transitions & Validation

### 3.1 Opportunity Stage Transitions

Valid transitions defined as an explicitly enumerated directed graph. Forward skips are allowed only where explicitly listed. Backward moves are blocked except through re-engagement paths.

```
interested → qualified
interested → quoted          (skip: already qualified)
interested → booked          (skip: walk-in books directly)
interested → lost
interested → nurturing

qualified → quoted
qualified → booked           (skip: no formal quote needed)
qualified → lost
qualified → nurturing

quoted → booked
quoted → lost
quoted → nurturing

booked → showed
booked → lost
booked → nurturing

showed → won
showed → lost
showed → nurturing

nurturing → interested       (re-engage)
nurturing → qualified        (re-engage with prior context)
nurturing → lost             (give up)

lost → nurturing             (reactivate)
lost → interested            (full re-engage, subject to reopen policy)

won → (terminal, no transitions)
```

**Key rules:**

- `won` is terminal. Repeat purchase = new Opportunity.
- `lost → interested` subject to reopen policy: same service, within `reopenWindowDays` (skin-configurable, default 90). Beyond that = new Opportunity.
- Any non-terminal stage can move to `nurturing` or `lost`.
- `interested → showed` is NOT valid. Cannot skip booking.
- `qualified → won` is NOT valid. Must go through `booked → showed`.

**Implementation:** `validateTransition(from, to): { valid: boolean, reason?: string }` with an explicit lookup table.

### 3.2 Contact Stage Derivation

Contact stage is computed, never directly set. `refreshContactStage()` runs after every Opportunity stage change. See rules in Section 2.1.

`thresholdDays` is skin-configurable: clinic=60, fitness=14, reno=90.

### 3.3 ConversationThread Status Transitions

Operational, not commercial:

```
open → waiting_on_customer → open (customer replies)
open → waiting_on_business → open (agent/owner replies)
open → stale (no activity for threshold)
open → closed
stale → open (new message received)
closed → open (new message received)
waiting_on_customer → stale
waiting_on_business → stale
```

Thread status is updated by the system based on message direction and time thresholds. Thread does NOT auto-close on opportunity terminal — only closes when: opportunity terminal AND no inbound/outbound activity for stale threshold AND no pending OwnerTasks linked to thread.

### 3.4 OwnerTask Status Transitions

```
pending → in_progress (owner acknowledges)
pending → dismissed (owner dismisses)
pending → completed (auto-complete when replacement agent takes ownership AND emits first relevant action)
in_progress → completed
in_progress → dismissed
```

Auto-complete requires actual handoff, not mere agent availability.

---

## 4. ContactLifecycleService

Central authority for all lifecycle mutations. Lives in `packages/core/src/lifecycle/`.

```typescript
interface ContactLifecycleService {
  // Contact
  createContact(input: CreateContactInput): Promise<Contact>;
  getContact(orgId: string, contactId: string): Promise<Contact | null>;
  findContactByPhone(orgId: string, phone: string): Promise<Contact | null>;
  refreshContactStage(orgId: string, contactId: string): Promise<Contact>;

  // Opportunity
  createOpportunity(input: CreateOpportunityInput): Promise<Opportunity>;
  advanceOpportunityStage(
    orgId: string,
    opportunityId: string,
    toStage: OpportunityStage,
    advancedBy: string, // agentId, "owner", "system"
  ): Promise<{ opportunity: Opportunity; events: RoutedEventEnvelope[] }>;
  reopenOpportunity(
    orgId: string,
    opportunityId: string,
    toStage: "interested" | "qualified",
  ): Promise<Opportunity>;

  // Revenue
  recordRevenue(input: RecordRevenueInput): Promise<RevenueEvent>;

  // Query
  getPipeline(orgId: string): Promise<PipelineSnapshot>;
  getContactWithOpportunities(orgId: string, contactId: string): Promise<ContactDetail>;
}
```

### 4.1 advanceOpportunityStage() Flow

```
1. Load opportunity, validate transition (enumerated edge check)
2. If reopening from lost: check reopen policy (within reopenWindowDays)
3. Update opportunity.stage
4. If stage is "won": set closedAt
5. Refresh contact stage (derived)
6. Emit "opportunity.stage_advanced" event with { contactId, opportunityId, fromStage, toStage }
7. Return updated opportunity + emitted events
```

### 4.2 recordRevenue() Flow

```
1. Validate opportunityId exists
2. If opportunity stage is "showed": auto-advance to "won"
3. If opportunity stage is "booked" or earlier: record revenue but do NOT auto-advance (deposit/prepayment case)
4. Create RevenueEvent with inherited attribution from Contact
5. Update opportunity.revenueTotal (cached rollup)
6. Refresh contact stage
7. Emit "revenue.recorded" event
```

---

## 5. Fallback Handler

Lives in `packages/core/src/lifecycle/fallback-handler.ts`. Triggered when `AgentRouter` resolves an event to `manual_queue`.

### 5.1 Capability Mapping (lightweight config, not standalone abstraction)

```typescript
const STAGE_HANDLER_MAP: Record<OpportunityStage, StageHandlerConfig> = {
  interested: { preferredAgent: "lead-responder", fallbackType: "fallback_handoff" },
  qualified: { preferredAgent: "sales-closer", fallbackType: "fallback_handoff" },
  quoted: { preferredAgent: "sales-closer", fallbackType: "fallback_handoff" },
  booked: { preferredAgent: "system", fallbackType: "none" },
  showed: { preferredAgent: "revenue-tracker", fallbackType: "fallback_handoff" },
  won: { preferredAgent: "revenue-tracker", fallbackType: "fallback_handoff" },
  lost: { preferredAgent: "nurture", fallbackType: "fallback_handoff" },
  nurturing: { preferredAgent: "nurture", fallbackType: "fallback_handoff" },
};
```

`preferredAgent` typed as `string | string[]` for future priority-ordered lists.

### 5.2 FallbackHandler Interface

```typescript
interface FallbackHandler {
  handleUnrouted(event: RoutedEventEnvelope, context: FallbackContext): Promise<FallbackResult>;
}

interface FallbackContext {
  contact: Contact;
  opportunity: Opportunity | null;
  recentMessages: Message[];
  missingCapability: string;
}

interface FallbackResult {
  task: OwnerTask;
  notifications: FallbackNotification[];
}
```

### 5.3 What It Does

1. Determine what's missing (from `STAGE_HANDLER_MAP` cross-referenced with `AgentRegistry.listActive()`)
2. Determine fallback reason: `"not_configured" | "paused" | "errored"` from registry entry state
3. Build context summary from recent messages + opportunity state
4. Create OwnerTask with contextual title, description, priority, dueAt
5. Send notifications (dashboard push + WhatsApp to owner if configured)

### 5.4 Priority Derivation

| Opportunity Stage    | Estimated Value           | Priority |
| -------------------- | ------------------------- | -------- |
| `booked` or `showed` | any                       | `urgent` |
| `qualified`          | > skin.highValueThreshold | `high`   |
| `qualified`          | <= threshold              | `medium` |
| `interested`         | any                       | `low`    |
| no opportunity       | any                       | `low`    |

### 5.5 Fallback SLA (skin-configurable)

| Priority | Default Due Duration |
| -------- | -------------------- |
| `urgent` | 4 hours              |
| `high`   | 12 hours             |
| `medium` | 24 hours             |
| `low`    | 72 hours             |

---

## 6. Agent Routing Changes

### 6.1 Replace Thread-Stage Routing with Opportunity-Stage Routing

**Current:** `agentForThreadStage()` in `packages/agents/src/lifecycle.ts` maps thread stages to agents.
**New:** `agentForOpportunityStage()` uses `STAGE_HANDLER_MAP` + `AgentRegistry` to resolve preferred agent with fallback detection.

```typescript
function agentForOpportunityStage(
  stage: OpportunityStage,
  stageHandlerMap: StageHandlerMap,
  registry: AgentRegistry,
  orgId: string,
  threadStatus?: ThreadStatus,
): { agentId: string } | { fallback: true; missingAgent: string; reason: string };
```

**Secondary signal:** `threadStatus` is checked before dispatching. `waiting_on_customer` suppresses proactive outreach. `waiting_on_business` allows agent response. `stale` allows re-engagement.

### 6.2 Inbound Message Flow (New)

```
1. Inbound message for contactId
2. Load Contact (create if new)
3. Find primary opportunity (most recently updated non-terminal)
4. If no opportunity AND message is commercially relevant (inquiry/interest/pricing): create one
5. If no opportunity AND message is NOT commercially relevant: route to existing thread only
6. Route based on opportunity.stage using agentForOpportunityStage()
7. If preferred agent active → dispatch
8. If no preferred agent → FallbackHandler.handleUnrouted()
```

### 6.3 ConversationRouter Changes

`ConversationRouter.transform()` in `packages/agents/src/conversation-router.ts` currently uses `agentForThreadStage()`. Updated to:

1. Load Contact + active Opportunities via ContactLifecycleService
2. Use `agentForOpportunityStage()` instead of `agentForThreadStage()`
3. Set `metadata.opportunityId` alongside `metadata.targetAgentId`

### 6.4 Agent Changes

| Agent          | Before                                                  | After                                                                                     |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| LeadResponder  | Reads `thread.stage`, handles new/responding/qualifying | Handles opportunities in `interested`. Calls `advanceOpportunityStage("qualified")`.      |
| SalesCloser    | Handles qualified/closing                               | Handles opportunities in `qualified`/`quoted`. Calls `advanceOpportunityStage("booked")`. |
| Nurture        | Handles nurturing                                       | Handles opportunities in `nurturing`. Calls `reopenOpportunity()` on re-engagement.       |
| RevenueTracker | Listens for stage.advanced, revenue.recorded            | Listens for `opportunity.stage_advanced` to showed/won. Calls `recordRevenue()`.          |
| AdOptimizer    | Listens for revenue.attributed                          | Listens for `revenue.recorded`. Uses Contact attribution for campaign-level feedback.     |

### 6.5 New Event Type

`"opportunity.stage_advanced"` added to `AGENT_EVENT_TYPES`. Replaces `"stage.advanced"` as the primary lifecycle event. Both coexist during migration; `stage.advanced` deprecated after cutover.

### 6.6 EventLoop Integration

```
EventLoop receives event
  → AgentRouter.resolve(event)
  → if destinations include manual_queue:
      → FallbackHandler.handleUnrouted(event, context)
  → else:
      → dispatch to agents/connectors as normal
```

`manual_queue` is no longer a dead end — it triggers structured fallback.

---

## 7. Vertical Overlay Integration

### 7.1 Skin Extensions

Three new optional fields on `SkinManifest`:

```typescript
stageDefinitions: {
  [stage in OpportunityStage]?: {
    label: string              // "Appointment Confirmed" vs "Site Visit Scheduled"
    criteria: string           // human-readable description (NOT executable logic)
    typicalDuration: string    // "1-3 days" for SLA hints
  }
}

dormancyThresholdDays: number   // default 30
reopenWindowDays: number        // default 90

fallbackSLA: {
  [priority in TaskPriority]?: {
    dueDurationHours: number
  }
}
```

### 7.2 Vertical Differences

| Aspect             | Clinic                  | Fitness             | Reno                   |
| ------------------ | ----------------------- | ------------------- | ---------------------- |
| `qualified` label  | "Consultation Ready"    | "Trial Interested"  | "Briefing Complete"    |
| `quoted` label     | "Treatment Plan Sent"   | "Membership Quoted" | "Quote Sent"           |
| `booked` label     | "Appointment Confirmed" | "Trial Booked"      | "Site Visit Scheduled" |
| `showed` label     | "Patient Attended"      | "Trial Completed"   | "Consultation Done"    |
| `won` label        | "Treatment Completed"   | "Member Signed Up"  | "Project Contracted"   |
| Dormancy threshold | 60 days                 | 14 days             | 90 days                |
| Reopen window      | 90 days                 | 30 days             | 180 days               |

### 7.3 Dashboard Integration

API returns canonical stage names. Dashboard maps to display labels using org's skin config. All vertical logic stays in config, not code.

---

## 8. Data Store Changes

### 8.1 New Prisma Models

Four new models: `Contact`, `Opportunity`, `RevenueEvent`, `OwnerTask` (see Section 2 for full field specs).

Key indexes:

- Contact: `[organizationId]`, `[organizationId, stage]`, `[organizationId, phone]`, `[organizationId, lastActivityAt]`
- Opportunity: `[organizationId]`, `[organizationId, stage]`, `[contactId]`
- RevenueEvent: `[organizationId]`, `[opportunityId]`, `[organizationId, recordedAt]`
- OwnerTask: `[organizationId, status]`, `[organizationId, priority]`

### 8.2 ConversationThread Model Changes

**Add:** `contactId String?`, `opportunityId String?`, `threadStatus String @default("open")`
**Remove (after migration):** `stage` field

### 8.3 Store Interfaces

New interfaces in `packages/core/src/lifecycle/`:

- `ContactStore` — CRUD + findByPhone + updateStage + list with filters
- `OpportunityStore` — CRUD + findByContact + findActiveByContact + updateStage + updateRevenueTotal
- `RevenueStore` — record + findByOpportunity + sumByOrg + sumByCampaign
- `OwnerTaskStore` — create + findPending + updateStatus + autoComplete

Prisma implementations in `packages/db/src/stores/`.

### 8.4 Existing Schema Note

`packages/schemas/src/revenue-event.ts` already exists with a simpler `RevenueEvent` schema. The new lifecycle `RevenueEvent` extends this with `opportunityId`, `status`, `verified`, `sourceCampaignId`, `sourceAdId`. The existing schema is renamed to `LegacyRevenueEvent` and a new `LifecycleRevenueEvent` schema is created in `packages/schemas/src/lifecycle.ts`.

---

## 9. Migration Plan

### Phase 1: Additive (no breaking changes)

1. New Prisma models (Contact, Opportunity, LifecycleRevenueEvent, OwnerTask)
2. Add `contactId`, `opportunityId`, `threadStatus` to ConversationThread (nullable)
3. Implement store interfaces + Prisma stores
4. Implement ContactLifecycleService + FallbackHandler

### Phase 2: Wire up (parallel operation)

5. EventLoop emits `opportunity.stage_advanced` alongside `stage.advanced`
6. Add `agentForOpportunityStage()` alongside `agentForThreadStage()`
7. ConversationRouter updated to use new routing (feature flag per org)
8. Agents updated to read opportunity.stage and call advanceOpportunityStage()

### Phase 3: Cutover

9. Remove `agentForThreadStage()`
10. Remove `stage` field from ConversationThread
11. Deprecate `stage.advanced` event type
12. Data migration: backfill Contact + Opportunity from existing Thread + LeadProfile data

**Thread stage → Opportunity stage mapping for migration:**

- new/responding → interested
- qualifying → interested
- qualified → qualified
- closing → qualified
- won → won
- lost → lost
- nurturing → nurturing
