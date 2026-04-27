# CRM Outcome + Meta Feedback Loop — Design Spec

> **Date:** 2026-04-24
> **Status:** Approved
> **Depends on:** Ad Optimizer foundation (`packages/ad-optimizer/`), existing ConversionBus + MetaCAPIDispatcher, Prisma CRM models

---

## 1. Scope & Two Loops

We are building the shared CRM outcome layer that powers two related but separate loops.

### Loop 1 — Conversion Feedback (outbound signal)

Lead arrives → Switchboard captures and qualifies → lead progresses through CRM funnel → Switchboard dispatches conversion events to Meta CAPI → Meta receives higher-quality outcome signals → Meta optimizes future delivery toward better leads.

### Loop 2 — Weekly Audit (inbound diagnosis)

Pull campaign insights + CRM outcomes → diagnose account performance problems → connect media metrics to real business outcomes → generate recommendations → surface to operator.

### Shared principle

CRM outcomes are captured once. Conversion Feedback writes them outward. Weekly Audit reads them inward. No loop owns a separate version of lead, booking, or revenue truth.

---

## 2. ConversionEvent Schema

The existing `ConversionEvent` in `packages/schemas/src/conversion.ts` uses `type: ConversionStage` with `"inquiry" | "qualified" | "booked" | "purchased" | "completed"`. We keep this platform-neutral enum and extend the event shape — not replace it.

### Extended fields

```typescript
export interface ConversionEvent {
  eventId: string;
  type: ConversionStage;
  contactId: string;
  organizationId: string;
  accountId?: string;

  value?: number;
  currency?: string;

  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;

  // Legacy source label. Keep for backward compatibility.
  source: string;

  // Structured source of the business transition.
  sourceContext?: {
    model: "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";
    id: string;
    transition?: string;
  };

  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;

  customer?: {
    email?: string;
    phone?: string;
  };

  attribution?: {
    lead_id?: string;
    fbclid?: string;
    fbclidTimestamp?: Date;
    sourceCampaignId?: string;
    sourceAdSetId?: string;
    sourceAdId?: string;
    eventSourceUrl?: string;
    clientUserAgent?: string;
  };
}
```

### Field clarifications

- **`value`** is optional. `inquiry`, `qualified`, and `booked` events typically have no value. `purchased` events should include `value` + `currency`.
- **`accountId`** is optional for backward compatibility. New events from `buildConversionEvent` always populate it. Used in deterministic `eventId`.
- **`source`** (legacy string) is kept for existing callers. The builder sets it to `params.source.model` (e.g., `"Opportunity"`, `"Booking"`). **`sourceContext`** (new structured object) is the preferred field for new events — the builder populates both.
- **`metadata`** is required by the existing schema. The builder always sets `metadata: {}` unless the caller passes legacy metadata.
- **`organizationId`** is the canonical org identifier. The builder maps `params.orgId` → `organizationId`. Do not add a separate `orgId` field.

### Precedence rules

- `customer` is the canonical structured location for customer identifiers. Dispatcher reads `customer` first, falls back to legacy `metadata`.
- `attribution.*` is the preferred structured source for attribution context. Top-level `sourceCampaignId` / `sourceAdId` remain for backward compatibility.
- `sourceContext` is preferred over `source` string. New code reads `sourceContext`; legacy code reads `source`.
- Structured fields are canonical; legacy top-level fields and `metadata` remain as backward-compatible fallback sources during migration.

### Platform-neutral invariant

Dispatchers map `type: ConversionStage` to platform-specific event names. The shared schema never contains Meta event names (`"Contact"`, `"QualifiedLead"`, etc.).

---

## 3. MetaCAPIDispatcher Upgrade

The existing dispatcher (`packages/ad-optimizer/src/meta-capi-dispatcher.ts`) is upgraded from a single `system_generated` path into a Meta adapter that maps platform-neutral ConversionEvents into valid Meta CAPI payloads.

The dispatcher remains transport and platform-adaptation logic only. It does not decide whether a CRM transition happened, whether an event should exist, or what the business stage means.

### 3a. Stage-to-event-name mapping (dispatcher-owned)

```typescript
const META_EVENT_NAME: Record<ConversionStage, string> = {
  inquiry: "Contact",
  qualified: "QualifiedLead",
  booked: "ConvertedLead",
  purchased: "Purchase",
  completed: "Purchase",
};
```

This is platform adaptation, not CRM business logic.

### 3b. Attribution path selection

Priority order:

**1. Lead Ads CRM path**

```typescript
if (leadId) {
  action_source = "crm";
  user_data.lead_id = leadId; // unhashed
}
```

**2. Website click-ID path** — only when full web context exists:

```typescript
else if (fbclid && eventSourceUrl && clientUserAgent) {
  action_source = "website";
  event_source_url = eventSourceUrl;
  user_data.client_user_agent = clientUserAgent;
  user_data.fbc = buildFbc(fbclid, fbclidTimestamp);
}
```

**3. PII-only / partial-attribution fallback**

```typescript
else {
  action_source = "system_generated";
  // If fbclid exists but full web context is missing,
  // still include fbc as a match signal.
  if (fbclid) {
    user_data.fbc = buildFbc(fbclid, fbclidTimestamp);
  }
}
```

Key rule: `fbclid` alone improves matching but does not trigger `action_source: "website"`.

### 3c. PII reading precedence

```
email: customer.email → metadata.email
phone: customer.phone → metadata.phone
```

Hashing stays inside the dispatcher:

```typescript
if (email) user_data.em = sha256(normalizeEmail(email));
if (phone) user_data.ph = sha256(normalizePhone(phone));
```

### 3d. Attribution field precedence

Canonical attribution fields win:

```
attribution.lead_id    → metadata.lead_id fallback
attribution.fbclid     → metadata.fbclid fallback
```

Only these count as dispatch match keys: `lead_id`, `fbclid`, `email`, `phone`.

`sourceCampaignId`, `sourceAdSetId`, `sourceAdId` are context fields, not match keys.

### 3e. canDispatch

```typescript
canDispatch(event: ConversionEvent): boolean {
  const email = event.customer?.email ?? event.metadata?.["email"];
  const phone = event.customer?.phone ?? event.metadata?.["phone"];
  const leadId = event.attribution?.lead_id ?? event.metadata?.["lead_id"];
  const fbclid = event.attribution?.fbclid ?? event.metadata?.["fbclid"];

  return Boolean(leadId || fbclid || email || phone);
}
```

`sourceAdId` is NOT a match key and is excluded from `canDispatch`.

### 3f. eventId pass-through

Pass `event.eventId` as `event_id` in the Meta payload for server-side dedup.

### 3g. Currency and custom data

No hardcoded currency:

```typescript
if (event.value != null && event.currency) {
  custom_data = { value: event.value, currency: event.currency };
} else if (event.value != null && !event.currency) {
  log warning: "missing_currency_for_value";
  // omit custom_data
}
```

### 3h. 7-day timing guardrail

```typescript
if (event.occurredAt < nowMinusSevenDays) {
  log skipped dispatch with reason = "event_time_too_old";
  return { accepted: false, errorMessage: "event_time_too_old" };
}
```

### What stays unchanged

- Bearer token auth
- Endpoint: `/{pixelId}/events`
- SHA-256 hashing utilities
- `AdConversionDispatcher` interface
- Constructor shape: `MetaCAPIConfig` + optional `fetchFn`
- Error-handling shape (extended only with explicit skipped-dispatch response)

---

## 4. Event Builder — `crm-event-emitter.ts`

**Location:** `packages/ad-optimizer/src/crm-event-emitter.ts` (new file)

A pure helper that converts known CRM transition data into a platform-neutral `ConversionEvent`. Called by the app layer after the app layer has already determined that a real transition happened.

### 4a. `buildConversionEvent` signature

```typescript
export function buildConversionEvent(params: {
  orgId: string;
  accountId: string;
  type: ConversionStage;
  contact: {
    id: string;
    leadgenId?: string;
    attribution?: {
      fbclid?: string;
      fbclidTimestamp?: Date;
      sourceCampaignId?: string;
      sourceAdSetId?: string;
      sourceAdId?: string;
      eventSourceUrl?: string;
      clientUserAgent?: string;
    };
    email?: string;
    phone?: string;
  };
  occurredAt: Date;
  source: {
    model: "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";
    id: string;
    transition?: string;
  };
  value?: number;
  currency?: string;
}): ConversionEvent;
```

### 4b. What it does

- Maps `contact.leadgenId` → `attribution.lead_id`
- Maps `contact.attribution.*` → `attribution.*`
- Maps `contact.email/phone` → `customer.*`
- Constructs deterministic `eventId` (includes `accountId`)
- Maps `params.orgId` → `organizationId` (does not add a separate `orgId` field)
- Maps `params.accountId` → `accountId`
- Maps `params.source` → `sourceContext` (structured object)
- Sets legacy `source` to `params.source.model` (e.g., `"Opportunity"`, `"Booking"`)
- Always sets `metadata: {}` unless caller passes legacy metadata
- Passes `occurredAt` through unchanged (business event time, not dispatch time)
- Returns a complete platform-neutral `ConversionEvent` ready for `ConversionBus.emit()`

### 4c. Deterministic event ID

```
eventId = `${orgId}:${accountId}:${source.model}:${source.id}:${type}:${source.transition ?? "default"}`
```

Examples:

- `org_123:act_456:Opportunity:opp_789:qualified:stage_qualified`
- `org_123:act_456:Booking:book_789:booked:status_confirmed`
- `org_123:act_456:LifecycleRevenueEvent:rev_999:purchased:confirmed`

No UUIDs. No timestamps. No random suffixes. Stability is the point.

### 4d. What it must NOT do

- Import Prisma
- Subscribe to DB events
- Dispatch to Meta directly
- Decide if a stage transition happened
- Perform dedup writes
- Choose platform event names
- Hash PII (hashing belongs to the dispatcher)
- Infer currency (currency must be provided by the caller)

### 4e. Dedup responsibility split

| Layer               | Responsibility                                            |
| ------------------- | --------------------------------------------------------- |
| App layer           | Only calls builder on actual transitions (not every save) |
| Builder             | Produces deterministic `eventId` from transition data     |
| `wireAdDispatchers` | Passes `eventId` through to dispatchers                   |
| Dispatcher          | Passes `eventId` through to Meta as `event_id`            |

The builder does not own dedup. It makes dedup possible by producing stable IDs.

---

## 5. Stage Transition Triggers — App Layer Wiring

The app layer detects CRM transitions, loads the linked Contact, builds a platform-neutral ConversionEvent, and emits it through the existing ConversionBus.

```
CRM transition detected
→ load Contact
→ buildConversionEvent(...)
→ ConversionBus.emit(event)
→ wireAdDispatchers fans out to dispatchers
→ MetaCAPIDispatcher adapts event to Meta CAPI
```

### 5a. Four trigger points

| #   | Trigger                         | Stage       | Source Model            | Fired When                                                                             |
| --- | ------------------------------- | ----------- | ----------------------- | -------------------------------------------------------------------------------------- |
| 1   | AI agent first outbound message | `inquiry`   | `ConversationThread`    | `threadStatus = "open"` AND `firstAgentMessageAt` transitions from `null` to timestamp |
| 2   | Opportunity qualified           | `qualified` | `Opportunity`           | `previousStage !== "qualified" && newStage === "qualified"`                            |
| 3   | Booking confirmed               | `booked`    | `Booking`               | `previousStatus !== "confirmed" && newStatus === "confirmed"`                          |
| 4   | Revenue recorded                | `purchased` | `LifecycleRevenueEvent` | New record created with `status = "confirmed"`                                         |

### 5b. Critical distinctions

- **Trigger 1:** `ConversationThread` created ≠ `inquiry` event. Only fires when the AI agent actually responds. Fallback guard if `firstAgentMessageAt` does not exist yet: fire only if this is the first outbound agent message for the thread.
- **Trigger 2:** Re-saving an already-qualified opportunity must not re-emit.
- **Trigger 3:** Same transition guard — only on status change to confirmed.
- **Trigger 4:** Each confirmed `LifecycleRevenueEvent` produces one deterministic `purchased` event via its `source.id`. If duplicate payment webhooks can create duplicate revenue records, dedup must happen in the revenue ingestion layer before the `LifecycleRevenueEvent` is created. The CAPI layer does not solve duplicated payment records.
- **Purchase events:** The trigger should pass `currency` from `LifecycleRevenueEvent.currency` or org/account configured currency. If neither exists, the event may still be emitted, but the dispatcher logs `missing_currency_for_value` and omits `custom_data`.

### 5c. Wiring pattern

Each trigger follows the same shape:

1. Detect transition in the app/service layer
2. Load Contact with attribution, `leadgenId`, email, and phone
3. Call `buildConversionEvent(...)`
4. Call `ConversionBus.emit(event)`

The existing `ConversionBus` → `wireAdDispatchers` fanout remains the integration path. No new bus concept is needed.

### 5d. Where the trigger code lives

App-layer concerns. Trigger code lives where the transition is already handled:

- `apps/api` route handlers / service methods
- Conversation processing flow
- Opportunity / booking / revenue update flows

Trigger code does NOT live in `packages/ad-optimizer/` or `packages/core/`.

### 5e. Contact data loading

Every trigger needs the linked Contact to populate `customer` and `attribution`. For Trigger 1, Contact should already be available in the conversation flow. For Triggers 2–4, load Contact by ID from the source model's `contactId`.

If no Contact can be loaded: do not emit the conversion event. Log `skipped_conversion_event` with reason `"missing_contact"`.

### 5f. `leadgenId` on Contact

Add `leadgenId String?` column to the Prisma `Contact` model. `leadgenId` is a first-class Meta Lead Ads match key — it should be queryable and indexable, not buried in JSON.

`meta-leads-ingester.ts` already parses `leadgen_id` from Meta webhooks. It should persist this value onto `Contact.leadgenId`.

```prisma
model Contact {
  // existing fields...
  leadgenId String?

  @@index([organizationId, leadgenId])
}
```

Use a scoped unique index only if ingestion guarantees one Contact per Meta lead ID per org:

```prisma
@@unique([organizationId, leadgenId])
```

---

## 6. PrismaCrmDataProvider — Loop 2

The missing concrete implementation for the Weekly Audit's CRM data needs.

**Location:** `packages/db/src/stores/prisma-crm-data-provider.ts`

The provider interface and shared types (`CrmDataProvider`, `CrmFunnelData`, `FunnelBenchmarks`, `CampaignInsightsProvider`, `TargetBreachResult`, `MediaBenchmarks`, `WeeklyCampaignSnapshot`) must live in `packages/schemas` (Layer 1) to avoid dependency cycles — both `packages/db` (Layer 4) and `packages/ad-optimizer` (Layer 2) need to import them.

### 6a. Revised CrmDataProvider interface

Remove platform/media methods. CRM-only:

```typescript
export interface CrmDataProvider {
  getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date;
    endDate: Date;
  }): Promise<CrmFunnelData>;

  getBenchmarks(input: {
    orgId: string;
    accountId: string;
    vertical?: string;
  }): Promise<FunnelBenchmarks>;
}
```

Breaking change: positional args become input objects, `orgId`/`accountId`/date range added. AuditRunner updates simultaneously.

### 6b. CrmFunnelData

```typescript
type CrmFunnelData = {
  campaignIds: string[];
  leads: number;
  qualified: number;
  opportunities: number;
  bookings: number;
  closed: number;
  revenue: number;

  rates: {
    leadToQualified: number | null;
    qualifiedToBooking: number | null;
    bookingToClosed: number | null;
    leadToClosed: number | null;
  };

  coverage: {
    attributedContacts: number;
    contactsWithEmailOrPhone: number;
    contactsWithOpportunity: number;
    contactsWithBooking: number;
    contactsWithRevenueEvent: number;
  };
};
```

- `rates` use `null` when denominator is zero (no usable data), `0` for real observed zero conversion.
- `coverage` is required so the audit can lower confidence when CRM data is sparse.
- `closed` = distinct contacts or opportunities with at least one confirmed `LifecycleRevenueEvent`, not count of revenue event rows.

### 6c. FunnelBenchmarks (CRM-only)

```typescript
type FunnelBenchmarks = {
  leadToQualifiedRate: number;
  qualifiedToBookingRate: number;
  bookingToClosedRate: number;
  leadToClosedRate: number;
};
```

Media benchmarks (`ctr`, `landingPageViewRate`) move to `MediaBenchmarks` (Section 7).

### 6d. getFunnelData query logic

V1 uses **lead-cohort mode**: select Contacts created during the audit window, then count downstream outcomes linked to those contacts, even if the outcome occurred after the contact creation date but before audit run time.

**Product interpretation:** "We are evaluating outcomes from leads created during this period" — not "all bookings/revenue that happened during this period." This distinction matters in reporting. Outcome-period analysis (filtering by outcome timestamp) is v2.

```
Contact
  WHERE organizationId = orgId
  AND attribution->>'sourceCampaignId' IN (campaignIds)
  AND createdAt BETWEEN startDate AND endDate
```

Filter by `accountId` where the model or attribution data supports it. If not stored in v1, document that `campaignIds` are assumed sufficient within org scope.

**Counts:**

- `leads`: count selected Contacts
- `opportunities`: count distinct linked Opportunities
- `qualified`: count distinct linked Opportunities in qualified-or-later stages
- `bookings`: count distinct linked Bookings where `status = "confirmed"`
- `closed`: count distinct Contacts/Opportunities with at least one confirmed `LifecycleRevenueEvent`
- `revenue`: sum confirmed `LifecycleRevenueEvent.amount`

**Qualified stage definition:**

```typescript
const QUALIFIED_OR_LATER_STAGES = ["qualified", "booked", "won", "closed", "completed"];
```

Use actual enum values from the schema. If no stage history exists, count current stage in qualified-or-later.

**Coverage:** computed from the same query — count contacts with email/phone, with opportunity, with booking, with revenue event.

**Rates:** use `safeRate(numerator, denominator)` returning `null` when denominator is 0.

### 6e. getBenchmarks v1

```typescript
const BEAUTY_AESTHETICS_DEFAULTS: FunnelBenchmarks = {
  leadToQualifiedRate: 0.3,
  qualifiedToBookingRate: 0.4,
  bookingToClosedRate: 0.5,
  leadToClosedRate: 0.06,
};
```

Per-org and per-vertical configurable benchmarks are v2.

### 6f. What does NOT belong here

CTR, CPM, CPL, CPA, landing page view rate, campaign learning status, effective status, daily spend, days above target, any direct Meta Ads API data.

---

## 7. CampaignInsightsProvider + AuditRunner Refactor

Split `CrmDataProvider` into CRM-only + media/platform providers.

**Honest scope:** Provider interface split, constructor change, recommendation rule change, benchmark type migration across `FunnelBenchmarks` → `analyzeFunnel` → AuditRunner → recommendation engine → tests.

### 7a. CampaignInsightsProvider interface

```typescript
export interface CampaignInsightsProvider {
  getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
  }): Promise<CampaignLearningInput>;

  getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
  }): Promise<TargetBreachResult>;
}
```

### 7b. TargetBreachResult

```typescript
type TargetBreachResult = {
  periodsAboveTarget: number;
  granularity: "weekly" | "daily";
  isApproximate: boolean;
};
```

`periodsAboveTarget` counts periods where CPA > `targetCPA` (not kill multiplier). The recommendation engine separately checks whether current CPA exceeds the kill severity multiplier.

### 7c. WeeklyCampaignSnapshot

```typescript
type WeeklyCampaignSnapshot = {
  campaignId: string;
  startDate: Date;
  endDate: Date;
  spend: number;
  conversions: number;
  cpa: number | null;
};
```

### 7d. V1 implementation

`getCampaignLearningData`: wraps `AdsClientInterface`, calls live Meta Ads API.

`getTargetBreachStatus`: V1 `CampaignInsightsProvider` is constructed per audit run. It can accept snapshots via the optional `snapshots` parameter, or derive them from current/previous period campaign data already pulled. With only two periods available, `periodsAboveTarget` can be 0, 1, or 2.

V1 always returns `{ granularity: "weekly", isApproximate: true }`.

Daily insight snapshots with richer history are v2.

**Reuse rule:** `CampaignInsightsProvider` should reuse campaign insights already pulled by AuditRunner where possible, and only call live `AdsClient` for fields not present in the audit snapshot.

### 7e. AuditRunner constructor

AuditRunner still directly uses `adsClient` for `getCampaignInsights()` (Step 1) and `getAccountSummary()` (Step 1). Both stay.

```typescript
constructor(deps: {
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  config: AuditConfig;
})
```

Dependency direction:

```
AuditRunner → adsClient (raw insight pulls)
AuditRunner → CampaignInsightsProvider (derived platform analysis)
MetaCampaignInsightsProvider → AdsClientInterface (internal)
```

### 7f. Recommendation rule — corrected

The kill rule must preserve BOTH conditions: CPA severity AND sustained breach.

```typescript
const isAboveKillCpa = cpa > KILL_CPA_MULTIPLIER * targetCPA;

// Daily data — high confidence pause/kill
if (
  isAboveKillCpa &&
  targetBreach.granularity === "daily" &&
  targetBreach.periodsAboveTarget >= 7
) {
  action = "kill";
  confidence = 0.85;
}

// Weekly approximation — review/reduce-budget signal, NOT kill
if (
  isAboveKillCpa &&
  targetBreach.granularity === "weekly" &&
  targetBreach.periodsAboveTarget >= 1
) {
  action = "review_budget";
  confidence = 0.65;
  // text must state: "based on weekly snapshot data, treat as review signal"
}
```

7 daily periods = 7 bad days. 7 weekly periods = 7 bad weeks. They are not equivalent. Weekly breach is a review signal, not a kill signal.

### 7g. MediaBenchmarks type

```typescript
type MediaBenchmarks = {
  ctr: number;
  landingPageViewRate: number;
  clickToLeadRate?: number;
  cpl?: number;
  cpa?: number;
};
```

`analyzeFunnel` signature changes to:

```typescript
analyzeFunnel({
  campaignInsights,
  crmFunnelData,
  crmBenchmarks,
  mediaBenchmarks,
});
```

### 7h. Coordinated changes required

1. `FunnelBenchmarks` type — split into `FunnelBenchmarks` (CRM) + `MediaBenchmarks`
2. `analyzeFunnel` signature and internals — accept both benchmark types
3. `AuditRunner.run()` — pass both benchmark sets to `analyzeFunnel`
4. `AuditRunner` tests — update mock benchmarks
5. `analyzeFunnel` tests — update to dual-benchmark inputs
6. `RecommendationInput` — change `daysAboveTarget: number` to `targetBreach: TargetBreachResult`
7. `generateRecommendations` — update kill rule logic
8. Recommendation engine tests — update for new rule shape

### 7i. What stays unchanged

- Period comparison logic
- Diagnostic rules (except kill rule)
- Learning phase guard
- Report assembly shape
- `wireAdDispatchers` bus fanout

---

## 8. Implementation Checklist

### Data model

- [ ] Add `leadgenId String?` to Contact
- [ ] Add `@@index([organizationId, leadgenId])` to Contact
- [ ] Confirm `Contact.attribution` JSON can store: `fbclid`, `fbclidTimestamp`, `sourceCampaignId`, `sourceAdSetId`, `sourceAdId`, `eventSourceUrl`, `clientUserAgent`
- [ ] Confirm `LifecycleRevenueEvent` has: `amount`, `currency`, `status`, linked `contactId`

### ConversionEvent schema

- [ ] Add `customer`, `attribution`, `currency` fields to `ConversionEvent`
- [ ] Keep existing fields for backward compatibility

### Dispatcher

- [ ] Add stage-to-Meta-event-name mapping
- [ ] Add Lead Ads CRM path (`action_source: "crm"`)
- [ ] Add website path with full web context check
- [ ] Keep `fbc` in fallback path when `fbclid` exists without web context
- [ ] Update PII reading to check `customer` first, `metadata` fallback
- [ ] Remove `sourceAdId` from `canDispatch`, add `lead_id` and metadata fallbacks
- [ ] Pass `event.eventId` as `event_id`
- [ ] Remove hardcoded `"SGD"`, use `event.currency`
- [ ] Add `missing_currency_for_value` warning
- [ ] Add 7-day skip guard with logged reason

### Event builder

- [ ] Create `packages/ad-optimizer/src/crm-event-emitter.ts`
- [ ] Implement `buildConversionEvent` as pure function
- [ ] Add deterministic `eventId` with `accountId`
- [ ] No Prisma imports, no PII hashing, no currency inference

### App-layer triggers

- [ ] Wire `inquiry` trigger at first outbound agent message (`firstAgentMessageAt` null → timestamp)
- [ ] Wire `qualified` trigger at opportunity stage transition
- [ ] Wire `booked` trigger at booking status transition
- [ ] Wire `purchased` trigger at revenue event creation
- [ ] Each trigger: load Contact, call builder, emit to bus
- [ ] Add `missing_contact` skip logging

### CRM provider

- [ ] Move `CrmDataProvider` interface to shared types package
- [ ] Create `PrismaCrmDataProvider` in `packages/db/`
- [ ] Implement `getFunnelData` with lead-cohort mode
- [ ] Implement `getBenchmarks` with hardcoded v1 defaults
- [ ] Include coverage block
- [ ] Use qualified-or-later stages for qualified count
- [ ] Count closed as distinct contacts/opportunities, not revenue event rows

### Campaign insights provider

- [ ] Create `CampaignInsightsProvider` interface in shared types
- [ ] Create `MetaCampaignInsightsProvider` implementation
- [ ] Move `getCampaignLearningData` here (wraps `AdsClientInterface`)
- [ ] Implement `getTargetBreachStatus` with weekly approximation
- [ ] Define `periodsAboveTarget` as CPA > `targetCPA` (not kill multiplier)

### AuditRunner refactor

- [ ] Add `insightsProvider` to constructor
- [ ] Move learning data call to `insightsProvider`
- [ ] Move target breach call to `insightsProvider`
- [ ] Split `FunnelBenchmarks` into CRM + `MediaBenchmarks`
- [ ] Update `analyzeFunnel` to accept both benchmark types
- [ ] Update kill rule to check CPA severity + breach duration
- [ ] Downgrade weekly breach from "kill" to "review_budget"
- [ ] Update all affected tests

---

## 9. Final Architecture

```
                    +--------------------+
                    |   CRM data models  |
                    | Contact / Opp /    |
                    | Booking / Revenue  |
                    +---------+----------+
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
+------------------------+        +------------------------+
| Conversion Feedback    |        | Weekly Audit            |
| Loop 1                 |        | Loop 2                  |
+------------------------+        +------------------------+
| Stage transition       |        | PrismaCrmDataProvider   |
| -> buildConversionEvent|        | + CampaignInsights      |
| -> ConversionBus       |        | -> AuditRunner          |
| -> MetaCAPIDispatcher  |        | -> Recommendations      |
+------------------------+        +------------------------+
```

### Core invariant

One CRM truth. Two consumers. No junk drawer providers. No dispatcher-owned business logic.

### Provider boundaries

- `CrmDataProvider` = business outcome truth
- `CampaignInsightsProvider` = media/platform truth
- `AdsClientInterface` = raw platform access
- `AuditRunner` = orchestration + diagnosis
- `MetaCAPIDispatcher` = platform payload adaptation
