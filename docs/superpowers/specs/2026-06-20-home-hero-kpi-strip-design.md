# Home Hero KPI Strip — Design (Rehaul Pass-2, thread 1)

Status: DRAFT, revised after review. Date: 2026-06-20. Owner: aesthetic-rehaul `/loop`.
Source thesis: `docs/superpowers/specs/2026-06-19-aesthetic-rehaul-thesis.md` (Pass 2 — "raise hero surfaces beyond reports").

Revision note (rev 2): tightened the revenue evidence contract per review — explicit status/origin inclusion rule, a single timestamp anchor, org-isolation + currency guardrails, a tile-level state union in the schema, and a revenue-sparkline that is optional behind the builder contract. Three genuine product decisions are marked **DECISION (confirm)** in section 3; nothing is built until they are locked.

## 1. Goal & success criteria

The authed Home is the #1 surface and currently under-proves value (a hard-coded-empty `WorkInProgress` module, no money up top). Pass-2 thread 1 adds a **hero KPI strip** so an operator sees, in ~5 seconds, what the system did for them this week.

Success = the Home hero leads with a **real, contract-defined** number (no fabrication), in the warm-editorial register, and degrades to honest states when data is thin. Specifically:

- Leads with **this week's attributed booking value (S$)**, plus **bookings this week** and **awaiting your approval**.
- Every number is real or an honest empty/unavailable state ("evidence over assertion / provenance over liveness").
- The evidence contract behind the hero number is explicit at the schema layer — not implementation folklore.

## 2. Scope

IN:
- A `HomeKpiStrip` on Home (org-level, cross-agent).
- Backend: a weekly **attributed booking-value** aggregation (the missing producer), reusing the existing metrics signal store + week-context machinery, populating the already-defined `HeroMetric` `revenue-attributed` variant.
- A tile-level state union in the `HomeSummary` schema; honest three-states; drop the dead `WorkInProgress` module.

OUT (explicit):
- **Receipted/paid revenue.** The S$ here is *attributed booking value* (`ConversionRecord` rows at the `booked` stage), not cash collected. Cash-collected is the separate "severed payment leg" payment-proof workstream and is NOT in this slice. The `purchased`/`completed` stages (receipt-adjacent) are also out.
- **Multi-currency.** The data model has no org currency field; SGD is a system-wide convention (see 4.4). Multi-currency support is a future schema change, out of scope.
- The other Pass-2 threads (operator evidence-first review-item; reports+results consolidation); dark mode; any change to governance/trust/routes/wiring.

## 3. Metric semantics (the evidence contract)

### 3.1 Revenue inclusion rule (attributed booking value)

The attributed-value tile sums `ConversionRecord.value` (CENTS; `packages/schemas/src/conversion.ts:49` "MINOR currency units (cents)") over rows that ALL of:

| Condition | Rule | Source |
|-----------|------|--------|
| Tenant | `organizationId == orgId` | every store query is org-scoped |
| Stage | `type == "booked"` | `ConversionStageSchema` = `inquiry\|qualified\|booked\|purchased\|completed`; "booked" is the booking mark (no `isBooked`/`settledAt` field exists) |
| Provenance | `origin == "live"` | excludes fixtures/demo seed rows (`origin` default `"live"`) |
| Value present | `value != null && value >= 0` | `value` is `Float @default(0)`; a NaN/negative/nullish value is excluded from the money sum (never poisons it) |
| Window | `occurredAt ∈ [weekStart, weekEnd)` | half-open, org-local week (see 3.3) |
| Attribution | **DECISION below** | |

Dedup: `ConversionRecord.eventId` is `@unique` and writes are idempotent upserts, so there are no duplicate rows to dedup and no "superseded" concept to filter. Rows with an absent/invalid `value` are excluded from the money sum but MAY still count as bookings if they satisfy 3.2 (count and value are computed from the same row set but value-missing rows only drop from the sum).

**DECISION 1 (confirm) — what "attributed" means.** In code, "attributed" = `sourceCampaignId OR sourceChannel` present (Riley's ad-CAC lens, `prisma-conversion-record-store.ts:316`). For a Home value-proof hero there are two readings:
- **(A, recommended) All booked value** — sum every `booked` row regardless of ad attribution. The hero answers "what did the system book this week," which is the operator's question; it is not Riley's ad lens. This also sidesteps the "organic rows that happen to stamp `sourceChannel` flatter the number" risk.
- **(B) Ad-attributed only** — restrict to `sourceCampaignId OR sourceChannel` present. Narrower; ties the hero to paid-channel performance.
Recommend A and label the tile plainly (3.5). If B, the label must say "ad-attributed."

### 3.2 Bookings count — same anchor as revenue

**DECISION 2 (confirm) — bookings source.** The number must share the revenue anchor (review blocker). Two options:
- **(A, recommended) Count the same `booked` ConversionRecords** used by the money sum (same org, `type=booked`, `origin=live`, same `occurredAt` window). Then "bookings" and "their attributed value" are the SAME rows — perfectly aligned, and every counted booking contributes to the sum. Note: this differs from Alex's per-agent metric, which counts `Booking` rows (`countBookingsCreated`, anchored on `Booking.createdAt`) and includes bookings with no conversion record. The Home hero is the org-level value lens; the Alex panel keeps its own. We document the distinction.
- **(B) Reuse `countBookingsCreated`** (the `Booking` model). Consistent with Alex, but anchored on a DIFFERENT model/timestamp than the revenue, so the two tiles can diverge at the week boundary — the exact mismatch the review flags.
Recommend A (alignment + honesty beat cross-surface sameness here).

### 3.3 Timestamp anchor + window (single, explicit)

- **Anchor field:** `ConversionRecord.occurredAt` — the producer-set event time (a required column, not a `now()` default), so it is the semantic "when the booking happened," not row-insert time. Both revenue and (under Decision 2A) the bookings count use this one field.
- **Interval:** half-open `[weekStart, weekEnd)` (use `lt` on the upper bound) so the boundary instant is never double-counted. We standardize the home-summary builder on half-open and do not mix the funnel's closed `lte` convention.
- **Week boundary + timezone:** `weekStart = computeWindowStart("week", now, orgTimezone)` via the existing `buildWeekContext`. `orgTimezone` comes from `OrganizationConfig.businessHours.timezone` (`getOrgTimezone`, fallback `Asia/Singapore`), NOT a literal.

### 3.4 Awaiting-approval tile

Live count of pending operator approvals from the existing decision feed (`useDecisionFeed(null).counts.approval`). It is "right now," not weekly — a **to-do signal**, not a KPI: no delta, no sparkline, a direct queue CTA. Not added to the home-summary backend; it stays on `/api/dashboard/decisions`.

### 3.5 Copy (honest, compact)

- Hero label: **"Attributed booking value"**. Subcopy: **"Booked this week, not yet collected"** (protects against the receipted-revenue confusion this slice excludes).
- Hero empty: **"No attributed bookings yet this week. When an agent creates one, its booked value will appear here."**
- Bookings tile: "Bookings" + count + delta + (optional) sparkline.
- Approval tile: "Awaiting your approval" + count + queue CTA. Do NOT use "value driven" anywhere.

## 4. Backend design (surface-agnostic; layers respected)

The `HeroMetric` `revenue-attributed` variant (`value`, `currency`, `comparator`) and `StatCell.unit: "currency"` already exist in `packages/core/src/agent-home/metrics-types.ts` — the type is built; only the producer is missing.

### 4.1 Schema (`@switchboard/schemas`) — tile-level state union

Make the payload impossible to misuse: each metric carries its own state, so the UI renders from the contract, not from ad-hoc `{data,error}` interpretation.

```ts
type HomeSummaryMetric<T> =
  | { state: "ready"; value: T; comparator?: { window: "week"; value: T }; sparkline?: SparkPoint[]; freshness: DataFreshness }
  | { state: "empty"; reason: "no_current_week_bookings" | "no_prior_week_baseline" }
  | { state: "unavailable"; reason: string };

interface HomeSummary {
  attributedValueCents: HomeSummaryMetric<number>; // money in CENTS; UI is the single /100 conversion point
  bookings: HomeSummaryMetric<number>;             // count
  currency: "SGD";                                 // system convention (see 4.4)
  generatedAt: string;                             // ISO
}
```

Money fields are named `*Cents` and are integers-in-cents end to end; a test rejects a dollar-valued field accidentally placed here. `comparator`/`sparkline` are optional so a present-but-no-baseline week yields `state:"empty", reason:"no_prior_week_baseline"` (never `+∞%`).

### 4.2 Signal store (interface in core, impl in db)

Add to `MetricsSignalStore`:
`sumAttributedBookedValueCentsForWindow(input: { orgId; from: Date; to: Date }): Promise<number>` and, for Decision 2A, `countBookedConversionsForWindow(input: { orgId; from: Date; to: Date }): Promise<number>`. The prisma impl applies the 3.1 where-clause (`organizationId`, `type:"booked"`, `origin:"live"`, `occurredAt` half-open window) and `_sum: { value }` / `count`. The store performs ONLY the narrow aggregation.

### 4.3 Home-summary read model (core) owns the semantics

A surface-agnostic projector reuses `buildWeekContext()` + the signal store to assemble `HomeSummary`: current-week value/count, prior-week comparator, optional sparkline, and the `state` discrimination (empty vs unavailable). **The builder owns every semantic decision — status filter, timestamp anchor, interval, currency. Route handlers and the db store do NOT decide these.**

### 4.4 Currency (decision written down)

There is NO org currency field (`OrganizationConfig` has none; `LifecycleRevenueEvent.currency` defaults `"SGD"`; `Booking.timezone` defaults `Asia/Singapore`). All money is SGD by system convention, so `HomeSummary.currency` is the literal `"SGD"`. If multi-currency orgs are ever added, the schema must gain an org currency source — explicitly out of scope here.

### 4.5 Transport

`GET /api/dashboard/home/summary` (thin Fastify route, auth like the existing agent-home routes; org from session, never from the client). Validate with the `HomeSummary` schema at BOTH the producer boundary (api) and the client boundary (dashboard). No migration (reads existing columns). PlatformIngress untouched.

### 4.6 Sparkline (optional behind the contract)

The booking sparkline already exists. The revenue sparkline means daily value buckets (N more aggregations, timezone-correct day boundaries, empty-day handling, and sparse-data micro-trend risk). It is **optional in the `HomeSummaryMetric` contract** (`sparkline?`): ship it in v1 only if daily revenue buckets fall cleanly out of `buildWeekContext`; otherwise omit it and do NOT block the hero value on it. The booking sparkline ships regardless.

## 5. Frontend design

- **`HomeKpiStrip`** (`apps/dashboard/src/components/home/`): three tiles on the signature `Card`, rendered from the tile `state` union (not `{data,error}` guessing). Hero = attributed value via `<Money value={cents / 100} />` (the single conversion point; render-test-pinned against the #6b cents trap) + `delta-badge` (reuse `(mercury)/reports/components/delta-badge.tsx`) + optional sparkline.
- **Visual grammar:** the two outcome tiles (value, bookings) are KPI siblings; the approval tile is a **queue/action tile** — visually distinct, no sparkline, no delta, a direct CTA into the queue.
- **Data:** `useHomeSummary()` (value + bookings) composed with `useDecisionFeed(null)` (approvals). `{data,error}`-derived loading (avoid the `enabled:false`/`isLoading` pitfall), but tile bodies render from `state`.
- **Honest states (per tile):** loading -> Skeleton; `unavailable` -> editorial StatePanel (never a raw status); `empty` -> the 3.5 copy (never a bare `S$0`). Reuse the `query-states` primitives from slice #2.
- **Placement:** the strip becomes the Home hero above the decision modules; **remove** the hard-coded-empty `WorkInProgress` module (`home-page.tsx`). Mono eyebrow + Fraunces numerals voice consistent with `PageTitle`; tabular-nums.

## 6. Error handling & honesty

Tiles degrade independently via the `state` union from the contract. Money is cents end to end until the one UI conversion point (render-test-pinned). `freshness` ("as of") rides each `ready` metric. The approval tile links to the queue so the count is actionable. A NaN/missing `value` row never poisons the money sum (3.1) and never renders.

## 7. Testing

**Backend (prisma-mock pattern; CI has no Postgres — mirror `prisma-*-store.test.ts`):**
- cents sum over `type:"booked"`, `origin:"live"`, window;
- **excludes records from another org** (cross-tenant leakage);
- **excludes non-`booked` stages** (`inquiry`/`qualified`/`purchased`/`completed`) and `origin != "live"`;
- **null/invalid `value` excluded from the sum but not (necessarily) from the count**; negative/NaN never poisons the sum;
- **org-timezone week boundaries** (a row at 23:59 org-local on the last day is in; the next instant is out) using the half-open interval;
- **prior-week zero baseline** yields `state:"empty", reason:"no_prior_week_baseline"`, NOT a `+∞%`/`NaN` comparator;
- builder output (value/count/comparator/optional spark + correct `state`);
- `HomeSummarySchema.safeParse(builderOutput)` seam test; **schema rejects a dollar-valued money field** (cents-guard).

**Frontend:** `HomeKpiStrip` render tests pinning the exact displayed S$ (cents -> S$), the delta, and each tile `state` (ready/empty/unavailable/loading); a test asserting `WorkInProgress` is gone; the cents-conversion pin.

**Gates:** typecheck; full dashboard `vitest` + `--filter api test`; `format:check`; `arch:check`; `local-verify-fast` (new route -> route-ingress check); `next build`; `db:check-drift` (no schema change expected — confirm). Coverage floor 40/35/40/40. No engine change -> no eval.

## 8. Decomposition (PR-sized slices; schema-first)

1. **Schema + semantic lock** — `HomeSummary` + the `HomeSummaryMetric` state union + the documented status/origin/timestamp/interval/currency semantics in comments; tests with a fake builder feeding the schema. NO db/api/UI. Forces the evidence contract before anyone wires around a fuzzy number.
2. **Backend producer** — `sumAttributedBookedValueCentsForWindow` (+ `countBookedConversionsForWindow` per Decision 2A), db impl, org-isolation + timezone/window + null-value + stage-exclusion tests; the core home-summary builder + its tests.
3. **API + hook** — the Fastify route, dashboard proxy route, `useHomeSummary`, auth/tenant tests, schema parse at producer AND client boundary.
4. **UI** — `HomeKpiStrip` with mocked hook states, render tests (cents, each tile state, empty/error/loading), no placement yet.
5. **Placement** — mount the strip as the Home hero; remove `WorkInProgress`; before/after screenshots.

Each is its own focused PR off fresh `origin/main`, full build-loop, independent review, gated on required CI.

## 9. Guardrails

Layers schemas -> core -> db -> api -> dashboard, no cycles, no UI in core/db. PlatformIngress untouched (read-only feature). Evidence over assertion: never fabricate; the inclusion rule is contract-level; honest states everywhere. No em-dashes; lowercase Conventional Commit subjects; focused reviewable commits. Verify each changed surface with before/after screenshots + the full gate suite.

## 10. Decisions to confirm before build

1. **Decision 1 (3.1)** — "attributed" = **(A, recommended) all booked value** vs (B) ad-attributed only. Drives the where-clause and the label.
2. **Decision 2 (3.2)** — bookings count = **(A, recommended) the same `booked` ConversionRecords** (aligned with revenue; differs from Alex's `Booking` count) vs (B) reuse `countBookingsCreated` (consistent with Alex; timestamp-mismatched).
3. **Stage inclusion (3.1)** — confirm **`booked` only** (recommended); `purchased`/`completed` stay out (receipt-adjacent = the separate workstream).
4. **v1 revenue sparkline (4.6)** — include if daily revenue buckets are clean, else omit; booking sparkline ships regardless. Confirm you are OK with revenue-sparkline-optional.

Resolved by the schema (no longer open): money unit (cents), timestamp anchor (`occurredAt`, half-open week), org timezone (`businessHours.timezone`), currency (SGD literal by convention), dedup (`eventId` unique; no superseded), tile-state contract (the `HomeSummaryMetric` union).
