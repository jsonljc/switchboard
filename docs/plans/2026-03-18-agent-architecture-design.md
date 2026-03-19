# Agent Architecture Design — Closed-Loop Lead Gen Operating System

## USP

The only lead gen platform where your ad spend automatically gets smarter because we tell Meta and Google which leads actually paid you.

**Founder mental model:** "Hire AI employees for each step of your funnel."

**Product rule:** Complex system underneath, simple mental model on top.

---

## Agent Model

Five hireable AI agents, each handling a stage of the closed-loop funnel:

| Agent           | Stage           | What it does                                                               |
| --------------- | --------------- | -------------------------------------------------------------------------- |
| Lead Responder  | Leads/Messages  | Instant response, qualification, FAQ, objection handling                   |
| Sales Closer    | Conversion      | Drives qualified leads to book/purchase/quote (profile-driven)             |
| Nurture Agent   | Post-conversion | Reminders, follow-ups, reactivation, review solicitation                   |
| Ad Optimizer    | Ads             | Budget optimization, campaign management, conversion feedback to platforms |
| Revenue Tracker | Attribution     | Tracks revenue per campaign, builds attribution reports, closes the loop   |

### Entry Point

Lead Responder is the wedge — founders hire it first for instant lead response, then expand to the full funnel.

### Not All Businesses Have the Same Flow

Service businesses (clinic, gym) have a booking-based funnel. Commerce businesses (furniture, supplements) have a purchase-based funnel. The canonical events stay generic; the business profile defines the specific journey stages and what "convert" means.

Profile config drives the difference:

- `journey.stages[]` — the specific stages for this business
- `journey.conversionStage` — what counts as a conversion
- `conversionActions.type` — "booking" | "checkout_link" | "quote" | "test_drive"

---

## Canonical Objects & Events

### Objects (in `packages/schemas`)

| Object        | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| Lead          | Raw inbound signal with click IDs (fbclid/gclid/ttclid)   |
| QualifiedLead | Lead + score, tier, signals, service interest             |
| Booking       | Confirmed appointment with attribution chain              |
| RevenueEvent  | Money changed hands — amount, stage, attribution          |
| Attribution   | Per-campaign rollup: leads, bookings, paid, revenue, ROAS |

### Events

```
lead.received           — entry point
lead.qualified          — scored and tiered
lead.disqualified       — dead end or manual review
stage.advanced          — moved to next stage (stage name from profile)
stage.reverted          — moved backward
revenue.recorded        — money event
revenue.attributed      — rollup computed
ad.optimized            — budget/campaign action taken
conversation.escalated  — human needed
```

Every event carries the full attribution chain (click IDs, campaign IDs, source).

---

## Architecture (Approach B → graduating to C)

### Approach B: Agent layer on top of existing cartridges

Keep `digital-ads`, `customer-engagement`, `crm` as-is. Add `packages/agents` as a thin orchestration layer that wraps existing cartridge logic and exposes it through standard port interfaces.

### Graduation to C

Once the agent layer is proven, gradually migrate cartridge code into agent packages. The port interface design matters more than the directory structure.

---

## Agent Port Interface

```typescript
interface AgentPort {
  agentId: string;
  version: string;
  inboundEvents: string[];
  outboundEvents: string[];
  tools: ToolDeclaration[];
  configSchema: ZodSchema;
  conversionActionTypes?: string[];
}
```

Each agent declares what events it accepts, emits, and what tools it provides to OpenClaw.

---

## Agent Registry

```typescript
interface AgentRegistryEntry {
  agentId: string;
  version: string;
  installed: boolean;
  status: "draft" | "active" | "paused" | "error" | "disabled";
  config: Record<string, unknown>;
  capabilities: {
    accepts: string[];
    emits: string[];
    tools: string[];
  };
  runtime?: {
    provider: "openclaw";
    sessionId?: string;
    health?: "healthy" | "degraded" | "offline";
    lastHeartbeatAt?: string;
  };
  lastActiveAt?: string;
}
```

---

## Event Envelope

Every routed event carries identity, attribution, and idempotency metadata:

```typescript
interface RoutedEventEnvelope<TPayload = unknown> {
  eventId: string;
  organizationId: string;
  eventType: string;
  occurredAt: string;
  source: {
    type: "agent" | "connector" | "webhook" | "manual" | "system";
    id: string;
  };
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  attribution?: AttributionChain;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
```

---

## Router — Destination Resolution (not priority routing)

The router resolves all subscribed destinations for an event and produces a route plan:

```typescript
interface ResolvedDestination {
  type: "agent" | "connector" | "webhook" | "manual_queue" | "system";
  id: string;
  criticality: "required" | "optional" | "best_effort";
  sequencing: "parallel" | "after_success" | "blocking";
  afterDestinationId?: string;
}

interface RoutePlan {
  event: RoutedEventEnvelope;
  destinations: ResolvedDestination[];
}
```

Destination types: agent, connector, webhook, manual queue, internal system sinks (audit, analytics, attribution).

---

## Dispatch Pipeline

```
event emitted
  -> router resolves destinations (produces RoutePlan)
  -> each destination becomes a DeliveryIntent
  -> policy engine evaluates each intent
  -> approved intents dispatch (per destination type)
  -> delivery store tracks each attempt per-destination
  -> failures retry per-destination (not per-event)
  -> dead letters surface in dashboard
  -> all results audited
```

### Delivery Intent

```typescript
interface DeliveryIntent {
  eventId: string;
  destinationType: "agent" | "connector" | "webhook" | "manual_queue";
  destinationId: string;
  action: string;
  payload: unknown;
  criticality: "required" | "optional" | "best_effort";
}
```

### Per-Destination Delivery Tracking

```typescript
interface DeliveryAttempt {
  eventId: string;
  destinationId: string;
  status: "pending" | "dispatched" | "succeeded" | "failed" | "retrying" | "dead_letter";
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}
```

### Manual Queue as First-Class Destination

Distinct states: `manual_review`, `human_approval`, `needs_configuration`, `failed_after_retries`, `blocked_by_policy`.

---

## Governance

The router decides destinations. The policy engine decides whether each delivery intent is allowed. The dispatcher executes only approved deliveries. Governance evaluates delivery intents, not events.

---

## Agent Wrappers

Each agent is a thin handler that wraps existing cartridge logic:

- **Lead Responder** wraps `customer-engagement` conversation engine, lead scoring, FAQ/objection handling
- **Sales Closer** wraps `customer-engagement` booking actions, calendar providers; reads `profile.conversionActions.type` to know what "close" means
- **Nurture Agent** wraps `customer-engagement` cadence engine, retention, reminder/review actions
- **Ad Optimizer** wraps `digital-ads` advisors, campaign mutations, CAPI/Google dispatchers
- **Revenue Tracker** wraps campaign-attribution query, multi-touch attribution engine, ConversionBus

---

## Runtime: OpenClaw as Substrate

OpenClaw provides: sessions, tool use, memory, channel routing, sub-agent spawning.

Switchboard provides: policy engine, risk scoring, approval gates, cartridge routing, rollback/undo, audit log, deterministic state machines, cross-agent task contracts.

OpenClaw is the execution substrate. Switchboard is the orchestrator. Runtime-specific info wrapped under `runtime` object for portability.

---

## Integration Model

### When founders have existing tools

1. Hired agent with matching inbound event -> route to OpenClaw agent
2. Native connector configured -> bidirectional sync (HubSpot, Calendly, Stripe)
3. Webhook configured -> POST to URL with HMAC signature
4. None of the above -> queue in dashboard for manual action

Fan-out is default — one event can go to multiple destinations with different criticality levels.

### Webhook-first, then native connectors

Standard port interface + canonical events. Webhooks as universal boundary. Native connectors for top systems where deeper sync and attribution preservation matter.

---

## Codebase Structure

```
packages/agents/
  src/
    ports.ts
    events.ts
    registry.ts
    router.ts
    route-plan.ts
    policy-bridge.ts
    dispatch/
      agent-dispatcher.ts
      connector-dispatcher.ts
      webhook-dispatcher.ts
      manual-dispatcher.ts
    delivery-store.ts
    retry-manager.ts
    dead-letter.ts
    agents/
      lead-responder/
        index.ts
        handler.ts
        tools.ts
        config.ts
      sales-closer/
        ...
      nurture/
        ...
      ad-optimizer/
        ...
      revenue-tracker/
        ...
```

Layer 3 in dependency hierarchy (same as `core`): imports from `schemas` and `core`, not from individual agents or apps.

---

## Build Phases

### Phase 1: Close existing wiring gaps (DONE)

- CAPIDispatcher wiring in chat standalone mode
- Silence detector startup
- Revenue in weekly digest (partial)

### Phase 2: Agent infrastructure foundation

- Event envelope + canonical events
- Agent port interface
- Router (destination resolution -> RoutePlan)
- Policy bridge (DeliveryIntent evaluation)
- Dispatchers (agent, webhook, manual)
- Delivery store + retry manager
- Agent registry + hire API

### Phase 3: External connectivity

- Webhook destination management (CRUD + dispatcher)
- Inbound revenue webhooks
- TikTok offline conversions dispatcher

### Phase 4: Land-and-expand

- Native connector framework
- HubSpot connector (first)
- Dashboard hero screen (ad-to-revenue visualization)

---

## Founder-Facing Experience

**"Your AI Team"** — Choose which parts of your funnel Switchboard handles.

**"Works With What You Already Use"** — Plug in HubSpot, Calendly, Stripe. No tools? Switchboard runs natively.

**"Only Escalates What Needs You"** — Items needing human decisions appear in dashboard. Everything else runs automatically.

**"Your ads get smarter"** — Real revenue signals feed back to ad platforms so they optimize for paying customers.
