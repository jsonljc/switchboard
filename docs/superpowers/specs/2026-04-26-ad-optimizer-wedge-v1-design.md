# Ad Optimizer Wedge v1 — Design

**Date:** 2026-04-26
**Status:** Draft (pre-implementation)
**Scope:** v1 = CTWA + Instant Form. Web deferred to v2.

---

## 1. Problem Statement

The ad-optimizer package shipped V2 (PR #252) with rich analysis modules — funnel detection, trend engine, learning phase guard v2, creative analyzer, budget analyzer, multi-signal saturation. The weekly audit cron runs and produces structured reports.

But it cannot tell a customer which Meta ads make them money. The CRM data provider is a stub that returns hardcoded zeroes for leads, qualified, closed, and revenue. The funnel analysis is therefore top-of-funnel only. Recommendations are based on Meta's vanity metrics (CTR, CPM, frequency) rather than actual outcomes.

Two adjacent problems make this acute:

- **CTWA attribution is the industry's worst attribution gap.** Up to 90% of Click-to-WhatsApp clickers abandon before sending the first message, so Meta's "messages started" metric is not a conversion. Meta's algorithm optimizes on chats started, leading to more chats and more abandonment, collapsing real ROAS. The documented fix is CAPI dispatch with `ctwa_clid` (captured from WhatsApp webhook referral) and `action_source=business_messaging`.
- **Switchboard's documented day-one wedge is "Meta Ads → WhatsApp lead handling."** Alex (the WhatsApp booking agent) is the spine; ad-optimizer is the upstream half. Without unified attribution, neither half can prove value to a customer, and the bundle story falls apart.

Instant Form leads have a parallel problem: `parseLeadWebhook` and `meta-leads-ingester` exist, but no unified Contact creation pipeline writes lead records that ad-optimizer can read.

## 2. Goals

1. Replace the stubbed CRM data provider with real attribution data for CTWA and Instant Form lead sources.
2. Capture and persist `ctwa_clid` from WhatsApp webhook referrals; capture Instant Form `lead_id` + ad/campaign IDs.
3. Create Contact records uniformly across both sources, with normalized `sourceAdId`, `sourceCampaignId`, and `attribution` JSON.
4. Dispatch CAPI events on outcomes (lead, qualified, booked, paid) with the correct `action_source` and click ID for each source.
5. Surface cross-source comparison (CPL, cost-per-booked, close rate, true ROAS) in the weekly audit.
6. Make ad-optimizer's diagnoses, learning phase recommendations, creative scoring, and budget reallocation outcome-aware rather than vanity-metric-aware.
7. Validate end-to-end with one real Meta Ads account before declaring v1 ready.

## 3. Non-Goals

- **Web / landing page attribution** — `fbclid` capture, web Contact creation, `action_source=website` dispatch. Deferred to v2.
- **Auto-execution of recommendations** — "everything except publish" is preserved. No automated budget changes, no auto-paused campaigns, no auto-creative uploads.
- **Creative production / PCD pipeline** — separately tracked, not in scope.
- **Google / TikTok ad sources** — Google Offline Conversion dispatch exists in code but is not promoted as a v1 feature.
- **Replacing Meta Ads Manager for tactical edits** — not the product.
- **Generic CRM integrations (HubSpot, Salesforce, etc.)** — Alex outcomes + operator-marked outcomes are the v1 attribution source.

## 4. Architecture

### 4.1 Lead Intake Spine

A unified `LeadIntake` interface with two source adapters in v1:

```
WhatsApp webhook ──► CTWA adapter ──┐
                                    ├──► LeadIntake.submit() ──► PlatformIngress
Meta lead webhook ──► IF adapter ───┘                              │
                                                                   ▼
                                                          Contact (normalized)
                                                          + LeadActivity record
```

**CTWA adapter** (new):

- Reads `referral.ctwa_clid`, `referral.source_id` (ad ID), `referral.source_url` from WhatsApp Cloud API webhook payload
- Builds a `LeadIntake` event with `source: "ctwa"`, click ID, ad/campaign IDs (resolved via Meta API or cached campaign metadata)
- Idempotency key: `{phone, ctwa_clid}` to dedupe repeated webhook deliveries within Meta's referral window

**Instant Form adapter** (extends `meta-leads-ingester`):

- Existing `parseLeadWebhook` already extracts `leadgen_id`, `ad_id`, `form_id`
- Add Contact creation step (currently missing per docs)
- Builds a `LeadIntake` event with `source: "instant_form"`, no click ID (Instant Form uses `lead_id` for attribution), ad/campaign IDs from webhook
- Idempotency key: `leadgen_id`

Both adapters submit through `PlatformIngress.submit()` as a `lead.intake` intent, satisfying the doctrine invariant that mutating actions go through ingress.

### 4.2 Contact Schema (Normalized)

The existing `Contact` table already has `sourceAdId`, `sourceCampaignId`, and an `attribution` JSON column. v1 standardizes what goes into them:

```
Contact {
  id, deploymentId, orgId
  channelType: "whatsapp" | "email" | ...        // how to reach them
  sourceType: "ctwa" | "instant_form"            // where they came from (v1)
  sourceAdId, sourceCampaignId, sourceAdsetId
  attribution: {
    ctwa_clid?: string                           // CTWA only
    leadgen_id?: string                          // IF only
    referral_url?: string                        // CTWA only
    captured_at: ISO8601
    raw: { ...source-specific payload }
  }
  createdAt, updatedAt
}
```

A `LeadActivity` record is written at intake (kind: `lead_received`) and at every state transition (`replied`, `qualified`, `booked`, `showed`, `paid`).

### 4.3 Outcome Dispatcher

A single `OutcomeDispatcher` subscribes to lifecycle events (already emitted by Alex on booking, by operators on manual qualification, by future surfaces). It looks up the originating Contact, reads `sourceType`, and routes to the correct CAPI dispatch:

| Event                 | CTWA Contact                                                     | Instant Form Contact                                           |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `lead_received`       | (already optimized; no dispatch needed)                          | CAPI `Lead`, `action_source=system_generated`                  |
| `qualified`           | CAPI `Lead`, `action_source=business_messaging`, `ctwa_clid`     | CAPI `Lead`, `action_source=system_generated`, `lead_id`       |
| `booked`              | CAPI `Schedule`, `action_source=business_messaging`, `ctwa_clid` | CAPI `Schedule`, `action_source=system_generated`, `lead_id`   |
| `paid` (with revenue) | CAPI `Purchase` with `value`, `action_source=business_messaging` | CAPI `Purchase` with `value`, `action_source=system_generated` |

Existing `MetaCAPIDispatcher` is the underlying client. v1 wraps it in source-aware routing logic. Failures are retried via Inngest with exponential backoff; permanent failures surface as operator escalations.

### 4.4 Funnel Data Provider (Replaces Stub)

The current `crmDataProvider` stub in `inngest-functions.ts:74` (the `orgId: "TODO"` site) is replaced with a real provider:

```
RealCrmDataProvider.getFunnelData(deploymentId, dateRange):
  → query LeadActivity grouped by sourceType, sourceCampaignId
  → return per-source funnel:
     { ctwa:        { received, replied, qualified, booked, showed, paid, revenue }
       instant_form:{ received, contacted, qualified, booked, showed, paid, revenue } }

RealCrmDataProvider.getBenchmarks(deploymentId):
  → compute per-account historical means (28-day rolling)
  → return per-source benchmarks for each funnel stage
```

The orgId TODO is resolved by reading `deployment.orgId` (the deployment model already has this field; the previous code didn't extract it).

### 4.5 Audit Runner Changes

`AuditRunner` already orchestrates the analysis modules. v1 adds:

- **Per-source funnel analysis** — call `analyzeFunnel` once per source, aggregate
- **Cross-source comparison block** — new analyzer `compareSources` that produces the comparison table (CPL, cost-per-qualified, cost-per-booked, close rate, true ROAS per source)
- **Outcome-aware diagnoses** — `MetricDiagnostician` extended to recognize patterns like "CPL down but cost-per-booked up" → lead quality degradation
- **Outcome-aware recommendations** — `RecommendationEngine` extended with new actions: `shift_budget_to_source`, `switch_optimization_event`, `harden_capi_attribution`

### 4.6 Onboarding Validation

When a customer connects (Meta OAuth flow already exists), an onboarding validator runs a one-shot check:

- Inspect their campaigns via Meta API; classify each by destination type (CTWA / Instant Form / Web)
- For CTWA campaigns: verify WhatsApp Business API webhook is subscribed and we have received at least one referral with `ctwa_clid` in the last 7 days (or surface "no recent test traffic" if account is dormant)
- For Instant Form campaigns: verify lead webhook subscription
- For Web campaigns: surface "Web sources detected — coverage coming in v2"
- Produce a coverage score: "We can attribute X% of your ad spend to outcomes"

## 5. Component Inventory

### New

- `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` (+ test)
- `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` (+ test)
- `packages/ad-optimizer/src/lead-intake/types.ts` — `LeadIntake` interface, source enum
- `packages/ad-optimizer/src/outcome-dispatcher.ts` (+ test) — source-aware CAPI routing
- `packages/ad-optimizer/src/crm-data-provider/real-provider.ts` (+ test) — replaces stub
- `packages/ad-optimizer/src/analyzers/source-comparator.ts` (+ test) — cross-source comparison
- `packages/ad-optimizer/src/onboarding/coverage-validator.ts` (+ test)
- `apps/api/src/routes/whatsapp-webhook.ts` — extended to extract referral and call CTWA adapter (or equivalent existing route)
- `apps/dashboard/src/components/ad-optimizer/source-comparison-card.tsx` (+ test)
- `apps/dashboard/src/components/onboarding/attribution-coverage.tsx` (+ test)

### Modified

- `packages/ad-optimizer/src/inngest-functions.ts` — resolve `orgId` TODO, wire real CRM provider
- `packages/ad-optimizer/src/audit-runner.ts` — invoke source comparator, pass per-source funnel data
- `packages/ad-optimizer/src/metric-diagnostician.ts` — add outcome-aware diagnosis patterns
- `packages/ad-optimizer/src/recommendation-engine.ts` — add new recommendation actions
- `packages/ad-optimizer/src/meta-leads-ingester.ts` — add Contact creation step
- `packages/schemas/src/contact.ts` — codify `sourceType` enum, attribution JSON shape
- `packages/db/` — Prisma migration if `sourceType` column missing; index on `(deploymentId, sourceCampaignId, sourceType, createdAt)` for funnel queries
- `packages/core/` — register `lead.intake` intent handler if not already present

### Out of scope (v2)

- Web `fbclid` adapter
- Web Contact creation from landing page form submissions
- `action_source=website` dispatch path
- Web onboarding validation

## 6. Data Flow (End-to-End)

**CTWA path:**

```
Meta CTWA ad clicked
  → WhatsApp opens, user sends first message
  → WhatsApp Cloud API webhook fires with referral.ctwa_clid
  → CTWA adapter extracts referral, calls LeadIntake.submit()
  → PlatformIngress routes to lead.intake handler
  → Contact created (sourceType=ctwa, attribution.ctwa_clid set)
  → LeadActivity (lead_received) written
  → Alex skill engaged (existing path, unchanged)
  → Alex confirms booking → emits booked event
  → OutcomeDispatcher reads Contact.attribution.ctwa_clid
  → CAPI Schedule fired with action_source=business_messaging
  → On payment: operator marks paid + revenue → CAPI Purchase fired
```

**Instant Form path:**

```
Meta IF ad clicked → user submits form in Meta UI
  → Meta lead webhook fires with leadgen_id, ad_id, form_id
  → IF adapter (extended meta-leads-ingester) calls LeadIntake.submit()
  → PlatformIngress routes to lead.intake handler
  → Contact created (sourceType=instant_form, attribution.leadgen_id set)
  → LeadActivity (lead_received) written
  → CAPI Lead fired immediately with action_source=system_generated
  → Operator (or future agent) contacts lead, marks qualified → CAPI Lead (qualified intent)
  → Booking confirmed → CAPI Schedule
  → Payment confirmed → CAPI Purchase
```

**Audit path (Monday cron, unchanged in shape):**

```
Weekly cron fires
  → AuditRunner.run(deployment)
  → fetches Meta insights (existing), per-source funnel data (new), benchmarks (new)
  → runs all analyzers (existing + source-comparator)
  → produces audit report with per-source funnels, cross-source comparison, outcome-aware diagnoses & recommendations
  → saves to agent_task table (existing)
  → dashboard renders (existing component + new source-comparison card)
```

## 7. Error Handling & Edge Cases

- **WhatsApp referral missing `ctwa_clid`** — happens when user starts conversation organically (not via ad). Contact created with `sourceType=organic`, no CAPI dispatch.
- **CTWA referral expired** — Meta's referral window is short. If first message arrives after window, no `ctwa_clid` available. Same fallback as above.
- **Duplicate webhook deliveries** — idempotency keys (CTWA: `{phone, ctwa_clid}`; IF: `leadgen_id`). Second delivery is a no-op.
- **CAPI dispatch failure** — Inngest retry with exponential backoff (max 5 attempts, 24h window). Permanent failure → operator escalation via existing escalation channel.
- **Contact already exists for phone (CTWA)** — link new attribution to existing Contact via `LeadActivity` rather than creating duplicate. Track multi-touch attribution in `attribution.touches[]`.
- **Operator marks outcome on Contact with no attribution** — skip CAPI dispatch, log warning. Could be a manually-created Contact or organic lead.
- **Missing campaign metadata for CTWA `source_id`** — fallback to async resolution via Meta API; queue Contact creation, retry resolution in Inngest job.
- **Revenue value missing on `paid` event** — dispatch CAPI `Purchase` without `value` (Meta accepts; weighting is reduced). Surface gap in next audit.

## 8. Testing Strategy

- **Unit tests** — co-located `*.test.ts` for each new module (CTWA adapter, IF adapter, OutcomeDispatcher, RealCrmDataProvider, SourceComparator, CoverageValidator). Coverage targets per CLAUDE.md: 65/65/70/65 for ad-optimizer (core thresholds).
- **Integration tests** — full flow tests:
  - WhatsApp webhook → Contact created → CAPI Schedule fired (mocked Meta API, real PlatformIngress)
  - Meta lead webhook → Contact created → CAPI Lead fired
  - Audit runner with real CRM provider against seeded LeadActivity fixtures
- **End-to-end validation** — one real Meta Ads account (sprint pilot, per Alex wedge sprint protocol). Run for at least one full Monday audit cycle. Validate:
  - At least one CTWA lead captured with `ctwa_clid`
  - At least one IF lead captured with `leadgen_id`
  - CAPI events visible in Meta Events Manager with correct `action_source`
  - Audit report shows non-zero data for both sources
- **No mocking of database in integration tests** (per project memory).

## 9. Rollout Plan

1. **Build in parallel with Alex stabilization sprint.** Instant Form leg has no Alex dependency and can land first.
2. **Behind a deployment flag** — `attribution_v1_enabled` per deployment, default false. Old stub provider remains active until flag flipped.
3. **Pilot on one real account** — same Singapore pilot account from Alex wedge validation sprint, after Alex passes its 9 criteria.
4. **First Monday audit with real data** is the v1 readiness gate. If audit produces sensible output for both sources, declare v1 ready.
5. **Remove stub provider** after pilot confirmation. Migration: backfill existing Contacts with `sourceType=organic` if no source data available.

## 10. Open Questions

1. **Multi-touch attribution model** — for v1, last-touch within deployment is sufficient. Multi-touch (CTWA → web visit → IF submission) deferred to v2.
2. **Operator UI for marking outcomes** — does this exist today, or do we need to build a "mark qualified / paid" UI for Instant Form leads (since Alex doesn't handle them in v1)? Assumption: the existing Activity log + operator controls in the dashboard is sufficient. Validate during build.
3. **Campaign metadata cache TTL** — Meta API rate limits make resolving ad/campaign IDs on every webhook expensive. Propose cache TTL of 1 hour with background refresh. Confirm during implementation.
4. **CAPI deduplication with Meta Pixel** — if customer has Pixel installed on their landing page, and we're firing CAPI for CTWA + IF, no overlap (different action sources). Web in v2 will need pixel/CAPI dedup via `event_id`.

## 11. Success Criteria

v1 is "ready" when:

- One real Meta Ads account is connected and producing weekly audits with real (non-stub) data for CTWA and Instant Form
- At least one CAPI event per source has been verified in Meta Events Manager with correct `action_source` and click ID
- Cross-source comparison block in the audit report shows differentiated CPL / cost-per-booked / close rate per source
- At least one outcome-aware recommendation has been generated and reviewed (not necessarily acted on)
- Onboarding validator produces a coverage score for the pilot account
- All new modules have co-located tests passing; integration tests for both webhook paths green
- The product narrative ("WhatsApp + Instant Form Ads Operating System") is reflected in dashboard copy and onboarding flow
