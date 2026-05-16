# Slice B PR-S5 — B4 Metrics Live (Alex + Riley)

**Date**: 2026-05-07
**Author**: Jason (with Claude Code Opus 4.7)
**Parent spec**: `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` §PR-S5
**Status**: Design — pending user review
**PR scope**: Replace the B4 Metrics block on `/alex` and `/riley` agent homes with live data sourced from Prisma. Hero number, sparkline, stat cells, comparator, folio range — all driven by counts over `Booking` and `ConversionRecord`. Ad-platform-dependent stats render honestly as unavailable.

---

## 1. Goal

Make the **B4 Metrics** block on the agent home pages render live data instead of fixtures, for both Alex and Riley.

**Acceptance** (from parent spec §PR-S5):

- Alex hero = `tours-booked` from `Booking` count.
- Riley hero = `ad-leads` from `ConversionRecord` of type `"lead"`.
- Sparkline returns a 9-ish-point series (4 trailing weeks + week-to-date by day, length varies 5–11 by day-of-week).
- Stat cells per agent.
- `revenue-attributed` exists in the `HeroMetric` union but is not the default for either agent in PR-S5 (gated until per-agent attribution wiring lands).

**Non-goals (deferred):**

- `window=today` / `window=month` semantics (PR-S5 accepts `window=week` only).
- `revenue-attributed` becoming any agent's default hero (waiting on `LifecycleRevenueEvent.agentDeploymentId`).
- Per-org timezone read (continues using `"Asia/Singapore"` fallback, mirroring wins/pipeline).
- Name-drop subprose ("Maya, Jordan, Priya are most likely to convert" — fixture-era; deferred).
- Ad-platform spend / CTR ingestion (the cells render as unavailable until that lands).
- Cache invalidation hooks from the decision dispatcher.

---

## 2. Locked decisions (from brainstorm)

| #   | Decision                                                                                                         | Reasoning                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Q1  | Ad-platform-dependent stat cells render `—` with `unavailable: true` and an `unavailableSources` token           | Honest UX: zero ≠ unavailable. Mirrors the wins block's optional-source pattern.                                  |
| Q2  | Sparkline = 4 completed prior weeks + 1–7 daily WTD points (variable length, today flagged `isProjection: true`) | Matches the locked PR-S1 fixture; spec text "5 trailing weeks" is reconciled to fixture as ground truth.          |
| Q3  | `heroSubProseSegments` = comparator delta only, per-agent voice                                                  | Keeps PR scoped; name-drop deferred.                                                                              |
| Q4  | Alex hero source = `Booking.count` filtered by `createdAt` and `status NOT IN ['cancelled']`                     | Measures Alex's booking output, not calendar load.                                                                |
| Q5  | Alex Leads = `ConversionRecord type='lead'`; Conversion = tours/leads; Riley Leads = same as hero                | Single consistent definition of "lead" across the page; Riley Leads cell intentionally mirrors hero.              |
| Q6  | Capability-shaped `MetricsSignalStore` (two methods)                                                             | Both agents need the same primitive (count over a window with a filter); agent-shaped wrappers would be ceremony. |
| Q7  | Composition: `metrics.ts` + `metrics-alex.ts` + `metrics-riley.ts` + `metrics-buckets.ts`                        | Mirrors PR-S4's per-agent file split; keeps each file lean; parallel-subagent friendly.                           |
| Q8  | All-or-nothing on DB read failure (any count rejects → 500 → block fallback)                                     | Partial sparkline is more misleading than no sparkline. Reuse existing `<AgentBlockBoundary>`.                    |
| Q9  | `unavailableSources` tokens are stable API strings; user-facing labels live in the block component               | Future tokens (`attribution-revenue`) ship without contract churn.                                                |
| Q10 | `StatCell.rawValue: number \| null`, with `null` when `unavailable: true`                                        | Type-level guard against silently treating "no data" as zero in any future analytics/sort/derivation.             |
| Q11 | Add `@@index([organizationId, createdAt])` to `Booking` in the same PR                                           | The 6–13 parallel `countBookingsCreated` calls per `/alex` request need this index to stay sub-second at scale.   |
| Q12 | Single `WeekContext` computed once at the top of `projectMetrics`, passed by reference to per-agent builders     | Hero, comparator, sparkline buckets, and `folioRange` must use the same `now`/`tz` to avoid off-by-one drift.     |
| Q13 | `window=week` only in PR-S5; `today` / `month` return `400`                                                      | Honest scope. The React Query key already includes `window`; future PR can extend the enum without refactor.      |
| Q14 | UX upgrades shipped in PR-S5: `folioRange`, dashed projection segment, em-dash + `· no data` chip                | Without these, live data lies. Hardcoded "Mon — Fri" and indistinguishable `0` vs unavailable degrade once live.  |

---

## 3. Architecture

```
Browser
  └─ /alex or /riley
     └─ <MetricsBlock vm={metricsQuery.data} agentKey={agentKey} />
        └─ useAgentMetrics(agentKey)         ← live React Query hook
           └─ GET /api/dashboard/agents/[agentId]/metrics  (Next proxy)
              └─ GET /api/agents/[agentId]/metrics          (Fastify)
                 └─ projectMetrics(input)                    (core)
                    ├─ buildWeekContext(now, tz)             (single source of truth)
                    └─ switch agentKey:
                       ├─ buildAlexMetricsViewModel({ orgId, week, store })
                       └─ buildRileyMetricsViewModel({ orgId, week, store })
                          counts ← MetricsSignalStore (capability-shaped port)
                                   ← apps/api adapter over
                                     PrismaBookingStore.countExcludingStatuses
                                     PrismaConversionRecordStore.countByType
```

### 3.1 Public surface (core)

`AgentHomeKey` is already shared from `packages/core/src/agent-home/agent-key.ts` (introduced in PR-S4). PR-S5 imports it.

The `MetricsViewModel` shape is defined directly in `packages/core/src/agent-home/metrics.ts` (alongside `MetricsSignalStore`, `HeroMetric`, `SparkPoint`, `StatCell`, `DataFreshness`). The dashboard's existing `apps/dashboard/src/lib/agent-home/types.ts` carries a parallel definition consumed by the block component — same pattern as wins/pipeline (core can't import dashboard; layer rules forbid it). The two definitions must stay in lockstep; a structural assignability test in the proxy route catches drift.

```ts
// packages/core/src/agent-home/metrics.ts (excerpt)
import type { AgentHomeKey } from "./agent-key.js";

export interface MetricsSignalStore {
  countBookingsCreated(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number>;

  countConversionsByType(input: {
    orgId: string;
    type: string;
    from: Date;
    to: Date;
  }): Promise<number>;
}

export interface ProjectMetricsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string; // "Asia/Singapore" fallback at the route boundary
  store: MetricsSignalStore;
}

export async function projectMetrics(input: ProjectMetricsInput): Promise<MetricsViewModel>;
```

### 3.2 `WeekContext` (single source of truth)

```ts
// packages/core/src/agent-home/metrics-buckets.ts
export interface WeekContext {
  now: Date;
  timezone: string;
  weekStart: Date; // current week's Monday 00:00 in tz
  weekEnd: Date; // weekStart + 7d (exclusive)
  prevWeekStart: Date; // weekStart - 7d
  prevWeekEnd: Date; // weekStart
  weeklyBuckets: readonly { from: Date; to: Date; label: string }[]; // 4 prior weeks, ascending
  dailyBuckets: readonly { from: Date; to: Date; label: string; isToday: boolean }[]; // Mon..today
  folioRange: string; // "Mon — Wed" on multi-day; just "Mon" when today is Monday
}

export function buildWeekContext(now: Date, timezone: string): WeekContext;
```

`folioRange` formatting rule: when the current week-to-date contains a single day (today is Monday), render the day name only (`"Mon"`); otherwise render `"Mon — <today>"`. The block component reads the string verbatim — no client-side formatting branch.

Computed exactly once per `projectMetrics` call. Both per-agent builders take it by reference. No builder constructs `Date` instances itself; a unit test enforces this.

### 3.3 Layer rules

| Layer                                                                    | What changes                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/agent-home/`                                          | New: `metrics.ts`, `metrics-alex.ts`, `metrics-riley.ts`, `metrics-buckets.ts` + tests. `index.ts` exports `projectMetrics`, `MetricsSignalStore`, `MetricsViewModel`, voice-config types. |
| `apps/api/src/routes/agent-home/`                                        | New: `metrics.ts` + tests. Adapts `PrismaBookingStore.countExcludingStatuses` + `PrismaConversionRecordStore.countByType` into `MetricsSignalStore`. Mounted in `index.ts`.                |
| `apps/api/src/__tests__/`                                                | New: `api-agent-home-metrics-isolation.test.ts` (cross-tenant).                                                                                                                            |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/metrics/route.ts` | New Next.js proxy + tests. Validates upstream JSON via Zod.                                                                                                                                |
| `apps/dashboard/src/hooks/use-agent-metrics.ts`                          | Replace fixture body with React Query against the proxy.                                                                                                                                   |
| `apps/dashboard/src/lib/agent-home/types.ts`                             | Add `folioRange: string` to `MetricsViewModel`; change `StatCell.rawValue` to `number \| null`; add `unavailable?: boolean` to `StatCell`.                                                 |
| `apps/dashboard/src/components/agent-home/metrics-block.tsx`             | Read `vm.folioRange`; render `—` for unavailable cells; render `· no data: <labels>` chip.                                                                                                 |
| `apps/dashboard/src/components/agent-home/sparkline.tsx`                 | Render dashed segment + dashed-ring circle for the `isProjection` point.                                                                                                                   |
| `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts`                  | Remove `metrics` map + `getFixtureMetrics`.                                                                                                                                                |
| `packages/db/prisma/schema.prisma`                                       | Add `@@index([organizationId, createdAt])` on `Booking`. Migration in same commit.                                                                                                         |

Layer compliance: core imports schemas + agent-key only (no db). The capability port keeps core ignorant of Prisma. The api route is the only adapter.

---

## 4. View-models

### 4.1 `MetricsViewModel` shape (after PR-S5)

```ts
// apps/dashboard/src/lib/agent-home/types.ts (and mirrored from core)
export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | { kind: "revenue-attributed"; value: number; currency: string; comparator: MetricComparator };

export interface MetricComparator {
  window: "week";
  value: number; // value in the previous week
}

export interface SparkPoint {
  label: string;
  value: number;
  isProjection?: boolean;
}

export interface StatCell {
  label: string;
  display: string; // "47" / "26%" / "—"
  rawValue: number | null; // null when unavailable
  unit: "count" | "percent" | "currency";
  unavailable?: boolean; // true → display is "—", rawValue is null
}

export interface DataFreshness {
  generatedAt: string;
  window: "week";
  dataSource: "live" | "fixture";
  unavailableSources?: readonly string[]; // stable tokens; see §6.2
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string; // NEW — "Mon — Wed"
}
```

### 4.2 Per-agent compute (Alex)

| Field                          | Source                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `hero.kind`                    | `"tours-booked"`                                                                                                     |
| `hero.value`                   | `store.countBookingsCreated({ orgId, excludeStatuses: ["cancelled"], from: week.weekStart, to: week.weekEnd })`      |
| `hero.comparator.value`        | Same call over `[week.prevWeekStart, week.prevWeekEnd)`                                                              |
| `heroSubProseSegments`         | Alex voice — single text segment: `"Up from N last week."` / `"Down from N last week."` / `"Flat vs last week."`     |
| `spark[i]` (weekly)            | `countBookingsCreated` over each `week.weeklyBuckets[i]`                                                             |
| `spark[i]` (daily)             | `countBookingsCreated` over each `week.dailyBuckets[i]`; last point gets `isProjection: true`                        |
| `stats[0]` Leads               | `countConversionsByType({ orgId, type: "lead", from: weekStart, to: weekEnd })` → display = number, unit = `"count"` |
| `stats[1]` Conversion          | `tours/leads` if `leads > 0`, else `0`; display = `"NN%"`, unit = `"percent"`                                        |
| `stats[2]` Spend               | `{ display: "—", rawValue: null, unit: "currency", unavailable: true }`                                              |
| `freshness.unavailableSources` | `["ad-platform-spend"]`                                                                                              |
| `folioRange`                   | From `WeekContext`                                                                                                   |

### 4.3 Per-agent compute (Riley)

| Field                          | Source                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `hero.kind`                    | `"ad-leads"`                                                                                                  |
| `hero.value`                   | `store.countConversionsByType({ orgId, type: "lead", from: weekStart, to: weekEnd })`                         |
| `hero.comparator.value`        | Same call over previous week                                                                                  |
| `heroSubProseSegments`         | Riley voice — single text segment: `"+15 from last week."` / `"-12 from last week."` / `"Flat vs last week."` |
| `spark[i]`                     | `countConversionsByType` per bucket                                                                           |
| `stats[0]` Leads               | Same value as hero (intentional mirror)                                                                       |
| `stats[1]` CTR                 | `{ display: "—", rawValue: null, unit: "percent", unavailable: true }`                                        |
| `stats[2]` Spend               | `{ display: "—", rawValue: null, unit: "currency", unavailable: true }`                                       |
| `freshness.unavailableSources` | `["ad-platform-ctr", "ad-platform-spend"]`                                                                    |

### 4.4 Voice configs (locked at top of each per-agent file)

```ts
// metrics-alex.ts
const ALEX_VOICE = {
  up: (prev: number) => `Up from ${prev} last week.`,
  down: (prev: number) => `Down from ${prev} last week.`,
  flat: () => `Flat vs last week.`,
};

// metrics-riley.ts
const RILEY_VOICE = {
  up: (delta: number) => `+${delta} from last week.`,
  down: (delta: number) => `${delta} from last week.`, // delta is negative
  flat: () => `Flat vs last week.`,
};
```

A test asserts the same delta produces different prose on the two agents.

---

## 5. Data flow

### 5.1 Wire path

```
GET /api/dashboard/agents/:agentId/metrics?window=week
  → Next proxy (apps/dashboard) attaches auth-derived org header
  → GET /api/agents/:agentId/metrics?window=week (Fastify)
```

### 5.2 Validation (Fastify)

```ts
const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({ window: z.enum(["week"]).default("week") });
const ALEX_RILEY_ONLY = ["alex", "riley"] as const;
```

`window` other than `"week"` returns `400 invalid window`. `agentId` not in `ALEX_RILEY_ONLY` returns `404`.

### 5.3 Auth + scope

Identical to wins (`apps/api/src/routes/agent-home/wins.ts`):

- `requireOrganizationScope` extracts org from `request.organizationIdFromAuth`.
- Dev/test mode honors `x-org-id` header (mirrors decisions/wins routes; `app.authDisabled === true`).
- Returns `401` without scope.

### 5.4 Store availability

If `app.bookingStore == null` or `app.conversionRecordStore == null` → `503 stores unavailable`.

### 5.5 Adapter inside the route

```ts
const store: MetricsSignalStore = {
  countBookingsCreated: (i) =>
    app.bookingStore.countExcludingStatuses({
      orgId: i.orgId,
      excludeStatuses: i.excludeStatuses,
      from: i.from,
      to: i.to,
    }),
  countConversionsByType: (i) =>
    app.conversionRecordStore.countByType(i.orgId, i.type, i.from, i.to),
};
```

### 5.6 Inside `projectMetrics`

```ts
const week = buildWeekContext(input.now, input.timezone);
return input.agentKey === "alex"
  ? buildAlexMetricsViewModel({ orgId, week, store })
  : buildRileyMetricsViewModel({ orgId, week, store });
```

Each per-agent builder issues its counts via a single `Promise.all`. Total queries:

| Agent | Counts                                                                          | Total |
| ----- | ------------------------------------------------------------------------------- | ----- |
| Alex  | hero (1) + comparator (1) + leads (1) + 4 weekly buckets + 1–7 daily buckets    | 8–14  |
| Riley | hero (1) + comparator (1) + 4 weekly buckets + 1–7 daily buckets (Leads = hero) | 7–13  |

All counts; all on indexed columns once §7 migration lands.

### 5.7 Response

```ts
// 200 OK
{
  hero, heroSubProseSegments, spark, stats,
  freshness: {
    generatedAt: <ISO>,
    window: "week",
    dataSource: "live",
    unavailableSources?: string[],
  },
  folioRange: string,
}
```

Validated by Zod at the Next proxy boundary.

### 5.8 React Query

```ts
queryKey: ["metrics", agentKey, "week"];
queryFn: () => fetch(`/api/dashboard/agents/${agentKey}/metrics?window=week`);
staleTime: 60_000;
refetchOnWindowFocus: true;
```

No explicit invalidation hooks from the decision dispatcher in PR-S5; staleTime + window-focus is sufficient for aggregate counts.

---

## 6. Error handling & partial-data philosophy

### 6.1 Three orthogonal failure axes

| Axis                   | Meaning                                      | UX                                                | Carried where                                            |
| ---------------------- | -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| **Query failed**       | Network / 500 / 503 / 401 from the route     | `<AgentBlockBoundary>` block-level error fallback | React Query `isError`                                    |
| **Source unavailable** | We deliberately don't ingest this source yet | Cell `—`, folio chip `· no data: <labels>`        | `freshness.unavailableSources: string[]` + per-cell flag |
| **Empty data**         | Source wired, returns 0                      | `0` / `0%` / `$0` (real values)                   | No flag — true zero is honest                            |

This three-way distinction is the point of `rawValue: number | null`. Future analytics or sorting code that touches `StatCell.rawValue` will fail the type check before it can treat unavailable as zero.

### 6.2 `unavailableSources` taxonomy

Stable, non-prose tokens (API contract):

| Token                 | Meaning                                |
| --------------------- | -------------------------------------- |
| `ad-platform-spend`   | Spend column not yet ingested          |
| `ad-platform-ctr`     | CTR not yet ingested                   |
| `attribution-revenue` | Reserved for future revenue-attributed |

User-facing labels live in the block component:

```ts
const SOURCE_LABEL: Record<string, string> = {
  "ad-platform-spend": "spend",
  "ad-platform-ctr": "CTR",
};
// Folio chip: "· no data: spend" or "· no data: CTR, spend" (alphabetized)
```

### 6.3 Why all-or-nothing on DB reads

If any of the 7–14 `Promise.all` count queries throws, the whole projection rejects → 500 → `<AgentBlockBoundary>` shows the existing block-error fallback.

Reasons:

1. The dependent counts are mutually consistent or not; a missing weekly bucket renders as zero, visually identical to a real-zero week — worse than no graph at all.
2. Block-level errors are already handled by `<AgentBlockBoundary>` (shipped PR-S1). Reusing it costs nothing.
3. A 500 here is a sign of stack-level failure; React Query's automatic retry handles it.

No retry-with-backoff inside the projection. No degraded-mode response.

---

## 7. Migration

```prisma
// packages/db/prisma/schema.prisma — Booking model
@@unique([organizationId, contactId, service, startsAt])
@@index([organizationId, startsAt])
@@index([organizationId, createdAt])    // NEW — for agent-home metrics counts
@@index([contactId])
@@index([status])
```

**Why:** Alex's metrics fan-out issues 7–13 parallel `Booking.count` calls per `/alex` request (1 hero + 1 comparator + 4 weekly buckets + 1–7 daily buckets), all filtered by `organizationId + status NOT IN + createdAt range`. Existing Booking indexes (`(organizationId, startsAt)`, `[contactId]`, `[status]`) don't cover the `createdAt` filter, so without the new index Postgres falls back to scanning all rows for the org. Harmless for early orgs; grows linearly with booking volume.

**Generation flow** (per `feedback_prisma_migrate_dev_tty.md` — `migrate dev` blocks on TTY in agent sessions):

1. Edit `schema.prisma` to add the index.
2. `pnpm --filter @switchboard/db prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel packages/db/prisma/schema.prisma --script > packages/db/prisma/migrations/<timestamp>_booking_org_created_at_index/migration.sql`
3. Verify the generated SQL uses non-blocking index creation before commit (Postgres `CREATE INDEX CONCURRENTLY` is the desired form for a production-safe index add; if the generated DDL is plain `CREATE INDEX`, edit the migration to use `CONCURRENTLY` and add `-- prisma-migration-no-transaction` if required by the migration runner).
4. `pnpm --filter @switchboard/db prisma migrate deploy`
5. `pnpm db:check-drift` to confirm the migration matches the schema before commit.

The migration ships in the same commit as the projection code; the projection isn't safe to run at scale without it.

---

## 8. Testing

### 8.1 Core

**`packages/core/src/agent-home/__tests__/metrics.test.ts`**

- Dispatches to alex builder for `agentKey: "alex"`, riley for `"riley"`; throws on `"mira"`.
- `WeekContext` is computed exactly once and passed by reference (asserts via spy on `buildWeekContext`).
- `Date` constructor is not invoked inside `metrics-alex.ts` / `metrics-riley.ts` after `now` is captured (mock `Date` constructor; assert call site set excludes per-agent files). Same pattern wins uses.

**`packages/core/src/agent-home/__tests__/metrics-alex.test.ts`** — frozen `now = 2026-05-07T15:30:00+08:00` (Wed mid-day):

- Hero `tours-booked` value = mocked `countBookingsCreated(thisWeek)` return.
- Hero comparator window/value match `prevWeek`.
- Hero subprose voice — three branches: up, down, flat.
- Sparkline: 4 weekly + 3 daily (Mon/Tue/Wed) = 7 points; last is `isProjection: true`; preceding points are not.
- `stats[0]` Leads = `countConversionsByType("lead", thisWeek)`.
- `stats[1]` Conversion = `tours/leads` if leads > 0; `0` (not NaN) if leads = 0; display `"NN%"`.
- `stats[2]` Spend = `{ display: "—", rawValue: null, unavailable: true }`.
- `freshness.unavailableSources` = `["ad-platform-spend"]`; `dataSource: "live"`.
- `folioRange === "Mon — Wed"`.

**`packages/core/src/agent-home/__tests__/metrics-riley.test.ts`**

- Same skeleton with Riley sources.
- Riley voice — three branches.
- `stats[0]` Leads value === hero value.
- Both CTR and Spend cells unavailable; `unavailableSources: ["ad-platform-ctr","ad-platform-spend"]`.
- **Voice divergence test:** given the same delta `+5`, Alex says `"Up from N last week."` and Riley says `"+5 from last week."`.

**`packages/core/src/agent-home/__tests__/metrics-buckets.test.ts`**

- Monday-start week boundaries in `Asia/Singapore`.
- Daily bucket count: 1 on Mon, 7 on Sun.
- Weekly buckets are 4 contiguous, non-overlapping ranges immediately before `prevWeekStart`.
- `prevWeekStart`/`prevWeekEnd` exactly equal the most-recent weekly bucket.
- `folioRange` formatting per day-of-week (Monday: `"Mon"`; Wednesday: `"Mon — Wed"`; Sunday: `"Mon — Sun"`).

### 8.2 API route

**`apps/api/src/routes/agent-home/__tests__/metrics.test.ts`** — `buildTestServer` + mocked `bookingStore` and `conversionRecordStore` (mocked-Prisma per `feedback_api_test_mocked_prisma.md`):

- `200` for valid request.
- `400` for `window=today` / `window=month` / `window=invalid`.
- `404` for `agentId=mira`.
- `401` when no org scope.
- `503` when either store is unwired.
- `500` when one count rejects (asserts no partial response).
- `x-org-id` header propagates to all store calls (parameterized across all 7–14 calls).
- Response shape Zod-parses against `MetricsViewModel`.

### 8.3 Cross-tenant isolation

**`apps/api/src/__tests__/api-agent-home-metrics-isolation.test.ts`** — mirrors `api-agent-home-wins-isolation.test.ts`:

- Two orgs with different `Booking` + `ConversionRecord` rows.
- `GET /metrics` with org A's auth returns counts from org A only.
- Same request with org B's auth returns org B counts only.
- No row from org B leaks into org A's response or vice versa.

### 8.4 Dashboard

**`apps/dashboard/src/app/api/dashboard/agents/[agentId]/metrics/route.test.ts`** — proxy:

- Forwards to Fastify with auth-derived org header.
- `200` passthrough.
- Surfaces `400` / `404` / `500` from upstream.
- Validates upstream JSON via Zod; rejects malformed responses.

**`apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx`** — replaces existing fixture test:

- React Query test wrapper.
- `queryKey: ["metrics", agentKey, "week"]`; `staleTime: 60_000`.
- `data` shape on success; `isError` on 500.
- Refetch on window focus.

**`apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx`** — extends PR-S1 test:

- Renders `vm.folioRange` instead of hardcoded `"Mon — Fri"`.
- Renders `—` for cells with `unavailable: true`.
- Renders `· no data: spend` chip when one source unavailable.
- Renders `· no data: CTR, spend` (alphabetized) when multiple.
- Real-zero distinct: `rawValue: 0` with no `unavailable` renders `"0"` (not `"—"`).

**`apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx`** — extends PR-S1 test:

- All non-projection points → solid path.
- One projection point at end → dashed segment from prior point + dashed-ring circle.
- No projection point → behavior identical to prior snapshot.

### 8.5 Removed

- `getFixtureMetrics` and the `metrics` map in `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts`.
- `metrics` row in `_fixtures.test.ts` (if present).
- Fixture-form body of `use-agent-metrics.test.tsx` (replaced).

### 8.6 Coverage

`pnpm --filter @switchboard/core test` and `pnpm --filter @switchboard/api test` run with existing thresholds (core 65/65/70/65; global 55/50/52/55). Per-agent files and bucket helper are entirely test-covered; sparkline + block component additions are test-covered. No coverage-floor adjustments required.

---

## 9. Out of scope (explicitly deferred)

| Item                                                                  | Why deferred                                                | Future slice                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `window=today` / `window=month` semantics                             | React Query key already accepts `window`; no UI selector v1 | Future per-window slice                   |
| Name-drop subprose ("Maya, Jordan, Priya are most likely to convert") | Requires cross-block coupling to pipeline data              | Phase D enrichment                        |
| Per-org timezone read                                                 | Mirrors wins/pipeline `"Asia/Singapore"` fallback           | When `OrganizationConfigStore` gains `tz` |
| Ad-platform spend / CTR live ingestion                                | Cells render unavailable until ingestion lands              | Future ad-platform slice                  |
| `revenue-attributed` as Alex/Riley default hero                       | `LifecycleRevenueEvent` lacks `agentDeploymentId`           | Future schema change                      |
| Decision dispatcher cache invalidation for metrics                    | 60s staleTime + window-focus is sufficient for aggregates   | Add when an action needs immediate update |
| `countPerDay`/`groupBy`-shaped store capability                       | Bounded `Promise.all` fan-out is fast enough at v1 scale    | Add only if perf data demands it          |
| Mira agent home metrics                                               | `launchTier: "day-thirty"` — same gate as wins/pipeline     | Day-thirty product launch                 |
| Sparkline screen-reader description (point-by-point)                  | Sparkline ships `aria-hidden="true"`; stat cells convey it  | Future a11y enhancement                   |
| Removing the `agent-home/_fixtures.ts` file outright                  | Sibling block fixtures may still be cleared in PR-S6        | PR-S6 cutover                             |

---

## 10. Risks + mitigations

| Risk                                                                                    | Impact                                                | Mitigation                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Booking` count fan-out is slow without `(organizationId, createdAt)` index             | `/alex` becomes slow as booking volume grows          | Migration ships in the same commit (§7). Index creation is non-blocking. Without the migration the projection is gated.                                 |
| Hero/comparator/sparkline use slightly different week boundaries → off-by-one drift     | Numbers visibly contradict each other                 | Single `WeekContext` computed once; per-agent builders consume by reference; test asserts no `Date` constructor calls inside `metrics-{alex,riley}.ts`. |
| Alex and Riley voices drift toward the same phrasing                                    | Voice quality degrades                                | Voice configs locked at top of each per-agent file; voice-divergence test fails if both produce the same prose for the same delta.                      |
| `rawValue: 0` silently treated as a real metric value in some future analytics path     | Wrong conversions, wrong sorts                        | `rawValue: number \| null` makes the type system fail any code path that reads unavailable as zero.                                                     |
| Sparkline projection segment renders identically to solid segment                       | Today's partial day looks complete                    | Dashed stroke + dashed-ring circle, asserted by component test; no projection point → behavior identical to prior snapshot.                             |
| Folio header keeps showing `"Mon — Fri"` after live cutover                             | Friday-only orgs see wrong range; weekend looks empty | `folioRange` computed in core from `WeekContext`; block component reads `vm.folioRange`; hardcoded string removed in PR-S5.                             |
| Stat-cell `0` confused with "no data"                                                   | Operator misreads ad metrics                          | Three-axis UX: query-failed → block fallback; unavailable → `—` + no-data chip; real zero → `0`. Tests cover all three.                                 |
| Cross-tenant leak via aggregate counts                                                  | Privacy violation                                     | Cross-tenant isolation test asserts no row from one org influences another's counts; org scope flows through every `Promise.all` call.                  |
| `metrics-buckets.ts` math fails on DST-transition weeks                                 | Off-by-an-hour bucket boundary                        | `Asia/Singapore` has no DST so v1 is safe; helper is timezone-aware so future tz reads will correctly re-test. Documented as known limitation.          |
| Generated migration uses plain `CREATE INDEX` instead of `CREATE INDEX CONCURRENTLY`    | Production migration locks `Booking` table briefly    | §7 step 3 requires verifying generated SQL before commit; switch to `CONCURRENTLY` if needed.                                                           |
| Bucket fan-out grows quadratically if window enum expands without changes to projection | `today` / `month` PRs ship with the same N×M fan-out  | Documented as "add `countPerDay` capability when window enum expands" in §9. PR-S5 itself only ships `week`.                                            |

---

## 11. References

- **Parent spec**: `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` (§PR-S5 + §6 query-key contract)
- **Sibling specs**: `docs/superpowers/specs/2026-05-07-slice-b-pr-s3-design.md` (wins pattern), `docs/superpowers/specs/2026-05-07-slice-b-pr-s4-design.md` (pipeline pattern, `AgentHomeKey` shared)
- **Existing code**:
  - `apps/api/src/routes/agent-home/wins.ts` (auth/scope/store-availability template)
  - `apps/api/src/__tests__/api-agent-home-wins-isolation.test.ts` (cross-tenant template)
  - `packages/core/src/agent-home/wins.ts` (ProjectXxxInput template)
  - `packages/db/src/stores/prisma-booking-store.ts` (`countExcludingStatuses`)
  - `packages/db/src/stores/prisma-conversion-record-store.ts` (`countByType`)
  - `apps/dashboard/src/components/agent-home/{metrics-block,sparkline}.tsx` (PR-S1 components)
- **Memory**:
  - `feedback_api_test_mocked_prisma.md` — mocked Prisma test pattern
  - `feedback_prisma_migrate_dev_tty.md` — migrate diff + deploy flow
  - `feedback_surface_agnostic_backend.md` — core stays UI-agnostic
- **Doctrine**: `CLAUDE.md`, `docs/DOCTRINE.md`
