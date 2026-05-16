# Slice B PR-S4 — B5 Pipeline Live (Alex + Riley)

**Date**: 2026-05-07
**Author**: Jason (with Claude Code Opus 4.7)
**Parent spec**: `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` §PR-S4
**Status**: Design — pending user review
**PR scope**: Replace the B5 Pipeline block on `/alex` and `/riley` agent homes with live data sourced from Prisma.

---

## 1. Goal

Make the **B5 Pipeline** block on the agent home pages render live data instead of fixtures, for both Alex and Riley. Tiles render disabled (no detail-route navigation) per the parent spec — this PR ships only the projection + endpoint + live hook + block component.

**Acceptance** (from parent spec §PR-S4):

- Alex pipeline sources from `Contact`, filtered by org + recent activity.
- Riley pipeline sources from `PendingActionRecord`, filtered by `sourceAgent="riley"`.
- Empty-state copy matches parent spec §7.3.
- Tiles render as `<span aria-disabled="true">` per existing `ROUTE_AVAILABILITY` constant.

**Non-goals (deferred):**

- `/contacts/[id]` and ad-set detail routes (Phase D Tools tier)
- Per-org threshold configuration (will land as Modes — Conservative/Balanced/Aggressive — not raw knobs)
- Click-through telemetry
- SSE/WebSocket freshness

---

## 2. Locked decisions (from brainstorm)

| #           | Decision                                                                                | Reasoning                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Q1          | Single `PipelineSignalStore` with two methods (`listAlexPipeline`, `listRileyPipeline`) | Mirrors PR-S3's `WinsSignalStore` precedent; one dependency parameter on the projection                   |
| Q2a         | Alex stages = stage + recency tiebreaker (see §4.1)                                     | Honors funnel position; recency only splits the noisy `new` cohort                                        |
| Q2b         | Riley stages = hybrid riskLevel + dollarsAtRisk (see §4.2)                              | `riskLevel` alone is too blunt; orgs have different business weight per bucket                            |
| Q3a         | Alex ctx = stage framing + recency (`In conversation · 3h ago` / `New lead · 4d ago`)   | Surface-agnostic; doesn't fabricate sales intelligence                                                    |
| Q3b         | Riley ctx = `$<n> at risk · <verb>`                                                     | Money + verb tells you stakes + intent in one line                                                        |
| Q4          | `PIPELINE_VISIBLE_LIMIT = 5` shared across agents                                       | Pipeline-prefixed for greppability; `totalCount` reports separately so the count badge stays truthful     |
| Q5          | Disabled-tile linking already wired in `resolve-link.ts`                                | No frontend change to `ROUTE_AVAILABILITY`                                                                |
| Composition | Approach 2: public `pipeline.ts` + `pipeline-alex.ts` + `pipeline-riley.ts`             | Keeps public-symbol convention while staying under file-size warnings; enables parallel subagent dispatch |

---

## 3. Architecture

```
Browser
  └─ /alex or /riley
     └─ <PipelineBlock vm={pipelineQuery.data} />
        └─ useAgentPipeline(agentKey)  ← live React Query hook
           └─ GET /api/dashboard/agents/[agentId]/pipeline  (Next proxy)
              └─ GET /api/agents/[agentId]/pipeline           (Fastify)
                 └─ projectPipeline(input)                    (core)
                    └─ switch agentKey:
                       ├─ buildAlexPipelineViewModel(rows)
                       │    rows ← PipelineSignalStore.listAlexPipeline()
                       │           ← ContactStore.listForPipeline(orgId, since, limit)
                       │              ← PrismaContactStore (Postgres)
                       └─ buildRileyPipelineViewModel(rows)
                            rows ← PipelineSignalStore.listRileyPipeline()
                                   ← RecommendationStore.listPendingForAgent(...)
                                      ← PrismaRecommendationStore (Postgres)
```

### 3.1 Public surface (core)

PR-S3 already defined `AgentHomeKey = "alex" | "riley"` in `packages/core/src/agent-home/wins.ts`. PR-S4 **promotes that alias** to a new shared file `packages/core/src/agent-home/agent-key.ts` (single-line export), and `wins.ts`/`pipeline.ts` both import it from there. The wins-side import is a one-line change; no API churn for downstream consumers.

```ts
// packages/core/src/agent-home/agent-key.ts
export type AgentHomeKey = "alex" | "riley";

// packages/core/src/agent-home/pipeline.ts
import type { AgentHomeKey } from "./agent-key.js";

export interface PipelineSignalStore {
  listAlexPipeline(input: {
    orgId: string;
    activitySince: Date; // lastActivityAt cutoff
    limit: number; // PIPELINE_VISIBLE_LIMIT
  }): Promise<{ rows: AlexPipelineRow[]; totalCount: number }>;

  listRileyPipeline(input: {
    orgId: string;
    limit: number; // PIPELINE_VISIBLE_LIMIT
  }): Promise<{ rows: RileyPipelineRow[]; totalCount: number }>;
}

export interface ProjectPipelineInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: PipelineSignalStore;
}

export async function projectPipeline(input: ProjectPipelineInput): Promise<PipelineViewModel>;

// Re-exports of the per-agent row shapes + view-model types
export type { AlexPipelineRow } from "./pipeline-alex.js";
export type { RileyPipelineRow } from "./pipeline-riley.js";
```

`projectPipeline` switches on `agentKey` and delegates to one of two private builders. Both builders return the same `PipelineViewModel` shape (already locked in parent spec §B5).

### 3.2 Per-agent row shapes (core, internal-ish)

```ts
// pipeline-alex.ts
export interface AlexPipelineRow {
  id: string; // Contact.id
  name: string | null; // Contact.name (nullable)
  phone: string | null; // Contact.phone — used for fallback name
  stage: "active" | "new"; // narrowed from ContactStage
  lastActivityAt: Date;
}

// pipeline-riley.ts
export interface RileyPipelineRow {
  id: string; // PendingActionRecord.id
  intent: string; // e.g. "recommendation.pause_adset"
  humanSummary: string; // producer-curated one-liner
  riskLevel: "low" | "medium" | "high";
  dollarsAtRisk: number;
  confidence: number;
  approvalRequired: string; // schema is z.enum(["auto","human_review","operator_approval"])
  // but producer hardcodes "operator" today (see §4.2 note)
  campaignName: string; // from targetEntities.campaignName
  campaignId: string; // from targetEntities.campaignId
  createdAt: Date;
}
```

The api route's adapter converts Prisma rows to these shapes. The store interface deliberately returns rich rows (not pre-shaped tiles) so the projection owns all view-model construction.

---

## 4. Stage classifiers

### 4.1 Alex (Contact)

**Filter (push-down to Postgres):**

```sql
WHERE organizationId = $1
  AND stage IN ('active', 'new')
  AND lastActivityAt >= $2   -- now - 7 days
ORDER BY lastActivityAt DESC
LIMIT 5
```

`totalCount` = `count(*)` of the same filter.

Other stages (`customer`, `retained`, `dormant`) are **excluded entirely** — they're not in-funnel work.

**Classification:**

```
hot   = stage = "active"
warm  = stage = "new" AND lastActivityAt >= now - 24h
new   = stage = "new" AND lastActivityAt < now - 24h  (within the 7d window)
```

### 4.2 Riley (PendingActionRecord)

**Filter (push-down to Postgres):**

```sql
WHERE organizationId = $1
  AND surface = 'queue'
  AND status = 'pending'
  AND sourceAgent = 'riley'
  AND approvalRequired <> 'auto'   -- exclude auto-class rows defensively
ORDER BY
  riskLevel DESC,           -- "high" → "medium" → "low"
  dollarsAtRisk DESC,
  confidence ASC,           -- low confidence promoted (high-risk + uncertain = needs you)
  createdAt DESC
LIMIT 5
```

> **Producer-vs-schema note (grounded against `packages/db/src/recommendation-store.ts:105`):** Today the recommendations producer hardcodes `approvalRequired: "operator"` — a literal that's NOT in `ApprovalTypeSchema = z.enum(["auto","human_review","operator_approval"])` from `packages/schemas/src/workflow.ts:44`. The negative filter `<> 'auto'` is intentional: it honors the design intent (exclude auto-class actions from the operator queue) without coupling to a specific positive vocabulary. Auto-class actions don't currently land in `PendingActionRecord` anyway (they execute via a different path), so this filter is a defensive guard against future producer changes, not a current row-eliminator. Reconciliation of producer literals (`"operator"` → `"operator_approval"`) is out of scope for PR-S4.

`totalCount` = `count(*)` of the same filter.

> **Note on `riskLevel DESC`:** Postgres sorts text columns alphabetically, which gives `medium > low > high`. The store implementation must use a `CASE` expression or an explicit ordinal mapping (`high=3, medium=2, low=1`) to preserve the intended order. This is captured in §6.2 as a store-implementation detail.

**Classification:**

```ts
const RILEY_HIGH_DOLLAR_THRESHOLD = 500;
const RILEY_MEDIUM_DOLLAR_THRESHOLD = 100;

hot   = riskLevel === "high"
        OR (riskLevel === "medium" && dollarsAtRisk >= RILEY_HIGH_DOLLAR_THRESHOLD)
warm  = riskLevel === "medium"
        OR (riskLevel === "low" && dollarsAtRisk >= RILEY_MEDIUM_DOLLAR_THRESHOLD)
new   = riskLevel === "low" && dollarsAtRisk < RILEY_MEDIUM_DOLLAR_THRESHOLD
```

Constants are Riley-prefixed for greppability (Alex/future-agent thresholds will sit alongside without name collisions). They live at the top of `pipeline-riley.ts`. Future per-org tuning lands as Modes, not raw knobs (per memory: "Modes not knobs — opinionated defaults").

---

## 5. View-model construction

### 5.1 Alex tile

```
{
  id:    row.id,
  stage: row.stage === "active"
           ? "hot"
           : (now - row.lastActivityAt < 24h ? "warm" : "new"),
  name:  row.name ?? formatPhoneFallback(row.phone) ?? "Unnamed lead",
  ctx:   row.stage === "active"
           ? `In conversation · ${formatRelativeAge(row.lastActivityAt, now, tz)}`
           : `New lead · ${formatRelativeAge(row.lastActivityAt, now, tz)}`,
  link:  { kind: "contact", id: row.id }
}
```

`formatPhoneFallback(phone)`: returns last-4 digits prefixed with `"…"` (e.g. `"…7421"`) when phone is non-null, else `null`. If both name and fallback are null, tile name is `"Unnamed lead"`.

### 5.2 Riley tile

```
{
  id:    row.id,
  stage: classifyRileyStage(row),  // §4.2
  name:  row.campaignName,
  ctx:   `$${formatDollars(row.dollarsAtRisk)} at risk · ${humanizeIntent(row.intent)}`,
  link:  { kind: "ad-set", id: row.campaignId }
}
```

- `formatDollars(420.0)` → `"420"`; `(1200.5)` → `"1,200"` — comma-grouped, no decimals
- `humanizeIntent(intent)` uses an **explicit known-intent map first**, then falls back to a generic transform. Avoids over-flattening multi-word actions like `rotate_creative` to just `"rotate"`:
  ```ts
  const RILEY_ACTION_VERB_BY_INTENT: Record<string, string> = {
    "recommendation.pause_adset": "pause",
    "recommendation.rotate_creative": "rotate creative",
    "recommendation.scale_budget": "scale budget",
  };
  function humanizeIntent(intent: string): string {
    return (
      RILEY_ACTION_VERB_BY_INTENT[intent] ??
      intent.replace(/^recommendation\./, "").replace(/_/g, " ")
    );
  }
  ```
  Tests cover all three known intents plus the fallback path. New producer intents drop in to the map as Riley's action vocabulary expands.
- `$0 at risk` is allowed and read as "no immediate exposure"

### 5.3 PipelineViewModel envelope

```ts
{
  agentKey,
  pipelineKind: agentKey === "alex" ? "leads" : "ad-sets",
  countNoun:    agentKey === "alex" ? "people" : "ad sets",
  totalCount,                       // from store
  tiles: rows.slice(0, PIPELINE_VISIBLE_LIMIT).map(buildTile),
  setupLink: { kind: "agent-setup", agentKey },
  freshness: {
    generatedAt: now.toISOString(),
    window: "today",                // pipeline isn't a windowed query, but the field is required
    dataSource: "live",
  },
}
```

---

## 6. Backend changes (precise)

### 6.1 New core helper: `formatRelativeAge`

```ts
// packages/core/src/agent-home/relative-age.ts
export function formatRelativeAge(occurredAt: Date, now: Date, timezone: string): string;
```

Output format (per Q3):

- `< 1 minute` → `"just now"`
- `< 1 hour` → `"5m ago"`
- `same calendar day` → `"3h ago"`
- `previous calendar day` → `"yesterday"`
- `same calendar week` → `"3d ago"`
- `same calendar month` → `"12d ago"`
- `older` (earlier calendar month, same or prior year) → `"May 3"` (no year — pipeline rows are scoped to the trailing 7d window for Alex anyway, so older dates are only reachable via Riley's `createdAt` and only in tests)

Calendar boundaries computed in the supplied `timezone` (mirror `formatTimeFolio` behavior in `time-folio.ts`).

### 6.2 `RecommendationStore.listPendingForAgent`

Add to:

- `packages/core/src/recommendations/interfaces.ts` — interface declaration
- `packages/core/src/recommendations/in-memory-store.ts` — required so `vi.spyOn` finds it on api-test runtime (PR-S3 lesson)
- `packages/db/src/recommendation-store.ts` — Prisma implementation

```ts
listPendingForAgent(args: {
  orgId: string;
  agentKey: AgentKey;
  surface: "queue";
  limit: number;
}): Promise<{ rows: Recommendation[]; totalCount: number }>;
```

**Prisma implementation** uses a single `findMany` for rows + `count` for `totalCount`, both with the §4.2 filter. The `riskLevel DESC` ordering uses a Prisma `orderBy` array with a `CASE`-equivalent — concretely either:

```ts
// Approach: client-side ordinal injection via raw SQL fragment in orderBy
this.prisma.$queryRaw`
  SELECT * FROM "PendingActionRecord"
  WHERE "organizationId" = ${orgId} AND ...
  ORDER BY
    CASE "riskLevel" WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END DESC,
    "dollarsAtRisk" DESC,
    "confidence" ASC,
    "createdAt" DESC
  LIMIT ${limit}
`;
```

The implementation plan will pick the lowest-friction approach (raw SQL is fine here because it's a single read). The in-memory store sorts in JS using the same ordinal map.

### 6.3 `ContactStore.listForPipeline`

Add to:

- `packages/core/src/lifecycle/contact-store.ts` — interface
- `packages/db/src/stores/prisma-contact-store.ts` — Prisma implementation

```ts
listForPipeline(args: {
  orgId: string;
  activitySince: Date;
  limit: number;
}): Promise<{ rows: Contact[]; totalCount: number }>;
```

Filter from §4.1. Prisma uses `findMany` with `where: { organizationId, stage: { in: ["active","new"] }, lastActivityAt: { gte: activitySince } }`, `orderBy: { lastActivityAt: "desc" }`, `take: limit` + a parallel `count`.

The `(organizationId, lastActivityAt)` index covers the order-by + filter. Stage filter narrows the set after the index seek.

### 6.4 API route

```
apps/api/src/routes/agent-home/pipeline.ts
```

Mirrors `wins.ts` shape:

- `GET /agents/:agentId/pipeline` (no query params; pipeline is not windowed)
- Params Zod: `{ agentId: AgentKeySchema }`
- `agentId` ∉ `{alex, riley}` → 404 (mira excluded)
- `requireOrganizationScope` for org isolation
- **Per-agent precondition checks (§Q1 mild downside):**
  - Alex requires `app.contactStore` — 503 if missing
  - Riley requires `app.recommendationStore` — 503 if missing
  - Each check fires only for its own agent so an unavailable upstream store doesn't kill the other agent's request
- The route adapts whichever store is needed into a `PipelineSignalStore` object, then calls `projectPipeline()`
- 200 returns `{ vm: PipelineViewModel }`

**Test-server registration**: registered in BOTH `apps/api/src/bootstrap/routes.ts` AND `apps/api/src/__tests__/test-server.ts` (PR-S3 lesson).

### 6.5 Riley row adapter — `targetEntities` parsing

Riley's `PendingActionRecord.targetEntities` is `Json`. The producer (`packages/ad-optimizer/src/recommendation-sink.ts:191`) writes:

```ts
targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName }
```

The route adapter parses this with a defensive Zod schema. Rows that fail validation are dropped with a warning log (mirrors PR-S3 wins drop-on-null pattern).

```ts
const RileyTargetEntitiesSchema = z.object({
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
});
```

**Warning log contract** — when a Riley row is dropped, the log entry includes:

- `pendingActionRecordId` (the row's `id`)
- `orgId` (the org being served — owner of the row, no cross-org reference)
- `validationIssue` (the Zod error path + message — e.g. `"targetEntities.campaignName: required"`)

The log entry **must not** include `humanSummary`, `parameters`, or other PII-bearing fields, and **must not** include any other org's data. The api log already scopes per-request so cross-org leakage isn't possible at the line level, but the contract is explicit so log scrapers can rely on it. Mirror `apps/api/src/routes/agent-home/wins.ts:71–74` for the log shape (`{ recommendationId, orgId }, "wins: dropped row..."`); use the message prefix `"pipeline-riley:"`.

---

## 7. Dashboard changes (precise)

### 7.1 Next.js proxy

```
apps/dashboard/src/app/api/dashboard/agents/[agentId]/pipeline/route.ts
```

Mirrors `wins/route.ts` proxy: forwards to Fastify, surfaces upstream status codes.

### 7.2 SwitchboardClient

```
apps/dashboard/src/lib/api-client/governance.ts
```

Add `listPipeline(agentId: AgentKey): Promise<PipelineViewModel>` next to `listWins`.

### 7.3 Live hook

```
apps/dashboard/src/hooks/use-agent-pipeline.ts
```

Replaces fixture form. Mirrors `use-agent-wins.ts`:

- `useScopedQueryKeys()` for org-scoped cache key
- `enabled: !!keys` guard
- React Query default `staleTime`/`gcTime` to mirror wins
- Returns `AgentBlockQuery<PipelineViewModel>` (interface unchanged)

### 7.4 Block component

```
apps/dashboard/src/components/agent-home/pipeline-block.tsx
```

New file. Renders:

- Empty state literal copy from parent spec §7.3
  - Alex: `"No active leads yet. They'll appear here as conversations open."`
  - Riley: `"Riley will surface ad sets here when they need a decision."`
- Per-tile: branches on `resolveAgentHomeLink(tile.link).disabled` to render `<span aria-disabled="true">` or `<a href>`
- Stage chip (`hot` / `warm` / `new`) — visual treatment per design tokens (no new tokens; reuse existing chip styles from PR-S1's design system)
- `setupLink` rendered as a footer "Set up Alex / Riley" CTA (also disabled per `ROUTE_AVAILABILITY`)

### 7.5 Fixture cleanup

- `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts` — remove the `pipeline` const, the `getFixturePipeline` export
- `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts` — remove the pipeline test case
- `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` — add `vi.mock("@/hooks/use-agent-pipeline", ...)` returning a vm with `tiles: []` to bypass React Query (PR-S3 lesson — the test mocks tanstack with only `useQueryClient`)

---

## 8. Error handling

| Condition                                             | Response                                | Notes                                                                      |
| ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Invalid agentId param                                 | `400`                                   | Zod validation                                                             |
| `agentId === "mira"`                                  | `404`                                   | Mira not enabled on home (parent spec)                                     |
| Cross-org access (org-A header, org-B data)           | Empty result, no leakage                | Enforced by `requireOrganizationScope` + per-query `organizationId` filter |
| `app.contactStore` missing (Alex)                     | `503`                                   | Branched by agentKey                                                       |
| `app.recommendationStore` missing (Riley)             | `503`                                   | Branched by agentKey                                                       |
| Riley row fails `targetEntities` validation           | Drop row + warn log                     | Mirrors PR-S3 wins null-actedAt pattern                                    |
| Empty filter result                                   | `200` with `tiles: []`, `totalCount: 0` | Block component renders empty-state copy                                   |
| `formatRelativeAge` receives future date (clock skew) | Returns `"just now"`                    | Defensive                                                                  |
| Unknown error in projection                           | `500` with logged error                 | `try/catch` around `projectPipeline()`                                     |

No `DepResult` fan-out — both Alex and Riley have a single required source each. `isPartial` / `unavailableSources` not populated in PR-S4.

---

## 9. Testing strategy

### 9.1 Core unit tests

**`pipeline.test.ts`** — public surface integration test:

- Calls `projectPipeline({ agentKey: "alex", store: stub })` with a stub returning 3 rows; asserts shape, tile mapping, agentKey-specific countNoun
- Calls `projectPipeline({ agentKey: "riley", store: stub })` with a stub; asserts shape
- Asserts `tiles.length` capped at `PIPELINE_VISIBLE_LIMIT = 5` even when stub returns 10 rows
- Asserts `totalCount` flows through unchanged
- Asserts `freshness.dataSource === "live"` and `generatedAt` matches `now`

**`pipeline-alex.test.ts`** — Alex-only:

- Stage classifier: `active` → `hot`; `new` + 3h → `warm`; `new` + 4d → `new`
- Ctx format: `"In conversation · 3h ago"` and `"New lead · 4d ago"` (uses fake `now` + fake `formatRelativeAge` or real one)
- Name fallback: null name → phone last-4; null both → `"Unnamed lead"`
- Empty rows → `tiles: []`, `totalCount: 0`

**`pipeline-riley.test.ts`** — Riley-only:

- Classifier matrix (5 cells in §4.2):
  - `riskLevel=high, $50` → `hot`
  - `riskLevel=medium, $600` → `hot`
  - `riskLevel=medium, $200` → `warm`
  - `riskLevel=low, $150` → `warm`
  - `riskLevel=low, $50` → `new`
- Verb extraction: `intent="recommendation.pause_adset"` → ctx contains `"pause"`
- Dollar formatting: `$1200.5` → `"$1,200"`; `$0` → `"$0"`
- Tiles preserve store-side ordering (don't re-sort in projection)

**`relative-age.test.ts`** — formatter helper:

- Each output bucket from §6.1
- DST boundary cases (mirror `time-folio.test.ts` style)
- Future-date defensiveness

> **Type-safety preflight (PR-S3 lesson):** Tests must compile under `noUncheckedIndexedAccess`. `vm.tiles[0]` is `T | undefined` — write `vm.tiles[0]!.name` from the start, or `tsc --noEmit` will fail in CI even when vitest passes.

### 9.2 DB store tests

- `prisma-contact-store.test.ts` — add cases for `listForPipeline`: filter correctness, ordering, totalCount math
- `recommendation-store.test.ts` — add cases for `listPendingForAgent`: filter (auto excluded), 4-key ordering, totalCount

CI has no Postgres; these mock `PrismaClient` per the `prisma-workflow-store.test.ts` pattern (memory: feedback_api_test_mocked_prisma).

### 9.3 API route tests

- `routes/agent-home/__tests__/pipeline.test.ts`:
  - `GET /agents/alex/pipeline` → 200 with valid VM
  - `GET /agents/riley/pipeline` → 200 with valid VM
  - `GET /agents/mira/pipeline` → 404
  - `GET /agents/alex/pipeline` with `app.contactStore = undefined` → 503
  - `GET /agents/alex/pipeline` with `app.recommendationStore = undefined` → still 200 (Alex doesn't need it)
  - Riley row with malformed `targetEntities` → dropped, request still 200
- `__tests__/api-agent-home-pipeline-isolation.test.ts` — cross-tenant: emit Contact + PendingActionRecord under `org-A`; query as `org-B`; assert no leakage. Mirror `api-agent-home-wins-isolation.test.ts` template.

### 9.4 Dashboard tests

- `app/api/dashboard/agents/[agentId]/pipeline/__tests__/route.test.ts` — proxy: forwards correct URL, surfaces upstream status
- `hooks/__tests__/use-agent-pipeline.test.tsx` — live React Query hook (replaces existing fixture test). Asserts loading/error/data states, query-key shape
- `components/agent-home/__tests__/pipeline-block.test.tsx` — disabled-link rendering (`<span aria-disabled="true">` for both link kinds), empty-state copy literals, tile-name fallback rendering
- `app/(auth)/[agentKey]/__tests__/fixtures.test.ts` — pipeline test case removed; greeting + metrics cases remain

### 9.5 Type-check + workspace build

- `pnpm typecheck` after every batch of changes
- `pnpm --filter @switchboard/core build` after changing `agent-home/index.ts` exports — vitest in api tests resolves `@switchboard/core` from `dist/` (PR-S3 lesson)

---

## 10. Implementation order (parallel-ready)

Two independent tracks plus a sync point:

```
Track A (data layer)
  A1. ContactStore.listForPipeline (interface + Prisma + test)
  A2. RecommendationStore.listPendingForAgent (interface + in-memory + Prisma + test)

Track B (projection layer)        ← can start in parallel with A
  B1. relative-age.ts + test
  B2. pipeline-alex.ts + test (uses inline test-double for AlexPipelineRow)
  B3. pipeline-riley.ts + test (uses inline test-double for RileyPipelineRow)
  B4. pipeline.ts public surface + test

Sync: A + B complete

Track C (API)                     ← needs A + B
  C1. apps/api/src/routes/agent-home/pipeline.ts + test
  C2. Register in bootstrap/routes.ts AND __tests__/test-server.ts
  C3. apps/api/src/__tests__/api-agent-home-pipeline-isolation.test.ts

Track D (Dashboard)               ← needs C
  D1. Next.js proxy + test
  D2. SwitchboardClient.listPipeline
  D3. use-agent-pipeline.ts live form + test
  D4. pipeline-block.tsx + test
  D5. Fixture cleanup (_fixtures.ts, fixtures.test.ts, agent-home-client.test.tsx mock)
```

Tracks A and B are subagent-friendly (no shared state). The writing-plans pass will lay these out as discrete TDD tasks.

---

## 11. Out of scope (explicit)

| Item                                      | Future slice                                    |
| ----------------------------------------- | ----------------------------------------------- |
| `/contacts/[id]` and ad-set detail routes | Phase D Tools tier                              |
| Per-org tuning of dollar thresholds       | Future Modes (Conservative/Balanced/Aggressive) |
| Click-through telemetry on pipeline tiles | Phase D                                         |
| SSE/WebSocket freshness                   | Future                                          |
| `revenue-attributed` hero linkage         | PR-S5 (metrics) and beyond                      |
| Removing `_fixtures.ts` entirely          | PR-S6 cutover                                   |

---

## 12. Risks + mitigations

| Risk                                                                                    | Impact                                                                            | Mitigation                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `riskLevel DESC` text-sort gives wrong order                                            | Riley pipeline shows `medium` before `high`                                       | §6.2 specifies `CASE`/ordinal mapping; covered by store test                                             |
| Producer hardcodes `approvalRequired: "operator"` (literal not in `ApprovalTypeSchema`) | Naïve positive filter `IN ("human_review","operator_approval")` matches zero rows | §4.2 uses negative filter `<> "auto"` instead; producer-vs-schema reconciliation deferred (out of scope) |
| Riley `targetEntities` JSON shape drift from producer                                   | Tiles fail to render                                                              | Defensive Zod parsing + drop-with-warn (§6.5); store test with malformed row                             |
| `Contact.name` nullable                                                                 | Tiles render blank                                                                | Phone fallback + `"Unnamed lead"` (§5.1); covered by alex test                                           |
| Future per-org thresholds requires API change                                           | Knob-creep risk                                                                   | Constants at top of `pipeline-riley.ts`; future Modes wraps them, doesn't expose raw                     |
| `agent-home-client.test.tsx` regression on live hook                                    | Test breaks                                                                       | Mock pattern locked in §7.5 (mirror PR-S3)                                                               |
| Core `dist/` stale during api test run                                                  | False CI failures                                                                 | `pnpm --filter @switchboard/core build` step before api tests (§9.5)                                     |

---

## 13. References

- Parent spec: `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` §PR-S4 + §B5 + §7.3
- PR-S3 (Wins) precedent commit: `1ac89963` — `feat(redesign): PR-S3 — B3 Recent Wins live`
- PR-S2 (Greeting) precedent: `feat(dashboard): slice B PR-S2 — B1 greeting live` (#369, open)
- Pipeline audit: `.agent/notes/agent-home-pipeline-audit.md`
- Wins audit (template): `.agent/notes/agent-home-wins-audit.md`
- Schema: `packages/db/prisma/schema.prisma:1471` (Contact), `:1332` (PendingActionRecord)
- Producer: `packages/ad-optimizer/src/recommendation-sink.ts` (Riley `targetEntities` shape)
- Resolve link: `apps/dashboard/src/lib/agent-home/resolve-link.ts`
