# `/reports` Backend v1 — Design Spec

**Status:** Approved (operator deep-dive surface, not owner summary)
**Date:** 2026-05-05
**Surface:** `/reports` (Mercury / Tools-tier register)
**Audience:** operators, agency consultants, owners who want detail
**Replaces:** static fixtures shipped in PR #364

---

## 1. Goal

Wire roadmap items #11–#15 (per `2026-05-03-agent-first-redesign-roadmap.md` §3) plus a new managed-vs-unmanaged comparison block, so the static `/reports` surface that already shipped on `main` (PR #364) renders live data for `(orgId, window)` where `window ∈ { THIS_WEEK, THIS_MONTH, THIS_QUARTER }`.

The owner-facing renewal narrative ("did I make money? is the AI doing things?") lives on the per-agent home pages (Slice B). `/reports` is the **operator deep-dive** surface for the same period — Mercury typography, hairline tables, full funnel, full campaign rollup, ROAS column, per-agent attribution split, downloadable PDF for forwarding to clients/agencies/accountants.

---

## 2. Scope

**In scope (v1):**
- Live read path for the existing 6 sections (Pull-quote, Attribution, Funnel, Campaigns, Cost-vs-Value) plus a new section (Managed-vs-Unmanaged Comparison)
- First-party web analytics ingestion (pixel + endpoint + storage), required for the funnel's "Landing visits" stage
- Pre-Switchboard baseline capture (one-time backfill at onboarding) for the comparison fallback
- Server-side PDF export
- Production gate via `NEXT_PUBLIC_REPORTS_LIVE` env flag, mirrors Slice B PR-S6 cutover doctrine
- One-hour read-through cache (`ReportCache`) keyed by `(orgId, window)` with manual refresh button

**Out of scope (deferred):** see §15.

---

## 3. Decisions Table

| # | Question                       | Decision                                                                                                                                                                                                                                                                              |
| - | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Per-agent revenue attribution  | First-touch via `Opportunity` → first `ConversionRecord`. No schema migration. Riley = revenue from leads whose first touchpoint was an ad (`sourceAdId` or `sourceCampaignId` present); Alex = revenue from leads whose first touchpoint was a managed channel (`sourceChannel` present, no ad source); manual-entry revenue (no `ConversionRecord`) buckets to Alex by default. Documented in `core/reports/attribution-rule.ts`. Phase D may add `LifecycleRevenueEvent.agentDeploymentId` for last-touch view; the first-touch rule remains the v1 source of truth. |
| 2 | Funnel landing-visits source   | Net-new first-party web analytics pixel + ingestion. `ConversionRecord.type='visit'` convention (no schema change). Pixel JS served from `GET /api/pixel.js`, ingested at `POST /api/pixel/visit`. Cookieless session derivation: daily-rotating hash of `(IP/24, user-agent, orgId)`. IP truncated to `/24` before storage. Bot UA filter at ingestion. |
| 3 | Funnel narrative source        | Latest period-relevant ad-optimizer `Recommendation` (intents in `{creative_fatigue, ctr_drop, conversion_drop}`) formatted as `"Riley · {date} — {humanSummary}"`. Static fallback when none exists.                                                                                  |
| 4 | Aggregation strategy           | On-demand SQL aggregation per request, backed by 1h `ReportCache` (`(orgId, window) → ReportData JSON`). No background cron. "Refresh" button on page busts cache for the active org/window.                                                                                          |
| 5 | PDF export                     | Playwright server-side render of `/reports?print=1`. Short-lived signed JWT scopes `(orgId, window)` to prevent direct-URL leakage. Per-request Playwright launch (no pool in v1). Cached alongside `ReportData` for 1h. Filename `switchboard-report-{orgSlug}-{window}.pdf`.                                                                                                                                                                                |
| 6 | Cost-vs-value comparison math  | Hard-coded US SMB constants in core (`SDR_MONTHLY_USD = 5000`, `AGENCY_MONTHLY_USD = 3000`). Footnote on page: "Based on US SMB hiring averages." `paid` = Stripe period invoice prorated to window; `alt` = `(SDR_MONTHLY_USD + AGENCY_MONTHLY_USD)` prorated; `saving = alt - paid`.       |
| 7 | Production cutover             | Single `NEXT_PUBLIC_REPORTS_LIVE` env flag. Defaults `false` in production through PR-R1..R5. Final PR-R6 flips the flag, deletes `fixtures.ts`, removes the flag.                                                                                                                                                                                                                                                                                            |
| 8 | Managed-vs-unmanaged grain     | Channel-level (not campaign-level). Riley-managed ads = campaigns under an `AdAccount` connected to Switchboard with active dispatcher; Unmanaged = the org's other campaigns from the same Meta connection (or campaigns from a tag-marked unmanaged account). Alex-managed conversations = `ConversationThread` first-responder is Alex's deployment; Operator = first-responder is human. |
| 9 | Cohort-missing fallback        | Pre-Switchboard baseline: at onboarding completion, an Inngest job pulls 90 days of pre-Switchboard ad account history from Meta and writes to a new `PreSwitchboardBaseline` row per `(orgId, dimension)`. At report time: when an unmanaged in-period cohort is missing, render baseline-vs-managed; when neither exists (brand-new org, no baseline yet), hide the section and render "Comparison unlocks after 30 days."                              |
| 10 | Pull-quote register           | New LLM call in `core/reports/pull-quote-generator.ts`. Output conforms to the agent-voice idioms used by `Recommendation.humanSummary` (existing precedent for agent-voice prose), but no shared generator utility exists today — this is greenfield. System prompt tuned for operator-deep-dive register (concise brief, not warm renewal narrative). Cached per `(orgId, window)` for 1h alongside `ReportData`. |

---

## 4. Architecture

### 4.1 Read path (live data)

```
Dashboard /reports page
  └─ useReportData(window) [react-query]
       └─ GET /api/dashboard/reports?window=THIS_MONTH
            ├─ Cache check: ReportCache.findUnique({ orgId, window })
            │    └─ if fresh (< expiresAt) → return cached payload
            └─ On miss:
                 └─ core/reports/period-rollup.compute(orgId, window)
                      ├─ attribution-rule.compute(orgId, period, prior)
                      ├─ funnel-rollup.compute(orgId, period, prior)
                      ├─ campaign-rollup.compute(orgId, period)
                      ├─ managed-comparison-rollup.compute(orgId, period)
                      ├─ cost-vs-value-rule.compute(orgId, period)
                      └─ pull-quote-generator.generate(orgId, period, sections)
                 └─ Persist ReportCache row (computedAt, expiresAt = now + 1h)
                 └─ return payload
```

### 4.2 Write paths (visit ingestion)

```
Customer marketing site
  └─ <script src="/api/pixel.js" data-org="{orgToken}">
       └─ Reads pathname, referrer, utm_*, screen size; sends beacon
            └─ POST /api/pixel/visit
                 ├─ Validate org token (public, org-scoped)
                 ├─ Bot UA filter (deny known crawler list)
                 ├─ Per-IP per-orgId rate limit (60/min)
                 ├─ IP truncate to /24
                 ├─ Derive cookieless sessionId = hash(IP/24, UA, orgId, dayKey)
                 └─ Persist ConversionRecord { type: 'visit', sourceCampaignId, sourceChannel: 'website', metadata: { path, referrer, sessionId } }
            └─ Always returns 204 (silent — no PII, no diagnostic responses)
```

### 4.3 PDF path

```
Dashboard "Download PDF" click
  └─ POST /api/dashboard/reports/pdf-token?window=THIS_MONTH
       └─ Server issues short-lived signed JWT (5 min, scopes orgId+window)
       └─ Browser navigates to GET /api/dashboard/reports/pdf?window=…&token=…
            ├─ Validate JWT (sig, exp, orgId match session)
            ├─ Cache check: PdfCache.findUnique({ orgId, window })
            │    └─ if fresh (< expiresAt) → stream cached PDF
            └─ On miss:
                 └─ Playwright launches headless Chromium
                 └─ Playwright context receives a service-minted dashboard session cookie scoped to the JWT's orgId (read-only, 5-min TTL)
                 └─ Page navigates to https://{host}/reports?print=1&window=…
                 └─ page.pdf({ format: 'A4', printBackground: true })
                 └─ Persist PdfCache row (1h TTL alongside ReportCache)
                 └─ Stream PDF to client
```

### 4.4 Pre-Switchboard baseline path

```
On onboarding completion (existing OnboardingComplete event)
  └─ Inngest function: capturePreSwitchboardBaseline
       └─ For each connected AdAccount:
            └─ MetaCampaignInsightsProvider.fetch(accountId, last90Days)
       └─ Aggregate by week/month buckets
       └─ Persist PreSwitchboardBaseline row { orgId, dimension: 'ads', metric, value, periodStart, periodEnd }
       └─ For each ConversationStore source:
            └─ Aggregate first-responder (operator vs agent) over last90Days
       └─ Persist PreSwitchboardBaseline row { orgId, dimension: 'conversations', ... }
```

### 4.5 Layer compliance

- `packages/core/src/reports/*` — pure projection logic, reads via `db` stores, no HTTP/Inngest imports
- `packages/core` does not import `ad-optimizer` directly. Meta insights are read via `db` (already cached there by ad-optimizer's existing inngest functions).
- `apps/api/src/routes/*` — thin handlers: parse query, call core, handle cache, return JSON
- `apps/dashboard/src/app/(auth)/reports/*` — pure renderers; no business logic

---

## 5. Data Model

### 5.1 New tables (one migration in PR-R1)

```prisma
model ReportCache {
  id             String   @id @default(uuid())
  organizationId String
  window         String   // "THIS_WEEK" | "THIS_MONTH" | "THIS_QUARTER"
  payload        Json     // serialized ReportData
  computedAt     DateTime @default(now())
  expiresAt      DateTime

  @@unique([organizationId, window])
  @@index([expiresAt])
}

model PdfCache {
  id             String   @id @default(uuid())
  organizationId String
  window         String
  pdfBytes       Bytes
  computedAt     DateTime @default(now())
  expiresAt      DateTime

  @@unique([organizationId, window])
  @@index([expiresAt])
}

model PreSwitchboardBaseline {
  id             String   @id @default(uuid())
  organizationId String
  dimension      String   // "ads" | "conversations"
  metric         String   // "spend" | "leads" | "revenue" | "roas" | "reply_minutes" | "lead_conversion_rate"
  value          Float
  periodStart    DateTime
  periodEnd      DateTime
  capturedAt     DateTime @default(now())

  @@index([organizationId, dimension, metric])
}
```

### 5.2 New column on existing table

```prisma
model OrganizationConfig {
  // ... existing fields
  websiteTrackingToken String? @unique  // generated on org create; exposed in Settings → Website Tracking
}
```

### 5.3 String-convention extensions (no migration)

- `ConversionRecord.type='visit'` — new value in the existing free-form string field. Visit events MUST carry `sourceChannel='website'` and SHOULD carry `metadata.path`, `metadata.referrer`, `metadata.sessionId`.

### 5.4 Existing schema reuse

- `LifecycleRevenueEvent` — revenue facts, joined to `Opportunity` for first-touch attribution
- `Opportunity` — joined to first `ConversionRecord` for attribution rule
- `ConversionRecord` — funnel facts (lead/visit/click events)
- `Booking` — funnel "Bookings" stage
- `OrganizationConfig.stripeCustomerId/stripeSubscriptionId/currentPeriodEnd` — period invoice data for `paid` cost
- `ConversationThread` — first-responder bucket for managed-vs-unmanaged comparison
- `Recommendation` (recommendations v1) — funnel narrative source
- `AgentDeployment` — Riley/Alex identity for first-responder check

---

## 6. View Model & API Contracts

### 6.1 `ReportData` (locked v1 — matches existing static shape with one addition)

The view model is the existing `ReportData` interface in `apps/dashboard/src/app/(auth)/reports/fixtures.ts`, **kept verbatim** and re-exported from `packages/schemas/src/reports/v1.ts` as `ReportDataV1`. The dashboard imports from `@switchboard/schemas` going forward; `fixtures.ts` is deleted in PR-R6.

**One additive field** (renders new section, optional in v1 type so older clients don't break):

```ts
interface ReportDataV1 {
  label: ReportWindow;
  period: string;
  dateFolio: string;
  pullquote: PullQuoteCopy;
  attribution: AttributionData;
  funnel: FunnelRowData[];
  funnelNarrative: FunnelNarrative;
  campaigns: CampaignRow[];
  cost: CostBreakdown;
  costNarrative: string;
  managedComparison: ManagedComparisonData | null;  // NEW; null when neither cohort nor baseline exists
}

interface ManagedComparisonData {
  ads: ManagedComparisonPair | null;            // null if no ad data at all
  conversations: ManagedComparisonPair | null;  // null if no chat data at all
  source: "in-period-cohort" | "pre-switchboard-baseline";
  emptyMessage?: string;                         // "Comparison unlocks after 30 days"
}

interface ManagedComparisonPair {
  managed: { spend: number; revenue?: number; roas?: number; replies?: number; conversionRate?: number; replyMinutesP50?: number };
  unmanaged: { spend: number; revenue?: number; roas?: number; replies?: number; conversionRate?: number; replyMinutesP50?: number };
  delta: Delta;  // computed primary delta (e.g., ROAS delta for ads, conversion-rate delta for conversations)
}
```

### 6.2 API endpoints

| Method | Path                                            | Auth                  | Returns / Effect                        |
| ------ | ----------------------------------------------- | --------------------- | --------------------------------------- |
| GET    | `/api/dashboard/reports?window=…`               | Dashboard session     | `ReportDataV1` JSON                     |
| POST   | `/api/dashboard/reports/refresh?window=…`       | Dashboard session     | Bust cache; returns fresh `ReportDataV1` |
| POST   | `/api/dashboard/reports/pdf-token?window=…`     | Dashboard session     | `{ token, expiresAt }` (5-min JWT)      |
| GET    | `/api/dashboard/reports/pdf?window=…&token=…`   | Signed JWT (5 min)    | `application/pdf` stream                 |
| GET    | `/api/pixel.js`                                 | Public                | `application/javascript` (cached at edge, no orgId baked in — token via `data-org` attribute) |
| POST   | `/api/pixel/visit`                              | Public + org-token    | `204 No Content`                         |

### 6.3 Hook contract (stable from PR-R1)

```ts
// apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts
export function useReportData(window: ReportWindow): {
  data: ReportDataV1 | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};
```

The hook returns fixture data when `NEXT_PUBLIC_REPORTS_LIVE !== 'true'` (matching the static shape). When the flag flips in PR-R6, the hook internals swap to react-query against the live endpoint without changing the public signature — `reports-page.tsx` does not change.

---

## 7. Components & File Layout

### 7.1 Core (`packages/core/src/reports/`)

```
reports/
  index.ts
  types.ts                              # internal types; view-model lives in @switchboard/schemas
  attribution-rule.ts                   # first-touch rule (Riley vs Alex bucketing)
  attribution-rule.test.ts              # 4 cases: ad-first, chat-first, manual-entry, no-conversion
  period-rollup.ts                      # top-level orchestrator; calls all section rollups
  period-rollup.test.ts
  period-helpers.ts                     # window → date range, prior-period range, currency formatting
  funnel-rollup.ts                      # 5-stage counts + deltas + narrative source query
  funnel-rollup.test.ts
  campaign-rollup.ts                    # per-campaign aggregation joining Meta insights × ConversionRecord × LifecycleRevenueEvent
  campaign-rollup.test.ts
  managed-comparison-rollup.ts          # channel-level cohort comparison + baseline fallback
  managed-comparison-rollup.test.ts
  cost-vs-value-rule.ts                 # paid (Stripe) + alt (constants) + saving + narrative
  cost-vs-value-rule.test.ts
  pull-quote-generator.ts               # LLM call producing PullQuoteCopy; agent-voice register
  pull-quote-generator.test.ts
  baseline-capture.ts                   # called by inngest on onboarding completion
  baseline-capture.test.ts
  report-cache-store.ts                 # thin Prisma wrapper for ReportCache
  pdf-cache-store.ts                    # thin Prisma wrapper for PdfCache
  baseline-store.ts                     # thin Prisma wrapper for PreSwitchboardBaseline
```

**Constants** (in `cost-vs-value-rule.ts`):

```ts
export const SDR_MONTHLY_USD = 5000;
export const AGENCY_MONTHLY_USD = 3000;
export const COST_VS_VALUE_FOOTNOTE = "Based on US SMB hiring averages — junior SDR ~$5,000/mo, ad agency retainer ~$3,000/mo.";
```

### 7.2 API (`apps/api/src/routes/`)

```
dashboard-reports.ts                    # GET /api/dashboard/reports + POST refresh + POST pdf-token
dashboard-reports-pdf.ts                # GET /api/dashboard/reports/pdf (Playwright)
pixel.ts                                # GET /api/pixel.js + POST /api/pixel/visit
```

Tests follow the existing `apps/api/src/__tests__/api-X.test.ts` flat-file pattern with `buildTestServer` and mocked Prisma stores (per project memory: `feedback_api_test_mocked_prisma.md`).

### 7.3 Dashboard (`apps/dashboard/src/app/(auth)/reports/`)

```
page.tsx                                # unchanged
reports-page.tsx                        # unchanged in PR-R1..R5; flag-gated content swap occurs inside the hook
hooks/
  use-report-window.ts                  # unchanged
  use-report-data.ts                    # NEW — returns fixture | live based on NEXT_PUBLIC_REPORTS_LIVE
  __tests__/use-report-data.test.ts
components/
  managed-comparison.tsx                # NEW (PR-R4)
  managed-comparison.module.css         # NEW
  __tests__/managed-comparison.test.tsx
  # existing: header, title-controls, pull-quote, attribution, funnel, campaigns, cost-vs-value, report-footer, disclosure
fixtures.ts                             # deleted in PR-R6
```

The `<ManagedComparison>` section component is mounted in `reports-page.tsx` between `<Funnel>` and `<Campaigns>`, gated on `data.managedComparison !== null`.

### 7.4 Settings (`apps/dashboard/src/app/(auth)/settings/`)

```
website-tracking/
  page.tsx                              # NEW (PR-R2) — shows orgToken-bearing snippet to copy-paste
```

Renders:

```html
<!-- Switchboard tracking -->
<script src="https://api.switchboard.app/pixel.js"
        data-org="{websiteTrackingToken}"
        async></script>
```

---

## 8. Production Gating

`NEXT_PUBLIC_REPORTS_LIVE` env flag, defaulting `false` in production through PR-R5. While `false`:

- `useReportData()` returns the existing fixtures (the static page renders unchanged)
- The `· FIXTURE` folio badge already shipped in PR #364 continues to indicate fixture mode
- Backend endpoints exist but are not consumed by the dashboard; they remain accessible to staging/dev environments for verification

PR-R6 flips the flag to `true` in production, deletes `fixtures.ts`, and removes the flag entirely. The hook internals stop branching on the flag and always call the live endpoint.

`/reports` route remains unchanged (no `notFound()` gate) since the static surface is acceptable to render in production. This differs from Slice B's `notFound()` pattern because Slice B exposed an entirely new route; here we are swapping the data source on an already-live route.

---

## 9. PR Sequence

Six PRs, each independently mergeable:

### PR-R1 — Schema, scaffolding, locked types

- Migration: add `ReportCache`, `PdfCache`, `PreSwitchboardBaseline` tables; add `OrganizationConfig.websiteTrackingToken`
- Add `ReportDataV1` types to `packages/schemas/src/reports/v1.ts` (matches the shape currently in `fixtures.ts` plus the new `managedComparison` field); migrate `fixtures.ts` to import the type from `@switchboard/schemas` so the dashboard has one source of truth
- Scaffold `packages/core/src/reports/` directory with all file skeletons (types, store wrappers, rollup function signatures)
- Add `useReportData()` hook returning fixture data behind `NEXT_PUBLIC_REPORTS_LIVE` flag (still fixture-only)
- Locked `AgentBlockQuery`-style return contract for the hook
- Backfill `OrganizationConfig.websiteTrackingToken` for existing orgs

**Acceptance:** schema migrates clean, types flow from schemas to dashboard, no behavior change on `/reports`.

### PR-R2 — Pixel ingestion + Settings panel

- `apps/api/src/routes/pixel.ts` with `GET /pixel.js` and `POST /pixel/visit`
- Cookieless sessionId derivation, IP truncation, bot UA filter, per-IP rate limit
- `apps/dashboard/src/app/(auth)/settings/website-tracking/page.tsx`
- `core/reports/types.ts` introduces `VisitConversionMetadata` shape for `metadata` field

**Acceptance:** customer pastes snippet, page views land as `ConversionRecord type='visit'`. Settings page shows snippet with org token. Bot UAs and missing tokens silently 204.

### PR-R3 — Period rollup (attribution + funnel + cost-vs-value live)

- `core/reports/attribution-rule.ts` + tests
- `core/reports/funnel-rollup.ts` + tests (queries Meta insights via db, ConversionRecord, Booking)
- `core/reports/cost-vs-value-rule.ts` + tests (Stripe period invoice + constants)
- `core/reports/period-rollup.ts` orchestrator + tests
- `core/reports/report-cache-store.ts` + 1h cache wiring
- `apps/api/src/routes/dashboard-reports.ts` exposes `GET /api/dashboard/reports?window=…` and `POST /api/dashboard/reports/refresh`
- Hook `useReportData` gains its live branch (consumes the new endpoint when `NEXT_PUBLIC_REPORTS_LIVE === 'true'`); flag remains `false` in prod, so production still renders fixtures
- Campaigns + ManagedComparison fields populated from fixtures by the live endpoint at this PR (server-side stub in the period rollup); flipped to live computation in PR-R4

**Acceptance:** in staging with flag on, attribution/funnel/cost sections render real data; campaigns/managed-comparison remain fixture. Cache TTL respected.

### PR-R4 — Campaign rollup + Managed-vs-Unmanaged comparison

- `core/reports/campaign-rollup.ts` + tests (Meta insights × ConversionRecord × LifecycleRevenueEvent)
- `core/reports/managed-comparison-rollup.ts` + tests (channel-level cohort + baseline fallback)
- `core/reports/baseline-capture.ts` + tests (called by inngest)
- `core/reports/baseline-store.ts`
- Inngest function `capturePreSwitchboardBaseline` triggered on onboarding completion event
- `<ManagedComparison>` component + tests, mounted between Funnel and Campaigns
- `period-rollup.ts` updated to populate `campaigns` and `managedComparison`

**Acceptance:** in staging, campaigns render real Meta data with ROAS column; comparison section renders with in-period cohort or baseline fallback or hidden empty-state copy.

### PR-R5 — Pull-quote LLM generator + cache integration

- `core/reports/pull-quote-generator.ts` + tests — new LLM call producing `PullQuoteCopy` in operator deep-dive register (concise, fact-led; not the warm narrative used on owner-facing agent home)
- Output is a strict-shape JSON object (`{ pre, value, mid, cost, post }`); on validation failure or LLM error, fall back to a deterministic template
- LLM call cached per `(orgId, window)` via `ReportCache` (1h TTL — same row as the rest of the data; `PullQuoteCopy` is one field of the cached `ReportData`)
- `period-rollup.ts` integrates pull-quote output into `pullquote: PullQuoteCopy`

**Acceptance:** in staging with flag on, pull-quote prose is LLM-generated, stable across reloads within 1h, falls back to template when LLM call errors.

### PR-R6 — PDF export + cutover

- `apps/api/src/routes/dashboard-reports-pdf.ts` (Playwright launch, signed JWT validation)
- `core/reports/pdf-cache-store.ts` + 1h cache wiring
- `?print=1` query param on `/reports` page hides print/download UI controls and applies print-only CSS
- "Download PDF" button on `<ReportsHeader>` calls `POST /api/dashboard/reports/pdf-token` then opens `GET /api/dashboard/reports/pdf` in a new tab
- Flip `NEXT_PUBLIC_REPORTS_LIVE=true` in production
- Delete `apps/dashboard/src/app/(auth)/reports/fixtures.ts`
- Remove flag-branch from `useReportData`

**Acceptance:** PDF download produces a pixel-faithful copy of the live page. Production renders live data. `fixtures.ts` deleted.

---

## 10. Testing Strategy

### 10.1 Core rollups
- Unit tests with mocked Prisma store (existing `prisma-workflow-store.test.ts` mock pattern per project memory)
- `attribution-rule.test.ts` is table-driven with 4 cases plus edge cases (multiple opportunities for one contact, zero-revenue opportunity, manual revenue with no contact link)
- `funnel-rollup.test.ts` covers: full data, missing landing-visits (no pixel), zero leads, zero impressions, prior-period zero (delta should render "vs prior" when computable, "no prior data" otherwise)
- `campaign-rollup.test.ts` covers: campaigns with revenue, campaigns with no revenue but spend, campaigns with revenue but no spend (organic), the ROAS-zero edge case
- `managed-comparison-rollup.test.ts` covers: in-period cohort path, baseline path, neither (hide), partial (only ads, only conversations)
- `cost-vs-value-rule.test.ts` covers: monthly subscription, annual prorated to month, no Stripe data (entitlement override path)

### 10.2 API
- Flat tests under `apps/api/src/__tests__/api-reports.test.ts` and `api-pixel.test.ts` per project memory
- `buildTestServer` with mocked Prisma stores (no real Postgres in CI)
- Pixel: token validation, IP truncation, bot UA filter, rate limit, silent 204 on all error paths
- Reports: cache hit/miss paths, refresh path, PDF token path, JWT signature/expiry validation

### 10.3 Dashboard
- React-query test wrapper for `useReportData` (existing pattern from Slice B)
- `<ManagedComparison>` component test for both cohort and baseline rendering paths
- Snapshot test for the print-mode page

### 10.4 E2E (Playwright)
- One test per PR-R6: load `/reports` with `NEXT_PUBLIC_REPORTS_LIVE=true` against test fixtures, verify all sections render, verify PDF download produces a non-empty PDF binary

### 10.5 Coverage
- Core stays at 65/65/70/65; reports projection code carries its own coverage.
- Dashboard global 55/50/52/55 holds. New components + hook tests carry the new dashboard code coverage.

---

## 11. Security

### 11.1 Pixel ingestion
- Org token is **public** (rendered in the customer's HTML). Token grants only one privilege: write `ConversionRecord type='visit'` for that org. Compromise impact: a third party can write fake visit events for one org. Mitigations:
  - Per-IP per-orgId rate limit (60/min)
  - Per-orgId system-wide rate limit (600/min)
  - IP truncated to `/24` before storage (no PII stored)
  - Cookieless sessionId derivation prevents cross-site tracking
  - Bot UA filter (Googlebot, Bingbot, Twitterbot, LinkedInBot, AhrefsBot, etc.)
- Token rotation: customers can rotate `websiteTrackingToken` from Settings → Website Tracking; old token invalidates immediately.
- No PII captured: no full IP, no cookies, no email addresses, no form input.

### 11.2 PDF token
- Short-lived signed JWT (5 min, HS256) issued by `POST /api/dashboard/reports/pdf-token` with payload `{ orgId, window, exp }`
- Direct `GET /api/dashboard/reports/pdf?token=…` validates signature, expiry, and that the JWT's `orgId` matches the active session's `orgId` (defense in depth even if a token leaks)
- Playwright fetches `/reports?print=1` with a service-internal mint of the dashboard session token, scoped to the same `orgId`

### 11.3 ReportCache / PdfCache
- All reads org-scoped; cache key includes `orgId`. Cross-org access is impossible by construction.
- `payload` and `pdfBytes` are not encrypted at rest in v1. Risk profile: rollup data is reproducible and contains no secrets; PDF contains the same data rendered. Acceptable.

### 11.4 LLM pull-quote generator
- Input limited to numeric rollup data and ad-optimizer recommendation human-summaries (already operator-visible)
- No customer PII or secrets reach the LLM
- Output validated against `PullQuoteCopy` shape; on validation failure, fall back to template

### 11.5 CSP
- The customer's marketing site loads `pixel.js` from `https://api.switchboard.app` — this is the customer's CSP concern, not ours, but the docs in Settings include the recommended `script-src` addition.
- The dashboard `/reports?print=1` mode does not change CSP. (Per project memory `feedback_dashboard_csp.md`, dashboard CSP already allows `'unsafe-eval'` and `ws:` in dev.)

---

## 12. Performance & Rate Limits

| Endpoint                                        | Per-org limit                  | Per-IP limit                | Notes                                                                |
| ----------------------------------------------- | ------------------------------ | --------------------------- | -------------------------------------------------------------------- |
| `GET /api/dashboard/reports`                    | 30 / min                       | n/a (session-bound)         | Cache hits <50ms; cold rollup ~1–3s                                  |
| `POST /api/dashboard/reports/refresh`           | 10 / min                       | n/a                         | Operator-initiated, short cooldown                                   |
| `GET /api/dashboard/reports/pdf`                | 5 / min                        | n/a                         | Playwright is heavy (~3–5s per render); cached for 1h alongside data |
| `POST /api/pixel/visit`                         | 600 / min (system-side)        | 60 / min (per-IP per-org)   | Silent 204 on all rejections                                         |
| `GET /api/pixel.js`                             | unlimited (CDN-cached)         | n/a                         | 1KB JS, edge-cached for 1h                                           |
| Pull-quote LLM call (internal, not an endpoint) | At most 24 / day per org/window | n/a                         | 1h cache means natural rate ~3–8/day per org                         |

Cold-start budget for the read path:
- Cache miss: rollup runs, ~5 SQL queries (period range + prior period × {revenue, conversions, bookings, ad insights, recommendations}), ~1–2s
- LLM pull-quote: ~1–2s
- Total worst case: ~3s; cache hit: ~50ms

---

## 13. Acceptance Criteria

System-wide acceptance for v1:
1. With `NEXT_PUBLIC_REPORTS_LIVE=true` and a populated test org, `/reports` renders correctly across all three windows with no fixture data.
2. Refreshing the page within 1h produces an instant render (cache hit).
3. Refresh button busts cache and produces a fresh render.
4. PDF download produces a pixel-faithful copy of the live page.
5. Brand-new org with no data shows: empty pull-quote ("Quiet first week — your team is just getting started"), zeroed attribution, zeroed funnel, empty campaigns table, comparison hidden with "unlocks after 30 days" copy.
6. Org with website tracking installed shows the "Landing visits" funnel row populated.
7. Org without website tracking shows the funnel with "Landing visits" hidden (gracefully — 4-row funnel).
8. Pull-quote prose stable across reloads within the 1h cache window.
9. Comparison section hides when neither in-period cohort nor baseline data exists.
10. Pixel ingestion silently filters bots, truncates IPs, and respects rate limits (verified by integration tests).

---

## 14. Risks & Mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-touch attribution disagrees with operator's mental model                        | Doc the rule in `attribution-rule.ts` JSDoc and in the page's footer disclosure ("Attribution by first-touch — ad-driven if first event was an ad click; chat-driven otherwise"). Phase D may surface a last-touch alternative.                                                                     |
| Meta API outage during rollup                                                         | Funnel and campaign rollups read Meta data from the local `db` cache populated by ad-optimizer's existing inngest functions, not directly from Meta. If the local cache is stale, the rollup proceeds with stale ad data and renders with what's available.                                          |
| Playwright Chromium binary inflates Docker image size and cold-start                  | Acceptable trade-off for design parity. Per-request launch (no pool) keeps memory floor low. Future Phase D may introduce a Playwright pool if PDF generation latency becomes a customer complaint.                                                                                                  |
| LLM pull-quote produces awkward or inaccurate prose                                   | (a) System prompt validated against fixture data shapes during PR-R5 review. (b) Output validated against `PullQuoteCopy`. (c) Template fallback on any validation failure. (d) Cached 1h so rare bad outputs don't reload-spam.                                                                       |
| Per-IP rate limits on pixel ingestion break corporate-NAT customers (many users behind one IP) | The 60/min per-IP-per-org limit is generous for a corporate site (~1 page view/sec). If a customer hits it, we can raise the per-IP limit on their org via an `OrganizationConfig` override field (deferred to Phase D unless complained-about).                                                  |
| Pre-Switchboard baseline pulls 90 days of Meta history but org's Meta data is sparse  | If baseline data is below a minimum threshold (e.g., < $50 spend or < 5 leads in the 90-day window), mark the baseline `null` and use in-period cohort path instead. If both are null, hide the section.                                                                                            |
| Cohort-based comparison creates a perverse incentive (orgs unmanage channels to make Switchboard look good) | Document the cohort definition in the page footer. Phase D can add a "comparison includes channels you've explicitly tagged as unmanaged" disclosure. Not load-bearing at v1 scale.                                                                                                              |
| ReportCache row growth                                                                | Bounded: at most 3 rows per org. `expiresAt` index supports a periodic cleanup job (deferred — Postgres handles low row count fine).                                                                                                                                                                |
| PDF cache row growth (Bytes column)                                                   | At most 3 PDFs per org (~500KB each = 1.5MB/org max). Acceptable for v1. Cleanup job for expired PDFs is a Phase D backlog item.                                                                                                                                                                       |
| `OrganizationConfig.websiteTrackingToken` backfill misses orgs                        | PR-R1 backfill iterates all rows; idempotent. Token generation deterministic-from-orgId would reduce backfill complexity but increases enumeration risk; random 256-bit token is safer.                                                                                                              |

---

## 15. Out of Scope (Deferred)

| Item                                                                              | Why deferred                                                              | Owner / phase                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| `LifecycleRevenueEvent.agentDeploymentId` schema migration                        | First-touch heuristic is correct for v1; last-touch is a different model not needed yet | Phase D                       |
| Industry benchmark fallback for cohort-missing comparison                         | Requires benchmark data source; pre-Switchboard baseline is sufficient for v1 | Phase D                       |
| Per-region cost-vs-value constants (SG, UK, etc.)                                 | US is the primary cohort; constants documented as US-averaged              | Phase D when non-US orgs ship |
| Per-org configurable cost-vs-value math                                           | Invites renewal-time arguments; constants are more defensible              | Phase E                       |
| Multi-currency display                                                            | All v1 orgs are USD or near-USD; SGD bookings are displayed in USD with a note | Phase D                       |
| Custom date ranges                                                                | Three windows cover the renewal-checkpoint use case                       | Phase D                       |
| Email-the-report (scheduled monthly send)                                         | "Downloadable PDF + dashboard URL" is sufficient                          | Phase D                       |
| Real-time updates (sub-1h freshness)                                              | Operator deep-dive surface; 1h cache is acceptable                        | Phase E                       |
| Drill-down per campaign with time-series chart                                    | `/reports` already deep-dive enough; deeper drill links to Meta Ads Manager | Phase E                       |
| Comparison vs other Switchboard customers / cohorts                               | Privacy-fraught; not a customer ask                                       | Never                         |
| Playwright pool for PDF                                                           | Per-request launch is fine at v1 scale                                    | Phase D if latency complained-about |
| ReportCache / PdfCache row cleanup job                                            | Row count is bounded                                                      | Phase D                       |
| Per-org rate-limit overrides for pixel ingestion (corporate-NAT)                  | Deferred unless customers complain                                        | Phase D                       |
| Last-touch attribution second view (in addition to first-touch)                   | One model is enough for v1                                                | Phase D                       |
| Dead-code cleanup for `FixtureFolioBadge` after cutover                           | Component becomes dormant in PR-R6; cleanup follows Slice B's pattern    | Optional follow-up            |
