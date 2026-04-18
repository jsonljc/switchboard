# Revenue Loop Closure — Design Spec

**Date:** 2026-04-18
**Status:** Approved
**Approach:** Agent-Driven Booking (Approach A)
**Revision:** 2 — aggressive simplification pass

## Problem

Switchboard captures and qualifies leads through 4 channel adapters, but cannot book appointments, cannot durably propagate outcome events, has partial attribution (Meta CAPI only, no Google), and has no way to show SMB owners that the system is making them money. The revenue loop is open.

## Sequencing

1. **Calendar / Booking Integration** — creates the outcome
2. **Durable ConversionBus + Outbox** — preserves the outcome
3. **Attribution Completion** — connects the outcome to spend
4. **ROI Dashboard** — makes the value legible

## Core Invariant

**Every business outcome enters the system as a canonical ConversionEvent first.** Everything downstream is a projection:

- `ConversionRecord` — dashboard-optimized read model
- `DispatchLog` — delivery projection (CAPI, Google)
- CRM stage update — state projection
- `ReconciliationReport` — health projection

No dashboard, attribution, or CRM stage logic reads `Booking` directly except reconciliation checks. Operational truth for funnel progression is the ConversionEvent stream and its persisted `ConversionRecord` projection.

`RevenueStore` exists for legacy financial workflows only. It is not a display source for the ROI page. Future direction: deprecate once `ConversionRecord` covers all revenue tracking needs.

---

## Section 1: Calendar Provider + Google Calendar Adapter

### CalendarProvider Interface

New file: `packages/schemas/src/calendar.ts` (Layer 1, no deps).

```typescript
export interface CalendarProvider {
  listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  cancelBooking(bookingId: string, reason?: string): Promise<void>;
  rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking | null>;
  healthCheck(): Promise<CalendarHealthCheck>;
}
```

### Zod Schemas

```typescript
SlotQuery {
  dateFrom: string (ISO 8601)
  dateTo: string (ISO 8601)
  durationMinutes: number
  service: string
  timezone: string
  bufferMinutes?: number (default 15)
}

TimeSlot {
  start: string (ISO 8601)
  end: string (ISO 8601)
  calendarId: string
  available: boolean
}

BookingStatus = "pending_confirmation" | "confirmed" | "cancelled" | "no_show" | "completed"
// No "rescheduled" status. Reschedule updates times on existing booking.

Booking {
  id: string
  contactId: string
  organizationId: string
  opportunityId?: string
  slot: TimeSlot
  service: string
  status: BookingStatus
  calendarEventId?: string
  attendeeName?: string
  attendeeEmail?: string
  notes?: string
  createdByType: "agent" | "human" | "contact"
  sourceChannel?: string
  workTraceId?: string
  rescheduledAt?: string
  rescheduleCount?: number
}

CreateBookingInput {
  contactId: string
  organizationId: string
  opportunityId?: string
  slot: TimeSlot
  service: string
  attendeeName?: string
  attendeeEmail?: string
  notes?: string
  createdByType: "agent" | "human" | "contact"
  sourceChannel?: string
  workTraceId?: string
}

BusinessHoursConfig {
  timezone: string
  days: Array<{
    day: 0-6 (Sun-Sat)
    open: string (HH:mm)
    close: string (HH:mm)
  }>
  defaultDurationMinutes: number
  bufferMinutes: number
  slotIncrementMinutes: number (default 30)
}

CalendarHealthCheck {
  status: "connected" | "disconnected" | "degraded"
  latencyMs: number
  error?: string
}
```

### Google Calendar Adapter

New file: `packages/core/src/calendar/google-calendar-adapter.ts`

- Uses Google Calendar API v3 (`googleapis` package)
- `listAvailableSlots` → FreeBusy API to find occupied slots, then generates available slots within business hours, applying duration + buffer constraints
- `createBooking` → Events.insert with attendee, 30-min reminder
- `cancelBooking` → Events.delete
- `rescheduleBooking` → Events.patch (updates times on same event, increments `rescheduleCount`, sets `rescheduledAt`)
- OAuth credentials via existing Connection model: `serviceId: "google_calendar"`, `authType: "oauth2"`, scopes: `calendar.events`, `calendar.readonly`

### Business Hours Config

Stored in `OrganizationConfig.businessHours` (JSON field on existing model). Explicit `BusinessHoursConfig` Zod schema validated on write. Defaults to Mon-Fri 09:00-17:00 in org timezone if not set.

### Skill Tool

New file: `packages/core/src/skill-runtime/tools/calendar-book.ts`

| Operation        | Governance Tier  | Idempotent | Idempotency Key                           | Description                            |
| ---------------- | ---------------- | ---------- | ----------------------------------------- | -------------------------------------- |
| `slots.query`    | `read`           | yes        | n/a                                       | Query available slots for a date range |
| `booking.create` | `external_write` | yes        | `orgId + contactId + service + slotStart` | Book a slot                            |

Cancel and reschedule are deferred from v1 wedge scope. The agent books. That is the wedge.

### Booking Flow (Outbox Pattern)

The booking tool does exactly three things, then stops. Everything else is downstream fan-out.

On `booking.create`:

```
1. Persist Booking with status: "pending_confirmation"
2. Call CalendarProvider.createBooking() → Google Calendar event
3. On failure: Booking stays "pending_confirmation", agent retries or escalates

On calendar success:
BEGIN TRANSACTION
  4. Update Booking status to "confirmed", set calendarEventId
  5. Write OutboxEvent { type: "booked", payload: { contactId, opportunityId, value, ... } }
COMMIT
```

The outbox event is written only after calendar confirmation, never before. This guarantees that a "booked" ConversionEvent is never published for a booking that didn't actually succeed in the calendar. The OutboxPublisher (background) picks up the OutboxEvent and emits it to the durable ConversionBus — no gap between confirmed booking and event publication.

**The booking tool does NOT:**

- Update CRM stage (that's the `crm-updater` consumer's job)
- Write ConversionRecord (that's the `attribution-store` consumer's job)
- Dispatch to CAPI/Google (that's the dispatcher consumers' job)

One rule: **everything after "booked event emitted" is downstream fan-out.**

**Payload contract:** The outbox event payload MUST include `opportunityId` whenever CRM stage sync is expected. The `crm-updater` consumer skips events without `opportunityId` rather than failing. The booking tool resolves `opportunityId` from the contact's active opportunity before writing the outbox event — if no opportunity exists, it creates one via existing `OpportunityStore` before the confirmation transaction.

### Outbox Model

```prisma
model OutboxEvent {
  id              String   @id @default(uuid())
  eventId         String   @unique
  type            String
  payload         Json
  status          String   @default("pending")  // pending | published | failed
  attempts        Int      @default(0)
  lastAttemptAt   DateTime?
  createdAt       DateTime @default(now())

  @@index([status, createdAt])
}
```

### OutboxPublisher

New file: `packages/core/src/events/outbox-publisher.ts`

Polls `OutboxEvent` where `status = "pending"` every 1 second. For each:

1. Deserialize payload into `ConversionEvent`
2. Emit to `ConversionBus`
3. On success: mark `status = "published"`
4. On failure: increment `attempts`, set `lastAttemptAt`. After 10 failures: mark `status = "failed"`, log error.

In dev/test, the publisher can run in-process. In production, it runs as a lightweight loop in the API server process.

### Prisma Model — Booking

```prisma
model Booking {
  id                String    @id @default(uuid())
  organizationId    String
  contactId         String
  opportunityId     String?
  calendarEventId   String?
  service           String
  startsAt          DateTime
  endsAt            DateTime
  timezone          String    @default("Asia/Singapore")
  status            String    @default("pending_confirmation")
  attendeeName      String?
  attendeeEmail     String?
  connectionId      String?
  createdByType     String    @default("agent")
  sourceChannel     String?
  workTraceId       String?
  rescheduledAt     DateTime?
  rescheduleCount   Int       @default(0)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([organizationId, startsAt])
  @@index([contactId])
  @@index([status])
}
```

Removed from previous revision: `cancelledAt`, `cancelReason`, `conferenceLink` (not needed for wedge).

### Channel UX

Agent presents 3-5 available slots as native interactive elements:

- **Telegram:** inline keyboard buttons
- **WhatsApp:** interactive list message (up to 10 sections)
- **Slack:** block kit with button actions
- **Instagram:** quick replies

Contact taps a slot. Agent confirms and books. No context switch.

### Explicit Non-Scope

- Team/resource scheduling (one calendar per org for v1)
- Recurring appointments
- Multi-timezone team availability
- Calendly/Cal.com adapter (same interface, later)
- Booking link fallback (later)
- Cancel/reschedule flows in UI (deferred — agent books, that's the wedge)
- Google Meet link generation (deferred)
- Bookings management API (no public CRUD routes for bookings in v1)

---

## Section 2: Durable ConversionBus

### Problem

`InMemoryConversionBus` loses events on process restart. For the revenue loop, every `"booked"` and `"purchased"` event must survive crashes and reach all subscribers.

### Implementation: Redis Streams + Consumer Groups

New file: `packages/core/src/events/redis-stream-conversion-bus.ts`

Redis is already in the stack (dedup, guardrails). Redis Streams with consumer groups provides ordered, persistent, multi-consumer fan-out with acknowledgment and pending-entry tracking.

### ConversionEvent

```typescript
interface ConversionEvent {
  eventId: string; // uuid, application-level dedup
  type: ConversionStage; // strongly typed enum
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date; // standardized timestamp field name
  source: string; // e.g. "calendar-book", "revenue-api", "lead-handler"
  causationId?: string; // links to triggering work unit
  workTraceId?: string; // links to WorkTrace
  metadata: Record<string, unknown>;
}
```

### Stream Structure

- Single stream: `switchboard:conversions`
- Consumer groups (one per durable downstream system, scale-out via multiple consumers within each group):
  - `ad-dispatch-meta` — Meta CAPI feedback
  - `ad-dispatch-google` — Google Ads offline conversions
  - `attribution-store` — ConversionRecord persistence
  - `crm-updater` — CRM stage updates (previously in booking tool, now downstream)

### Event Lifecycle

1. **Emit** — `XADD switchboard:conversions * type booked eventId abc ...` (JSON fields)
2. **Read** — `XREADGROUP GROUP <name> <consumer> BLOCK 5000 COUNT 10`
3. **Process** — handler runs → `XACK` on success
4. **Retry** — unacked messages reclaimed via `XAUTOCLAIM` every 30s
5. **DLQ** — after max failed attempts, move to `switchboard:conversions:dlq` stream

### Error Classification

Handler errors classified before DLQ decision:

- **Transient** (network, timeout, rate limit) → retry with exponential backoff, max 5 attempts per consumer group (configurable)
- **Permanent** (validation, malformed payload) → DLQ immediately, 0 retries

### Retention

Consumer-aware trimming: periodic sweep checks `XPENDING` per group before trimming. Only entries where all consumer groups have acked are eligible. `MAXLEN ~10000` is a safety ceiling, not the primary retention control.

### Production Behavior

`CONVERSION_BUS_BACKEND` environment variable:

- `redis` (production) — fail closed on Redis unavailability. `emit()` returns rejected promise; caller (OutboxPublisher) retries. Events are never silently dropped.
- `memory` (dev/test) — `InMemoryConversionBus`, unchanged behavior.

No in-memory fallback in production.

### Wire-Up Changes

- `apps/api/src/bootstrap/conversion-bus-wiring.ts` — create `RedisStreamConversionBus` when `CONVERSION_BUS_BACKEND=redis`, start consumer groups for all four downstream systems, start OutboxPublisher
- `apps/chat/src/bootstrap.ts` — same swap, start `crm-updater` consumer group (closes gap identified in audit: chat app bus was unwired)

### Test Compatibility

- `InMemoryConversionBus` unchanged for unit tests
- New integration tests for `RedisStreamConversionBus`
- `ConversionBus` interface unchanged — all existing subscribers work without modification

---

## Section 3: Attribution Completion

Three pieces: event persistence, unified ad dispatchers, and reconciliation.

### 3A. Strongly Typed Funnel Stages

New file: `packages/schemas/src/conversion.ts`

```typescript
export const ConversionStageSchema = z.enum([
  "inquiry",
  "qualified",
  "booked",
  "purchased",
  "completed",
]);
export type ConversionStage = z.infer<typeof ConversionStageSchema>;
```

Single source of truth. Used by `ConversionEvent`, `ConversionRecord`, and dashboard queries.

### 3B. ConversionRecord Store (Attribution Persistence)

The `attribution-store` consumer group persists every ConversionEvent to a queryable table.

#### Prisma Model

```prisma
model ConversionRecord {
  id                String   @id @default(uuid())
  eventId           String   @unique
  organizationId    String
  contactId         String
  type              String
  value             Float    @default(0)
  sourceAdId        String?
  sourceCampaignId  String?
  sourceChannel     String?
  agentDeploymentId String?
  metadata          Json     @default("{}")
  occurredAt        DateTime
  createdAt         DateTime @default(now())

  @@index([organizationId, type, occurredAt])
  @@index([organizationId, sourceCampaignId])
  @@index([contactId])
}
```

`type` column stores `ConversionStage` values. Enforced by application-layer validation on write, not DB enum (allows zero-downtime stage additions).

#### Store Interface

New file: `packages/core/src/attribution/conversion-record-store.ts`

```typescript
interface ConversionRecordStore {
  record(event: ConversionEvent): Promise<void>;
  funnelByOrg(orgId: string, dateRange: DateRange): Promise<FunnelCounts>;
  funnelByCampaign(orgId: string, dateRange: DateRange): Promise<CampaignFunnel[]>;
  funnelByChannel(orgId: string, dateRange: DateRange): Promise<ChannelFunnel[]>;
  funnelByAgent(orgId: string, dateRange: DateRange): Promise<AgentFunnel[]>;
}

type FunnelCounts = {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
  period: DateRange;
};

type CampaignFunnel = FunnelCounts & { campaignId: string };
type ChannelFunnel = FunnelCounts & { channel: string };
type AgentFunnel = FunnelCounts & { deploymentId: string; deploymentName: string };
```

`record()` is idempotent via `eventId` unique constraint.

### 3C. Unified Ad Conversion Dispatcher

New file: `packages/core/src/ad-optimizer/ad-conversion-dispatcher.ts`

```typescript
interface AdConversionDispatcher {
  readonly platform: string; // "meta_capi" | "google_offline"
  canDispatch(event: ConversionEvent): boolean;
  dispatch(event: ConversionEvent): Promise<DispatchResult>;
}

type DispatchResult = {
  accepted: boolean;
  errorMessage?: string;
  responsePayload?: unknown;
};
```

Two implementations:

**MetaCAPIDispatcher** (refactored from existing `MetaCAPIClient` + wiring):

- `canDispatch` → checks `event.sourceAdId` or `event.metadata.fbclid`
- `dispatch` → hashes PII, posts to Graph API, logs to DispatchLog

**GoogleOfflineDispatcher** (new):

- `canDispatch` → checks `event.metadata.gclid`
- `dispatch` → uploads via Google Ads API v17 `ConversionUploadService.uploadClickConversions`, logs to DispatchLog
- Conversion action mapping stored per-connection in `Connection.credentials` JSON:
  ```json
  { "conversionActionMapping": { "booked": "customers/123/conversionActions/456" } }
  ```
  Per-org, per-connected-Google-Ads-account. Default mapping if not configured.

**Bus wiring becomes declarative:**

```typescript
export function wireAdDispatchers(bus: ConversionBus, dispatchers: AdConversionDispatcher[]): void {
  bus.subscribe("*", async (event) => {
    for (const d of dispatchers) {
      if (!d.canDispatch(event)) continue;
      const result = await d.dispatch(event);
      await dispatchLogStore.record({
        eventId: event.eventId,
        platform: d.platform,
        status: result.accepted ? "accepted" : "rejected",
        errorMessage: result.errorMessage,
        responsePayload: result.responsePayload,
      });
    }
  });
}
```

Adding TikTok or another platform later = implement `AdConversionDispatcher`, register it.

Connection for Google: `serviceId: "google_ads"`, `authType: "oauth2"`, scope: `https://www.googleapis.com/auth/adwords`.

### 3D. Dispatch Log

```prisma
model DispatchLog {
  id              String   @id @default(uuid())
  eventId         String
  platform        String
  status          String
  errorMessage    String?
  responsePayload Json?
  attemptedAt     DateTime @default(now())

  @@index([eventId])
  @@index([platform, status, attemptedAt])
}
```

`platform`: `meta_capi` | `google_offline`
`status`: `sent` | `accepted` | `rejected` | `failed`

### 3E. CRM Updater Consumer

New file: `packages/core/src/attribution/crm-updater-consumer.ts`

Subscribes to the durable ConversionBus. On receiving a `"booked"` event:

- Calls `opportunityStore.updateStage(orgId, opportunityId, "booked")` (existing method)
- Logs activity via `activityStore.write()`

This is the same logic that was previously synchronous in the booking tool — now downstream.

### 3F. Reconciliation Runner

New file: `packages/core/src/attribution/reconciliation-runner.ts`

Periodic health check that verifies event delivery across the attribution pipeline.

| Check                   | Source                               | Comparison                           | Alert         |
| ----------------------- | ------------------------------------ | ------------------------------------ | ------------- |
| Outbox → bus            | OutboxEvent (published) count        | ConversionRecord count               | Drift > 1%    |
| Dispatch (per platform) | ConversionRecord (platform-eligible) | DispatchLog success count            | Success < 95% |
| Booking linkage         | Booking count (confirmed)            | ConversionRecord type "booked" count | Drift > 0     |
| CRM sync                | ConversionRecord type "booked"       | Opportunity stage "booked" count     | Drift > 0     |

#### ReconciliationReport Model

```prisma
model ReconciliationReport {
  id              String   @id @default(uuid())
  organizationId  String
  dateRangeFrom   DateTime
  dateRangeTo     DateTime
  overallStatus   String
  checks          Json
  createdAt       DateTime @default(now())

  @@index([organizationId, createdAt])
}
```

`overallStatus`: `healthy` | `degraded` | `failing`
`checks`: array of `{ name, status, expected, actual, driftPercent }`

Scheduled via existing `SchedulerService` as a daily cron (06:00 org timezone). Reports durably stored for historical trend.

### Explicit Non-Scope

- Real-time reconciliation (daily batch sufficient)
- Automatic remediation (report-only)
- Ad spend ingestion / ROAS calculation (deferred)

---

## Section 4: ROI Dashboard

### Purpose

One page that answers: "Is my AI agent making me money, and where is it coming from?"

Not an analytics product. A focused revenue proof.

### Page: `/dashboard/roi`

New file: `apps/dashboard/src/app/(auth)/dashboard/roi/page.tsx`

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [7d] [30d] [90d] [Custom]              Data Health: ●  │
├─────────────────────────────────────────────────────────┤
│  HEADLINE METRICS                                       │
│  Leads | Qualified | Booked | Revenue | Booking Rate    │
│  (count) (count+%)  (count+%) ($total)  (%)             │
├─────────────────────────────────────────────────────────┤
│  FUNNEL (horizontal bars with counts and stage-over-    │
│  stage conversion rates)                                │
├─────────────────────────────────────────────────────────┤
│  BREAKDOWN  [By Campaign] [By Channel]                  │
│  Table: Name | Leads | Qualified | Booked | Revenue |   │
│              Booking Rate                               │
│  Sorted by Revenue desc (or Booked if revenue sparse)   │
└─────────────────────────────────────────────────────────┘
```

### Data Source

All numbers come from `ConversionRecordStore` exclusively. `RevenueStore` is not a display source. Headline totals and breakdown subtotals always match because they query the same table.

### Headline Metrics

| Metric       | Source                       | Computation               |
| ------------ | ---------------------------- | ------------------------- |
| Leads        | `funnelByOrg().inquiry`      | Count                     |
| Qualified    | `funnelByOrg().qualified`    | Count + rate from inquiry |
| Booked       | `funnelByOrg().booked`       | Count + rate from inquiry |
| Revenue      | `funnelByOrg().totalRevenue` | Currency total            |
| Booking Rate | Derived                      | `booked / inquiry * 100`  |

Zero-event stages show "—" instead of 0%.

### Funnel Visualization

Horizontal bars using shadcn/ui `Progress` component. Each bar: count + conversion rate from previous stage. No charting library for v1.

### Breakdown Tables

Two tabs: **By Campaign**, **By Channel**. These are owner-legible dimensions.

"By Agent" is available under a "Details" expandable section — it's an internal/debug dimension, not a hero owner view. Most SMB owners don't think in terms of agent deployments.

Columns: Name | Leads | Qualified | Booked | Revenue | Booking Rate.

Sorted by Revenue descending when revenue exists; by Booked count when revenue is sparse.

- By Campaign → `funnelByCampaign()`, keyed by `sourceCampaignId`
- By Channel → `funnelByChannel()`, keyed by `sourceChannel`
- By Agent (details) → `funnelByAgent()`, keyed by `agentDeploymentId`, display `AgentDeployment.name`

### Data Health Indicator

Top-right corner dot from latest `ReconciliationReport`:

- **Green** — all checks passed, drift < 1%
- **Yellow** — 1-5% drift, or last reconciliation > 36h ago
- **Red** — drift > 5%, or reconciliation failed, or never run

Click opens popover with plain-English status per check:

- "All conversion events delivered successfully"
- "2 of 847 events failed to reach Google Ads in the last 24 hours"
- "Reconciliation has not run in 48 hours — numbers may be stale"

### API

Single aggregate endpoint. This page is one product surface — it doesn't need a mini analytics API.

**Backend:** `apps/api/src/routes/roi.ts`

```
GET /api/:orgId/roi/summary?from=ISO&to=ISO&breakdown=campaign|channel|agent
```

Returns:

```typescript
{
  funnel: FunnelCounts;
  breakdown: CampaignFunnel[] | ChannelFunnel[] | AgentFunnel[];
  health: { status: string; lastRun: string; checks: Check[] };
}
```

Default date range: last 30 days. Default breakdown: `campaign`.

**Dashboard proxy:** `apps/dashboard/src/app/api/dashboard/roi/route.ts` — single proxy route.

### Hook

`apps/dashboard/src/hooks/use-roi.ts`:

```typescript
function useRoiSummary(
  dateRange: DateRange,
  breakdown: "campaign" | "channel" | "agent",
): UseQueryResult<RoiSummary>;
```

Single hook, single request, single cache entry. TanStack React Query, `staleTime: 5 minutes`.

### Explicit Non-Scope

- Charting library (Progress bars + tables sufficient for v1)
- ROAS column (requires ad spend ingestion)
- Trend lines / period-over-period comparison
- Export to CSV/PDF
- Per-contact journey drill-down
- Real-time streaming updates
- Multiple API endpoints (one aggregate is enough for v1)

---

## New Prisma Models Summary

| Model                  | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `Booking`              | Calendar bookings with provenance                        |
| `OutboxEvent`          | Transactional outbox for guaranteed event publication    |
| `ConversionRecord`     | Durable funnel event persistence for attribution queries |
| `DispatchLog`          | CAPI / Google Offline delivery tracking                  |
| `ReconciliationReport` | Persisted reconciliation health reports                  |

## New Files Summary

### packages/schemas/src/

- `calendar.ts` — CalendarProvider interface, SlotQuery, TimeSlot, Booking, BusinessHoursConfig schemas
- `conversion.ts` — ConversionStage enum (single source of truth)

### packages/core/src/

- `calendar/google-calendar-adapter.ts` — Google Calendar API v3 adapter
- `calendar/google-calendar-adapter.test.ts`
- `events/redis-stream-conversion-bus.ts` — Durable ConversionBus implementation
- `events/redis-stream-conversion-bus.test.ts`
- `events/outbox-publisher.ts` — Polls OutboxEvent, emits to ConversionBus
- `events/outbox-publisher.test.ts`
- `attribution/conversion-record-store.ts` — Store interface + FunnelCounts types
- `attribution/crm-updater-consumer.ts` — CRM stage update as bus consumer
- `attribution/crm-updater-consumer.test.ts`
- `attribution/reconciliation-runner.ts` — Daily reconciliation checks
- `attribution/reconciliation-runner.test.ts`
- `ad-optimizer/ad-conversion-dispatcher.ts` — Shared dispatcher interface
- `ad-optimizer/meta-capi-dispatcher.ts` — Refactored from MetaCAPIClient
- `ad-optimizer/meta-capi-dispatcher.test.ts`
- `ad-optimizer/google-offline-dispatcher.ts` — Google Ads offline conversions
- `ad-optimizer/google-offline-dispatcher.test.ts`
- `skill-runtime/tools/calendar-book.ts` — Calendar booking skill tool (slots.query + booking.create only)
- `skill-runtime/tools/calendar-book.test.ts`

### packages/db/src/

- `stores/prisma-booking-store.ts` — Booking persistence
- `stores/prisma-outbox-store.ts` — OutboxEvent persistence
- `stores/prisma-conversion-record-store.ts` — ConversionRecord persistence + funnel queries
- `stores/prisma-dispatch-log-store.ts` — Dispatch log persistence
- `stores/prisma-reconciliation-store.ts` — ReconciliationReport persistence

### apps/api/src/

- `routes/roi.ts` — Single aggregate ROI endpoint
- Bootstrap wiring updates for dispatchers + durable bus + outbox publisher

### apps/dashboard/src/

- `app/(auth)/dashboard/roi/page.tsx` — ROI dashboard page
- `app/api/dashboard/roi/route.ts` — Single dashboard proxy route
- `hooks/use-roi.ts` — Single TanStack Query hook
- `components/roi/` — Funnel bars, metric cards, breakdown tables, health indicator

## Dependencies

| Package          | Purpose                                    | Where         |
| ---------------- | ------------------------------------------ | ------------- |
| `googleapis`     | Google Calendar API v3                     | packages/core |
| `google-ads-api` | Google Ads offline conversions             | packages/core |
| `ioredis`        | Redis Streams (already in stack via dedup) | packages/core |

## What Changed in Revision 2

1. **CRM stage update moved to bus consumer** — booking tool emits event and stops. CRM update is downstream fan-out via `crm-updater` consumer group.
2. **Outbox pattern pulled into scope** — booking + outbox event written in same DB transaction. OutboxPublisher moves events to Redis Stream. No gap between DB write and bus emit.
3. **Core invariant made explicit** — ConversionEvent is the source of truth for funnel progression. Everything else is a projection.
4. **Booking status simplified** — removed `rescheduled`. Reschedule updates times in-place with `rescheduledAt` + `rescheduleCount`.
5. **Unified AdConversionDispatcher interface** — Meta CAPI and Google Offline share one interface. Bus wiring is declarative. Adding platforms = implement interface + register.
6. **ROI API collapsed** — single `GET /roi/summary` endpoint returns funnel + breakdown + health in one response.
7. **"By Agent" demoted** — Campaign and Channel are hero tabs. Agent is under "Details" expandable.
8. **RevenueStore de-emphasized** — explicitly not a display source. Future deprecation noted.
9. **Non-scope tightened** — cut cancel/reschedule UI, bookings management API, Google Meet, conferenceLink from v1.
