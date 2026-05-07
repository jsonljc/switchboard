# Slice B — Agent Home (Alex + Riley) — Design Spec

_2026-05-04 · supersedes nothing · part of the agent-first redesign track_

---

## 1. Problem & scope

### 1.1 What this slice ships

The per-agent home page surface — `/(auth)/[agentKey]/page.tsx` for `alex` and `riley` — and a new `/(auth)/page.tsx` Owner Home placeholder, both rendered inside a new `EditorialAuthShell`. Each agent home renders five blocks:

- **B1 Greeting** — prose + portrait, variant computer (`named-lead | quiet | busy`)
- **B2 Needs You** — Decision Card UI consuming the existing Decision Feed (already shipped on `feat/decision-feed-frontend`)
- **B3 Recent Wins** — terminal recommendations + (later) bookings/conversions, with undo affordances
- **B4 This Week** — per-agent hero metric + sparkline + 3 stat cells
- **B5 Pipeline** — per-agent stage classifier (Alex = `Contact.stage`; Riley = `PendingActionRecord` filtered by `sourceAgent="riley"`)

**Sequencing posture:** _fixture-first per block_, with B2 live in PR-S1. Production-gated until cutover. Six PRs (S1–S6).

### 1.2 What this slice explicitly does not ship

- `/reports` backend wiring (already shipped as static fixtures on `feat/decision-feed-frontend`; live data wiring is a future slice)
- Mira's agent surface (`launchTier: "day-thirty"` — `/mira` returns 404; brand-nav skips her)
- `AdSet` Prisma model + Meta API sync (Riley's pipeline projects from existing `PendingActionRecord` data only)
- `/contacts/[id]` and other detail destinations referenced by pipeline tiles (tiles render disabled)
- `useAgentFirstNav` flag wiring (Slice B uses production env gate only)
- Inbox drawer (header link is count-only — Phase C1)
- Owner Home content beyond a placeholder (its own future brainstorm)
- Migration of legacy routes (`/console`, `/decide`, `/escalations`, etc.) into the editorial shell

### 1.3 What's already shipped on `feat/decision-feed-frontend` (22 commits ahead of `main`, unmerged)

| Item                                                                                                | Commit refs                                    | What it provides                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `AGENT_REGISTRY` const                                                                              | `9ef10fc0`                                     | `alex/riley/mira` w/ `key`, `slug`, `role`, `displayName`, `accent`, `launchTier` |
| `OrgAgentEnablement` table + `prisma-agent-registry` store + `/api/dashboard/agents`                | `b062ebe4`                                     | Per-org enabled-agent list (read endpoint)                                        |
| Decision Feed core + endpoint + 2-source aggregator                                                 | `264db232`                                     | `Decision` discriminated union (`approval                                         | handoff`); `/api/decisions`; per-agent endpoint |
| `DecisionCard` component, `useDecisionFeed` hook, `dispatchDecisionAction`, `mapToDecisionCard`     | `0db11c19`, `2e9efc99`, `d5c1eb5d`, `66138972` | Editorial-styled card UI + dispatcher routing through per-kind endpoints          |
| Editorial + Mercury design tokens in `globals.css`; Source Serif 4 + JetBrains Mono in `layout.tsx` | `a50eb3a6`, `569ecfc6`                         | All tokens this slice needs already live in app shell                             |
| `/api/dashboard/decisions` + per-agent decisions Next.js proxies                                    | `58162b4f`, `dbe32d92`                         | Same proxy convention this slice extends                                          |
| `(preview)/decisions-preview` route, `notFound()`-gated in production                               | `5b04c9b2`                                     | Production-gating pattern this slice reuses                                       |
| `/reports` static page (8 sections + 3 fixtures + `useReportWindow` localStorage)                   | `b1ee2d9d`, etc.                               | Reports surface meets launch bar; backend wiring deferred                         |

This slice **builds on top** of that branch's state. It does not require any of the items above to be re-implemented.

---

## 2. Decisions ledger

This slice was brainstormed against 13 explicit questions. Each is locked here for downstream reviewers.

| #   | Question                       | Locked answer                                                                                                                                                                                                                                                                 |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Slice scope                    | Slice B = A3 shell + B1–B5, fixture-first per block. Reports backend deferred.                                                                                                                                                                                                |
| Q2  | Route shape                    | `/(auth)/page.tsx` = Owner Home placeholder; `/(auth)/[agentKey]/page.tsx` = agent workspaces (`alex`, `riley`); strict allowlist (`agentKey ∈ AGENT_KEYS` + org-enabled). Header brand-nav exposes `Home · Alex · Riley · +`. No automatic redirect from `/`.                |
| Q3  | Fixture vs live granularity    | Per-block fixture-first. PR-1 ships full page with B2 live + B1/B3/B4/B5 fixture-backed. Each fixture-backed block shows `· FIXTURE` folio badge in non-prod. Production-gated until cutover. Same gate pattern as `/decisions-preview`.                                      |
| Q4  | View-model contract authorship | Pre-spec'd in this brainstorm (§4). Page-ready read models, not DB-mirror types. Locks the contract before any backend PR opens.                                                                                                                                              |
| Q5  | View-model shapes              | See §4 for the locked v2 family with shared `AgentKey`, `AgentWindow`, `DataFreshness`, `ProseSegment`, `MetricComparator`, `AgentHomeLink`, plus per-block view models.                                                                                                      |
| Q6  | Endpoint shape                 | Four per-block sibling endpoints under `/api/dashboard/agents/[agentId]/`. Shared `AgentBlockResponse<T> = { data: T }` wrapper. No bundled `/home` endpoint, no aggregator. Mirrors existing `/decisions` proxy pattern.                                                     |
| Q7  | Backend layer placement        | One core module: `packages/core/src/agent-home/{greeting,wins,metrics,pipeline}.ts` + `index.ts` barrel. Sibling files, not subdirectories. API routes stay thin. Promote to subdirectories only when a block earns it.                                                       |
| Q8  | Header chrome ownership        | New `EditorialAuthShell` opt-in component at `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`. Slice B applies it only to `/` and `/[agentKey]`. Existing routes keep `app-shell.tsx`. `(auth)/layout.tsx` keeps auth boundary; shell owns chrome only.        |
| Q9  | Greeting variant computer      | Backend owns variant selection AND prose composition. Endpoint returns `GreetingViewModel` with composed `ProseSegments`. Decision dispatch invalidates greeting query alongside decisions/wins.                                                                              |
| Q10 | Header/page chrome elements    | Halt = provider-backed via existing `HaltProvider`; Inbox = live count + `aria-disabled` (no nav); Ambient cream = client island in shell, sets `--ambient-cream` on 60s interval; Tweaks panel = mounts only when `NEXT_PUBLIC_DEPLOY_ENV !== "production"` AND `?tweaks=1`. |
| Q11 | `useAgentFirstNav` flag        | Slice B does not consume the flag. Production env gate is sole gate. When Phase D wires the flag, route-availability check happens server-side; client only reads for UI state, never for gating.                                                                             |
| Q12 | Per-agent posture              | Riley's pipeline source = `PendingActionRecord` filtered by `sourceAgent="riley"` (no new schema). Mira excluded entirely (`/mira` returns 404; brand-nav skips). Brand-nav renders only org-enabled agents.                                                                  |
| Q13 | PR sequencing                  | Six PRs: S1 shell+B2-live; S2 greeting; S3 wins; S4 pipeline (Alex+Riley); S5 metrics; S6 cutover. Metrics last because per-agent metric definitions are most product-judgment-heavy.                                                                                         |

---

## 3. Architecture

### 3.1 Layered structure

```
Layer 1 (schemas)
  ─ AGENT_REGISTRY               (already shipped on feat branch)
  ─ AgentKey, AgentKeySchema     (already shipped)
  ─ NO new top-level types added in Slice B

Layer 3 (core)
  packages/core/src/agent-home/
    ├── greeting.ts              getAgentGreetingViewModel(input, deps)
    ├── wins.ts                  getAgentWinsViewModel(input, deps)
    ├── metrics.ts               getAgentMetricsViewModel(input, deps)
    ├── pipeline.ts              getAgentPipelineViewModel(input, deps)
    └── index.ts                 (barrel)
  packages/core/src/decisions/   (already shipped on feat branch)

  Core projections take dependency-injected stores. NO Prisma imports in core.
  Each *Deps is a typed bundle of read functions supplied by apps/api.

Layer 4 (db)
  ─ Existing stores only (Contact, Booking, ContactLifecycle, Opportunity,
    ConversionRecord, LifecycleRevenueEvent, PendingActionRecord, Handoff,
    EscalationRecord, CreativeJob, LlmUsageLog, AuditEntry).
  ─ OrgAgentEnablement (already shipped on feat branch).
  ─ NO new schema in Slice B.

Layer 5 (api: Fastify)
  apps/api/src/routes/
    ├── agent-home/
    │   ├── greeting.ts          GET /api/dashboard/agents/:agentId/greeting
    │   ├── wins.ts              GET /api/dashboard/agents/:agentId/wins?window=
    │   ├── metrics.ts           GET /api/dashboard/agents/:agentId/metrics?window=
    │   └── pipeline.ts          GET /api/dashboard/agents/:agentId/pipeline
    └── decisions.ts             (already shipped)

  Each route file owns its own zod query schema, deps construction (wrapping
  optional Prisma calls in try/catch → DepResult), and serializer. NO shared
  base, NO shared response-types package in Slice B.

Layer 5 (apps/dashboard: Next.js)
  apps/dashboard/src/
    ├── app/(auth)/
    │   ├── layout.tsx           (existing — auth boundary unchanged)
    │   ├── page.tsx             Owner Home placeholder (NEW)
    │   ├── __tests__/page.test.tsx
    │   └── [agentKey]/
    │       ├── page.tsx         AgentHomePage entry (server component)
    │       ├── agent-home-client.tsx  ("use client", orchestrates hooks)
    │       ├── _fixtures.ts     Per-agent fixtures (NEW; removed in PR-S6)
    │       └── __tests__/
    │           ├── page.test.tsx
    │           ├── route-allowlist.test.ts
    │           └── fixtures.test.ts
    ├── app/api/dashboard/agents/[agentId]/
    │   ├── decisions/route.ts   (already shipped)
    │   ├── greeting/route.ts    (NEW in PR-S2)
    │   ├── wins/route.ts        (NEW in PR-S3)
    │   ├── metrics/route.ts     (NEW in PR-S5)
    │   └── pipeline/route.ts    (NEW in PR-S4)
    ├── components/
    │   ├── layout/
    │   │   ├── editorial-auth-shell.tsx       (NEW; server component)
    │   │   ├── editorial-shell-boundary.tsx   (NEW; thin error boundary)
    │   │   ├── ambient-cream.tsx              (NEW; client island)
    │   │   └── tweaks-panel.tsx               (NEW; gated)
    │   └── agent-home/
    │       ├── greeting-block.tsx
    │       ├── wins-block.tsx
    │       ├── metrics-block.tsx
    │       ├── pipeline-block.tsx
    │       ├── needs-you-block.tsx            (thin wrapper around DecisionCard list)
    │       ├── sparkline.tsx
    │       ├── prose-segments.tsx             (renders ProseSegment[])
    │       ├── fixture-folio-badge.tsx        (returns null in production)
    │       ├── agent-block-boundary.tsx       (per-block error boundary)
    │       └── portrait/
    │           ├── alex.tsx
    │           └── riley.tsx
    ├── lib/agent-home/
    │   ├── types.ts                           Locked v2 view-model family (NEW)
    │   └── resolve-link.ts                    AgentHomeLink → href (NEW)
    └── hooks/
        ├── use-agent-greeting.ts
        ├── use-agent-wins.ts
        ├── use-agent-metrics.ts
        └── use-agent-pipeline.ts
```

### 3.2 Dependency rules

- `packages/core/src/agent-home/*` imports only `@switchboard/schemas` types and shared core helpers. **No Prisma.**
- `apps/api/src/routes/agent-home/*` imports `@switchboard/db` stores and constructs `*Deps` bundles. Wraps optional sub-source calls in `try/catch` → `DepResult`. Required sub-sources propagate exceptions.
- `apps/dashboard/src/lib/agent-home/types.ts` imports `AgentKey` from `@switchboard/schemas` and defines all view models locally. **Not promoted to schemas.**
- `apps/dashboard/src/components/agent-home/*` imports view models from `apps/dashboard/src/lib/agent-home/types.ts`. Block components are pure renderers — no internal data fetching, no React Query inside the block.
- `apps/dashboard/src/hooks/use-agent-*` hooks return `AgentBlockQuery<T>`, stable from PR-S1 onward (fixture form returns immediate data; live form swaps internals).

### 3.3 Layer-respect note

`packages/core` stays Layer 3 — it depends on `@switchboard/schemas` and `@switchboard/cartridge-sdk` and `@switchboard/sdk`, NOT on `@switchboard/db`. Dep injection is the seam.

---

## 4. Locked v2 view-model family

```ts
// apps/dashboard/src/lib/agent-home/types.ts
import type { AgentKey } from "@switchboard/schemas";

// ─── Shared ───────────────────────────────────────────────────
// Trailing windows, not calendar. "week" = trailing 7d ending now.
// "month" = trailing 30d. UI copy may say "This Week" — that's a
// label decision, not a windowing decision.
export type AgentWindow = "today" | "week" | "month";

export type DataSource = "fixture" | "live";

export interface DataFreshness {
  generatedAt: string; // ISO
  window: AgentWindow;
  dataSource: DataSource;
  isPartial?: boolean;
  unavailableSources?: readonly string[]; // optional sources that failed
}

export type ProseSegment = { kind: "text"; text: string } | { kind: "accent"; text: string };

export interface MetricComparator {
  window: AgentWindow;
  value: number;
}

// Backend identifies the object; frontend resolves the route.
// Pipeline tiles render disabled when the target route doesn't yet exist.
export type AgentHomeLink =
  | { kind: "contact"; id: string }
  | { kind: "ad-set"; id: string }
  | { kind: "creative-job"; id: string }
  | { kind: "agent-setup"; agentKey: AgentKey }
  | { kind: "all-wins"; agentKey: AgentKey };

// Stable async-shape contract for every block hook.
// PR-S1 fixture form returns immediate data; live PRs swap internals only.
export interface AgentBlockQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

// Wire-shape wrapper used by all four endpoints.
export interface AgentBlockResponse<T> {
  data: T;
}

// ─── B1 Greeting ──────────────────────────────────────────────
export type GreetingVariant = "named-lead" | "quiet" | "busy";

export interface GreetingViewModel {
  variant: GreetingVariant;
  segments: readonly ProseSegment[];
  signal: {
    inboxCount: number;
    oldestOpenItemAgeHours: number | null;
    hoursSinceLastOperatorAction: number | null;
  };
  freshness: DataFreshness;
}

// ─── B3 Recent Wins ───────────────────────────────────────────
// Source priority for v1: terminal PendingActionRecord (resolved/dismissed/confirmed).
// Bookings + ConversionRecord are optional `DepResult` sources — same shape,
// `source` field discriminates.
export type WinSource = "recommendation" | "booking" | "conversion";

export interface WinViewModel {
  id: string;
  agentKey: AgentKey; // future cross-agent inbox without contract churn
  source: WinSource;
  occurredAt: string; // ISO
  timeFolio: string; // pre-rendered: "11:42 AM" / "Yesterday · 6:14 PM"
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null; // ISO if available
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

// ─── B4 This Week ─────────────────────────────────────────────
// Per-agent hero is different. Discriminated union, not a polymorphic struct.
// `revenue-attributed` exists in the union but is not the default for either
// agent in Slice B (no per-agent attribution wiring on LifecycleRevenueEvent yet).
export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | { kind: "revenue-attributed"; value: number; currency: string; comparator: MetricComparator };

export interface SparkPoint {
  label: string; // "Mon" / "last week" — pre-rendered
  value: number;
  isProjection?: boolean;
}

// Stat cells are uniform across agents (3 columns), but the backend chooses
// what each cell means per-agent.
export interface StatCell {
  label: string;
  display: string; // pre-formatted: "47" / "26%" / "$0"
  rawValue: number;
  unit: "count" | "percent" | "currency";
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell]; // exactly 3
  freshness: DataFreshness;
}

// ─── B5 Pipeline ──────────────────────────────────────────────
// Pipeline is fundamentally different per agent, so the tile shape is shared
// but the *meaning* of `stage` and the source of `name`/`ctx` is per-agent.
export type PipelineStage = "hot" | "warm" | "new";

export interface PipelineTileViewModel {
  id: string; // contactId / pendingActionRecordId / creativeJobId
  stage: PipelineStage;
  name: string;
  ctx: string;
  link: AgentHomeLink; // typed link, frontend resolves to href
}

export interface PipelineViewModel {
  agentKey: AgentKey;
  pipelineKind: "leads" | "ad-sets" | "creatives";
  totalCount: number;
  countNoun: "people" | "ad sets" | "creatives";
  tiles: readonly PipelineTileViewModel[];
  setupLink: AgentHomeLink; // always { kind: "agent-setup", agentKey }
  freshness: DataFreshness;
}
```

### 4.1 Decision view-model (unchanged from feat branch)

The existing `Decision` type at `apps/dashboard/src/lib/decisions/types.ts` already meets the page-ready bar for B2. No changes in Slice B.

### 4.2 Route resolver

```ts
// apps/dashboard/src/lib/agent-home/resolve-link.ts
import type { AgentHomeLink } from "./types.js";

export type ResolvedAgentHomeLink =
  | { href: string; disabled: false }
  | { href: null; disabled: true; reason: "route-not-available" };

// Flip these flags as concrete routes ship. Slice B ships everything as
// disabled — pipeline tiles render as <span aria-disabled="true">.
const ROUTE_AVAILABILITY = {
  contact: false, // until /contacts/[id] ships (Phase D)
  "ad-set": false, // until Riley ad-set detail ships
  "creative-job": false, // Phase D
  "agent-setup": false, // until /[agent]/setup ships
  "all-wins": false, // until /[agent]/wins ships
} as const;

export function resolveAgentHomeLink(link: AgentHomeLink): ResolvedAgentHomeLink {
  if (!ROUTE_AVAILABILITY[link.kind]) {
    return { href: null, disabled: true, reason: "route-not-available" };
  }
  switch (link.kind) {
    case "contact":
      return { href: `/contacts/${link.id}`, disabled: false };
    case "ad-set":
      return { href: `/riley/ad-sets/${link.id}`, disabled: false };
    case "creative-job":
      return { href: `/mira/creatives/${link.id}`, disabled: false };
    case "agent-setup":
      return { href: `/${link.agentKey}/setup`, disabled: false };
    case "all-wins":
      return { href: `/${link.agentKey}/wins`, disabled: false };
  }
}
```

---

## 5. Backend contracts

### 5.1 Endpoints

```
GET /api/dashboard/agents/[agentId]/greeting              → AgentBlockResponse<GreetingViewModel>
GET /api/dashboard/agents/[agentId]/wins?window=today     → AgentBlockResponse<WinsViewModel>
GET /api/dashboard/agents/[agentId]/metrics?window=week   → AgentBlockResponse<MetricsViewModel>
GET /api/dashboard/agents/[agentId]/pipeline              → AgentBlockResponse<PipelineViewModel>
```

Same auth + isolation invariants as the existing `/decisions` endpoint (auth via NextAuth session → `orgId`; `agentId` validated against `AGENT_KEYS`; `OrgAgentEnablement` enforced).

### 5.2 Core projection signature pattern

```ts
// packages/core/src/agent-home/greeting.ts
export type DepResult<T> =
  | { ok: true; data: T }
  | { ok: false; source: string; error: unknown };

export interface GreetingDeps {
  // Required source — failure throws and becomes block-level error
  getInboxCount(input: { orgId: string; agentKey: AgentKey }): Promise<number>;
  // Optional sources — return DepResult so core can surface unavailableSources
  getOldestOpenItem(input: { orgId: string; agentKey: AgentKey }):
    Promise<DepResult<{ ageHours: number; contactName: string | null } | null>>;
  getLastOperatorActionAt(input: { orgId: string }):
    Promise<DepResult<Date | null>>;
}

export async function getAgentGreetingViewModel(
  input: { orgId: string; agentKey: AgentKey },
  deps: GreetingDeps,
): Promise<GreetingViewModel> {
  const inboxCount = await deps.getInboxCount(input);            // throws → 500
  const oldestRes = await deps.getOldestOpenItem(input);
  const lastActionRes = await deps.getLastOperatorActionAt({ orgId: input.orgId });

  const unavailableSources: string[] = [];
  if (!oldestRes.ok) unavailableSources.push(oldestRes.source);
  if (!lastActionRes.ok) unavailableSources.push(lastActionRes.source);

  const oldest = oldestRes.ok ? oldestRes.data : null;
  const lastAction = lastActionRes.ok ? lastActionRes.data : null;

  const variant = selectVariant({ inboxCount, oldest, lastAction });
  const segments = composeProse(variant, /* slots */, input.agentKey);

  return {
    variant,
    segments,
    signal: {
      inboxCount,
      oldestOpenItemAgeHours: oldest?.ageHours ?? null,
      hoursSinceLastOperatorAction: lastAction
        ? hoursBetween(lastAction, new Date())
        : null,
    },
    freshness: {
      generatedAt: new Date().toISOString(),
      window: "today",
      dataSource: "live",
      isPartial: unavailableSources.length > 0,
      unavailableSources: unavailableSources.length > 0 ? unavailableSources : undefined,
    },
  };
}
```

Same skeleton for `wins.ts`, `metrics.ts`, `pipeline.ts` — each with its own `*Deps` shape and its own discriminated set of required vs. optional sources. Per-agent voice profile constants live at the top of each file:

```ts
// e.g., packages/core/src/agent-home/greeting.ts top
const VOICE_PROFILES: Record<AgentKey, VoiceProfile> = {
  alex: {
    /* warm, conversational */
  },
  riley: {
    /* direct, numerical */
  },
  mira: assertNever, // Slice B excludes Mira
};
```

### 5.3 API route → core wiring

```ts
// apps/api/src/routes/agent-home/greeting.ts (sketch)
const queryParamsSchema = z.object({
  agentId: AgentKeySchema,
});

export async function greetingRoute(req, reply) {
  const { agentId } = queryParamsSchema.parse(req.params);
  const orgId = req.user.orgId;

  const deps: GreetingDeps = {
    getInboxCount: async ({ orgId, agentKey }) => {
      // Required — propagates exceptions
      return await prisma.pendingActionRecord.count({
        where: { organizationId: orgId, sourceAgent: agentKey, status: "pending" },
      });
    },
    getOldestOpenItem: async ({ orgId, agentKey }) => {
      try {
        const rec = await prisma.pendingActionRecord.findFirst(/* ... */);
        return {
          ok: true,
          data: rec
            ? {
                ageHours: hoursBetween(rec.createdAt, new Date()),
                contactName: rec.targetEntities?.contactName ?? null,
              }
            : null,
        };
      } catch (error) {
        return { ok: false, source: "pending-action-records", error };
      }
    },
    getLastOperatorActionAt: async ({ orgId }) => {
      try {
        const entry = await prisma.auditEntry.findFirst({
          where: { organizationId: orgId, actor: "operator" },
          orderBy: { createdAt: "desc" },
        });
        return { ok: true, data: entry?.createdAt ?? null };
      } catch (error) {
        return { ok: false, source: "audit-entry", error };
      }
    },
  };

  const vm = await getAgentGreetingViewModel({ orgId, agentKey: agentId }, deps);
  return reply.send({ data: vm } satisfies AgentBlockResponse<GreetingViewModel>);
}
```

### 5.4 Validation error mapping (locked)

| Layer                                                               | Invalid `agentKey`                           | Visible HTTP                                       |
| ------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Dashboard page (`(auth)/[agentKey]/page.tsx`)                       | `notFound()`                                 | 404 user-facing                                    |
| Dashboard proxy (`api/dashboard/agents/[agentId]/{block}/route.ts`) | `notFound()` (JSON `{ error: "not_found" }`) | 404 — hides agent identity from probing            |
| Fastify (`apps/api/src/routes/agent-home/{block}.ts`)               | `400` w/ zod-formatted error                 | Visible to authenticated, authorized requests only |

The split is asserted in tests for both layers — proxy 404 and Fastify 400 tests live side-by-side.

---

## 6. Components & data flow

### 6.1 Page composition tree (Alex Home — Riley identical with `agentKey="riley"`)

```
EditorialAuthShell
├── header.app-header
│   ├── BrandMark
│   ├── BrandNav (Home · Alex · Riley · +)   server: reads OrgAgentEnablement
│   ├── LivePip
│   ├── InboxLink (count via useInboxCount; aria-disabled, no nav)
│   ├── HaltButton (uses existing HaltProvider)
│   └── MeChip
└── main
    ├── GreetingBlock          (B1)          ← takes GreetingViewModel
    │   └── ProseSegments
    │   └── Portrait (per agentKey)
    ├── NeedsYouBlock          (B2 — live in PR-S1)  ← thin wrapper around DecisionCard list
    ├── WinsBlock              (B3)          ← takes WinsViewModel
    ├── MetricsBlock           (B4)          ← takes MetricsViewModel
    │   ├── HeroMetric (HeroMetric.kind discriminates render)
    │   ├── ProseSegments (heroSubProseSegments)
    │   ├── Sparkline (aria-hidden="true"; values represented in stat cells)
    │   └── StatRow (3 StatCells)
    └── PipelineBlock          (B5)          ← takes PipelineViewModel

AmbientCreamProvider                          client island, mounted in shell
TweaksPanel                                   gated: NEXT_PUBLIC_DEPLOY_ENV !== "production"
                                                     AND ?tweaks=1
```

Every block component:

- Renders the section folio (`.folio` with `<span.folio-l>` + `<span.folio-r>`).
- Right-folio appends `· FIXTURE` via `<FixtureFolioBadge dataSource={vm.freshness.dataSource}/>`.
- Reads only the view-model passed in. **No internal data fetching, no React Query inside the block.**
- Wrapped in `<AgentBlockBoundary/>` so a render error in one block doesn't blank the page.

### 6.2 Page-level data orchestration

```ts
// apps/dashboard/src/app/(auth)/[agentKey]/page.tsx (server component)
export default async function AgentHomePage({ params }: { params: { agentKey: string } }) {
  if (!AGENT_KEYS.includes(params.agentKey)) notFound();
  const agentKey = params.agentKey as AgentKey;
  if (!await orgHasAgentEnabled(agentKey)) notFound();
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();  // removed in PR-S6
  return <AgentHomeClient agentKey={agentKey}/>;
}
```

```ts
// apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx ("use client")
function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  const greeting = useAgentGreeting(agentKey);     // PR-S1: fixture; PR-S2: live
  const wins     = useAgentWins(agentKey);          // PR-S1: fixture; PR-S3: live
  const pipeline = useAgentPipeline(agentKey);      // PR-S1: fixture; PR-S4: live
  const metrics  = useAgentMetrics(agentKey);       // PR-S1: fixture; PR-S5: live
  return (
    <main>
      <AgentBlockBoundary><GreetingBlock vm={greeting.data!} agentKey={agentKey}/></AgentBlockBoundary>
      <AgentBlockBoundary><NeedsYouBlock agentKey={agentKey}/></AgentBlockBoundary>
      <AgentBlockBoundary><WinsBlock vm={wins.data!} agentKey={agentKey}/></AgentBlockBoundary>
      <AgentBlockBoundary><MetricsBlock vm={metrics.data!} agentKey={agentKey}/></AgentBlockBoundary>
      <AgentBlockBoundary><PipelineBlock vm={pipeline.data!}/></AgentBlockBoundary>
    </main>
  );
}
```

### 6.3 Hook signatures (stable from PR-S1)

```ts
// PR-S1 fixture form — useAgentGreeting
export function useAgentGreeting(agentKey: AgentKey): AgentBlockQuery<GreetingViewModel> {
  return {
    data: getFixtureGreeting(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}

// PR-S2 live form — same return type, internals swap
export function useAgentGreeting(agentKey: AgentKey): AgentBlockQuery<GreetingViewModel> {
  const q = useQuery({
    queryKey: ["greeting", agentKey],
    queryFn: () =>
      fetch(`/api/dashboard/agents/${agentKey}/greeting`)
        .then((r) => r.json() as Promise<AgentBlockResponse<GreetingViewModel>>)
        .then((resp) => resp.data),
  });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, error: q.error };
}
```

Block components and `AgentHomeClient` orchestration code are written once in PR-S1 and don't change in S2/S3/S4/S5.

### 6.4 React Query keys (locked)

```
["decisions",  agentKey]               (already exists)
["greeting",   agentKey]               PR-S2
["wins",       agentKey, window]       PR-S3 — window in key for future selector UI
["pipeline",   agentKey]               PR-S4
["metrics",    agentKey, window]       PR-S5 — window in key
```

### 6.5 Cache invalidation rules

| Trigger                                  | Invalidates (prefix invalidation)                                           |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Decision dispatch (resolve/undo/dismiss) | `["decisions", agentKey]` + `["greeting", agentKey]` + `["wins", agentKey]` |
| Win undo                                 | `["wins", agentKey]` + `["decisions", agentKey]`                            |

```ts
// React Query prefix invalidation, NOT a literal wildcard
queryClient.invalidateQueries({ queryKey: ["wins", agentKey] });
// Matches all windows: ["wins", agentKey, "today"], ["wins", agentKey, "week"], etc.
```

The decision dispatcher (`apps/dashboard/src/lib/decisions/dispatch-action.ts`, already exists on `feat/decision-feed-frontend`) extends in PR-S2 to invalidate greeting; PR-S3 adds wins invalidation. One line added per PR.

### 6.6 Per-agent variation surface

| Surface          | What varies per agent                                      | Where it lives                                                                    |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Portrait SVG     | Alex + Riley only in Slice B                               | `components/agent-home/portrait/{alex,riley}.tsx`                                 |
| Greeting voice   | Per-agent voice profile config                             | `core/agent-home/greeting.ts` (alex/riley branches; `assertNever` for mira)       |
| Wins prose       | Per-agent voice profile config                             | `core/agent-home/wins.ts` (alex/riley branches)                                   |
| Hero metric kind | `HeroMetric.kind` per agent                                | `core/agent-home/metrics.ts` (alex/riley branches)                                |
| Pipeline source  | Alex=`Contact.stage`, Riley=`PendingActionRecord` filtered | `core/agent-home/pipeline.ts` (alex/riley branches; `pipelineKind` discriminator) |
| Stat cells       | Different 3 cells per agent                                | `core/agent-home/metrics.ts`                                                      |

---

## 7. Freshness model + UI states

### 7.1 Freshness semantics

| Source                                         | `dataSource` | `unavailableSources`         |
| ---------------------------------------------- | ------------ | ---------------------------- |
| `_fixtures.ts` (PR-S1)                         | `"fixture"`  | n/a                          |
| Core projection, full success                  | `"live"`     | empty/undefined              |
| Core projection, partial (optional dep failed) | `"live"`     | array of failed source names |

### 7.2 Block-level UI states

| State                                                 | Renderer behavior                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `isLoading` (live PRs only)                           | Skeleton folio + skeleton prose lines (~3 hairline-bordered, animate-pulse)                                                                 |
| `isError`                                             | Folio renders + body shows `<p className="dc-resolved-line"><em>{agentName} couldn't load this block. <button>Try again</button></em></p>`  |
| `data` w/ `dataSource: "fixture"`                     | Normal render + `· FIXTURE` folio badge (suppressed in production — production gate would have already 404'd)                               |
| `data` w/ `dataSource: "live"` + `unavailableSources` | Normal render + small italic disclosure under the folio: `<p className="freshness-note"><em>Some data is temporarily unavailable.</em></p>` |
| `data` w/ `dataSource: "live"` and no missing sources | Normal render, no annotations                                                                                                               |

### 7.3 Empty states (per design)

| Block               | Empty source             | Renderer                                                                                    |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| B2 Decisions        | `decisions.length === 0` | `"You're caught up. I'll write again when something needs you."` (already in design bundle) |
| B3 Wins             | `wins.length === 0`      | `"No wins to show yet. {agentName} is still warming up."`                                   |
| B4 Metrics          | All-zero values          | Hero number renders as `0`, sparkline flat at zero — no special empty state                 |
| B5 Pipeline (Riley) | `tiles.length === 0`     | `"Riley will surface ad sets here when they need a decision."`                              |
| B5 Pipeline (Alex)  | `tiles.length === 0`     | `"No active leads yet. They'll appear here as conversations open."`                         |

---

## 8. Testing strategy

### 8.1 Layered approach

- **Core projections** — Pure-function tests, no Prisma. Deps passed as in-memory implementations. Per-agent voice profile branches (alex/riley) tested separately. Required vs. optional source failure paths each have a test. Coverage target: core thresholds (65/65/70/65).
- **API routes** — Mocked Prisma per `feedback_api_test_mocked_prisma.md`. Built with `buildTestServer`. Mirror `prisma-workflow-store.test.ts` pattern. Cross-org isolation test (`api-agent-home-isolation.test.ts`) covers all four endpoints.
- **Dashboard proxies** — Test that the proxy: rejects unauthenticated, validates `agentKey ∈ AGENT_KEYS`, checks `OrgAgentEnablement`, forwards to Fastify, surfaces errors as JSON. Existing `decisions/__tests__/route.test.ts` is the template.
- **Block components** — RTL render tests. Each block fed a `vm` fixture; tests cover FIXTURE folio badge, partial freshness disclosure, empty states, disabled pipeline tiles, accent segments.
- **Hook tests** — react-query test wrapper. Tests follow current implementation per PR — fixture-form tests in PR-S1; replaced by live tests in S2/S3/S4/S5 (no permanent transitional duplicates).
- **Page-level** — `notFound()` on bad key, on disabled agent, in production env. Renders `AgentHomeClient` for valid + enabled + non-prod.
- **Route allowlist** — Static filesystem assertion: each known top-level route has a concrete directory. No custom Next route resolver.

### 8.2 Error boundaries (thin)

`AgentBlockBoundary` and `EditorialShellBoundary` ship in PR-S1 with exactly four behaviors: catch render error, show fallback markup, `console.error` the error, reset on `agentKey` prop change. **No Sentry, no retry orchestration, no global error store, no error-message remoting.**

### 8.3 Coverage expectations per PR

| PR       | Coverage thresholds                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PR-S1    | Core stays at 65/65/70/65 (no new core code). Dashboard global 55/50/52/55 holds. Block + page tests carry the new code coverage. |
| PR-S2…S5 | Each PR adds core projections; threshold holds globally. Per-agent voice profile branches tested in both alex and riley paths.    |
| PR-S6    | No coverage delta — only deletions.                                                                                               |

### 8.4 Existing-pattern reuse list

- `buildTestServer` from `apps/api/src/__tests__/helpers/`
- Mocked Prisma pattern from `prisma-workflow-store.test.ts`
- React Query test wrapper from `apps/dashboard/src/hooks/__tests__/test-utils.ts`
- Cross-org isolation pattern from `api-decisions-isolation.test.ts`
- Production-gate test pattern from `decisions-preview` page tests

---

## 9. PR-by-PR breakdown

### PR-S1 — Shell, route, fixtures, B2 live, production gate

**Scope:** EditorialAuthShell + `/(auth)/page.tsx` Owner Home placeholder + `/(auth)/[agentKey]/page.tsx` route + view-model types + per-agent fixtures + B2 wired live + ambient cream + tweaks panel + halt provider button + inbox count display + production gate + error boundaries.

**Files added (representative — see §3.1 for full tree):**

- `apps/dashboard/src/app/(auth)/{page.tsx, __tests__/page.test.tsx}`
- `apps/dashboard/src/app/(auth)/[agentKey]/{page.tsx, agent-home-client.tsx, _fixtures.ts, __tests__/*}`
- `apps/dashboard/src/lib/agent-home/{types.ts, resolve-link.ts, __tests__/resolve-link.test.ts}`
- `apps/dashboard/src/components/layout/{editorial-auth-shell.tsx, editorial-shell-boundary.tsx, ambient-cream.tsx, tweaks-panel.tsx}`
- `apps/dashboard/src/components/agent-home/{greeting-block, wins-block, metrics-block, pipeline-block, needs-you-block, sparkline, prose-segments, fixture-folio-badge, agent-block-boundary}.tsx + __tests__/`
- `apps/dashboard/src/components/agent-home/portrait/{alex, riley}.tsx`
- `apps/dashboard/src/hooks/use-agent-{greeting, wins, metrics, pipeline}.ts + __tests__/`

**Files modified:**

- `apps/dashboard/src/lib/decisions/dispatch-action.ts` — add greeting + wins prefix invalidation

**Acceptance:**

- `/` renders Owner Home placeholder.
- `/alex` and `/riley` (when org-enabled, non-prod) render full page with B2 live + B1/B3/B4/B5 fixture-backed.
- Each fixture-backed block shows `· FIXTURE` folio badge.
- `/mira` 404s. `/{unenabled-agent}` 404s. Production env 404s.
- Brand-nav renders only enabled agents.
- Halt button toggles existing `HaltProvider`. Inbox link shows live count, no navigation.
- Ambient cream cycles via 60s interval.
- Tweaks panel only mounts when `NEXT_PUBLIC_DEPLOY_ENV !== "production" && ?tweaks=1`.
- Sparkline renders with `aria-hidden="true"`.
- Route allowlist test passes.

**Sizing:** Large but cohesive. Review by sub-area (shell / route / fixtures / B2 mount / boundaries), not file-by-file.

### PR-S2 — B1 Greeting live

**Adds:** `packages/core/src/agent-home/greeting.ts` + `index.ts` (initial barrel) + tests; `apps/api/src/routes/agent-home/greeting.ts` + tests; `api-agent-home-isolation.test.ts` (greeting first); dashboard greeting proxy + tests.

**Modifies:** `use-agent-greeting.ts` (live form); replace fixture test with live test; remove greeting fixture from `_fixtures.ts` and its fixture test.

**Acceptance:** Endpoint returns `AgentBlockResponse<GreetingViewModel>` with composed ProseSegments. Variant computer chooses `named-lead | quiet | busy` from signal. Per-agent voice differs verifiably between alex and riley. Decision dispatch invalidates greeting query. Cross-org isolation passes. Greeting block shows live data, no FIXTURE badge.

### PR-S3 — B3 Wins live

**Adds:** `packages/core/src/agent-home/wins.ts` + tests; `apps/api/src/routes/agent-home/wins.ts` + tests; dashboard wins proxy + tests.

**Modifies:** `index.ts` barrel; `api-agent-home-isolation.test.ts` (extend); `use-agent-wins.ts` (live); replace fixture test; `dispatch-action.ts` (wins invalidation on undo); remove wins fixture.

**Acceptance:** Wins endpoint sources from terminal `PendingActionRecord` for v1 (Bookings + Conversions optional `DepResult` sources). `unavailableSources` populated when optional deps fail. Per-agent voice differs in win prose. Undo respects `undoableUntil`; flips to `unavailableReason: "expired"` when past. Win undo invalidates wins + decisions keys.

### PR-S4 — B5 Pipeline live (Alex + Riley)

**Adds:** `packages/core/src/agent-home/pipeline.ts` + tests; `apps/api/src/routes/agent-home/pipeline.ts` + tests; dashboard pipeline proxy + tests.

**Modifies:** `index.ts`; `api-agent-home-isolation.test.ts`; `use-agent-pipeline.ts` (live); replace fixture test; remove pipeline fixture.

**Acceptance:** Alex pipeline sources from `Contact` filtered by org + recent activity; Riley pipeline sources from `PendingActionRecord` filtered by `sourceAgent="riley"`. Empty-state copy matches §7.3. Tiles render disabled (`<span aria-disabled="true">`) per `ROUTE_AVAILABILITY` constant.

### PR-S5 — B4 Metrics live

**Adds:** `packages/core/src/agent-home/metrics.ts` + tests; `apps/api/src/routes/agent-home/metrics.ts` + tests; dashboard metrics proxy + tests.

**Modifies:** `index.ts`; `api-agent-home-isolation.test.ts`; `use-agent-metrics.ts` (live); replace fixture test; remove metrics fixture.

**Acceptance:** Alex hero = `tours-booked` from `Booking` count. Riley hero = `ad-leads` from `ConversionRecord` of type `lead`. Sparkline returns 9-point series (5 trailing weeks + current week-to-date by day, per design). Stat cells per-agent. `revenue-attributed` exists in type union but is not the default for either agent in PR-S5 (gated until per-agent attribution wiring lands).

### PR-S6 — Cutover (minimal)

**Modifies:** `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx` — remove production gate.

**Removes:** `_fixtures.ts` and `fixtures.test.ts` (already empty by S5).

**Does NOT remove:** `FixtureFolioBadge` component. It becomes dormant (always reads `"live"`, returns null). A separate dead-code cleanup PR can remove it.

**Acceptance:** `/alex` and `/riley` accessible in production for orgs with the agents enabled. All blocks live; no FIXTURE badges anywhere. Smoke test from production-equivalent env passes. Manual QA confirms parity with the design bundle's visual treatment.

---

## 10. Out of scope (explicitly deferred)

| Item                                                                                                | Why deferred                                                                         | Future slice                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| `/reports` backend wiring (#11–#15)                                                                 | Static fixtures already meet launch bar                                              | Future "Reports backend" slice |
| `/contacts/[id]` detail route                                                                       | Pipeline tiles render disabled                                                       | Phase D Tools tier             |
| Riley ad-set detail route                                                                           | Pipeline tiles render disabled                                                       | Future when AdSet model lands  |
| `AdSet` Prisma model + Meta API sync                                                                | Riley uses `PendingActionRecord` projection in v1                                    | Future                         |
| Mira agent (`launchTier: "day-thirty"`)                                                             | Day-thirty product launch                                                            | Phase D after launch           |
| Inbox drawer (cross-agent decisions)                                                                | Header link is count-only in Slice B                                                 | Phase C1                       |
| Live mode overlay (current `/console`)                                                              | Header link absent; legacy chrome stays                                              | Phase C2                       |
| `useAgentFirstNav` flag wiring                                                                      | Slice B uses production env gate only                                                | Phase D rollout                |
| Migrating old routes (`/console`, `/decide`, etc.) into editorial shell                             | Coexist behind flag                                                                  | Phase D                        |
| Owner Home content                                                                                  | Placeholder only in PR-S1                                                            | Future brainstorm              |
| Per-window UI controls on `/wins` and `/metrics` (today/week/month)                                 | React Query keys already accept `window`; no UI selector ships                       | Future                         |
| Voice profile config externalized to per-org settings                                               | Hardcoded per-agent in core for v1                                                   | Future                         |
| Sparkline screen-reader description (point-by-point series)                                         | Sparkline ships `aria-hidden="true"`; stat cells communicate values                  | Future a11y enhancement        |
| `revenue-attributed` becoming an Alex/Riley default hero                                            | `LifecycleRevenueEvent` lacks `agentDeploymentId`                                    | Future schema change           |
| Reports static-implementation audit (verify token usage, design parity, mercury register isolation) | Already shipped on `feat/decision-feed-frontend`; small audit task, not a Slice B PR | Optional follow-up             |
| PDF export, scheduled-report email                                                                  | Reports backend slice, deferred                                                      | Future                         |
| SSE / WebSocket for live freshness                                                                  | All blocks poll via React Query in v1                                                | Future                         |
| Dead-code cleanup for `FixtureFolioBadge` after cutover                                             | Component becomes dormant in PR-S6                                                   | Optional follow-up             |

---

## 11. Risks + mitigations

| Risk                                                                                         | Impact                                                    | Mitigation                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-S1 size overshoots reviewer attention                                                     | Stalled merge, scope creep                                | PR description lists the 5 review sub-areas (shell / route / fixtures / B2 mount / boundaries); review by sub-area.                                                                                                                                                                                                    |
| Per-agent voice divergence drifts (alex sounds like riley)                                   | Voice quality degrades                                    | Voice profile constants live at the top of each `core/agent-home/{greeting,wins,metrics}.ts`; PR review checklist asks "did the per-agent test cases verify voice difference?"                                                                                                                                         |
| Riley's `PendingActionRecord`-based pipeline often empty in early orgs                       | Pipeline block looks broken                               | Empty-state copy locked + tested; PR-S4 explicitly tests the empty path.                                                                                                                                                                                                                                               |
| Fixture badges leak to production through env misconfiguration                               | Operator confusion                                        | Three-layer protection: (1) production gate `notFound()`s the page entirely until PR-S6 cutover, (2) `<FixtureFolioBadge/>` returns null in production, (3) by end of PR-S5 every fixture has been replaced by live data; PR-S6 deletes `_fixtures.ts` so only the dormant badge component remains (cleanup deferred). |
| Decision dispatcher's expanded invalidation list grows over time                             | Cache invalidation silently incomplete                    | Dispatcher's invalidation set lives in one function with per-action coverage tests; new actions force a test-update reminder.                                                                                                                                                                                          |
| Route allowlist test breaks when Phase D moves old routes                                    | Test fragility                                            | Test reads filesystem; warns about additions but adapts to deletions naturally. Test list is reviewed (not modified) per PR.                                                                                                                                                                                           |
| `LifecycleRevenueEvent` lacking `agentDeploymentId` blocks Alex revenue hero in future slice | Revenue-attributed hero remains aspirational              | Documented as Phase D schema concern; no Slice B fix attempted.                                                                                                                                                                                                                                                        |
| `OrgAgentEnablement` returning incorrect data for orgs created before Slice A                | Brand-nav misses agents                                   | Migration in Slice A (already shipped on feat branch) seeded enablement; verify on staging before PR-S1 merges. Listed as smoke-test gate.                                                                                                                                                                             |
| Cross-org probing via `/{agentKey}` URL guesses                                              | Information disclosure (which agents exist for which org) | Page returns `notFound()` for both invalid-key and disabled-for-org cases — same response.                                                                                                                                                                                                                             |
| Ambient cream causes layout shift on slow paints                                             | Visual jitter                                             | `--ambient-cream` is a CSS variable, applied only via `background:` transition; no layout impact. Initial value defaults to `hsl(40 25% 94%)` so first paint is correct without JS.                                                                                                                                    |
| Hook return shape changing across PRs                                                        | Page churn each block PR                                  | `AgentBlockQuery<T>` locked from PR-S1; live PRs swap internals only.                                                                                                                                                                                                                                                  |
| Pipeline tile dead links                                                                     | User confusion when clicking                              | `resolveAgentHomeLink` returns `disabled: true` for unavailable routes; tile renders as `<span aria-disabled="true">`, no `<a>`.                                                                                                                                                                                       |

---

## 12. References

- **Roadmap:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` (Phase B section + critical path)
- **Slice A spec:** `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`
- **Design bundles:**
  - `~/.claude/design-bundles/alex-home-design/switchboard/project/alex-home/` — `Alex Home.html`, `alex-home.css`, `alex-home.jsx`
  - `~/.claude/design-bundles/reports-design/switchboard/project/reports/` — Reports static surface
  - Chat 7 (Alex Home design intent), Chat 8 (Reports design intent)
- **Already-shipped on `feat/decision-feed-frontend` (22 commits ahead of `main`):** see §1.3 table.
- **Memory entries:**
  - `project_alex_home_reports_designs_locked.md`
  - `project_agent_first_redesign.md`
  - `project_canonical_agent_names.md`
  - `project_two_register_design.md`
  - `project_recommendations_v1_shipped.md`
  - `feedback_api_test_mocked_prisma.md`
  - `feedback_surface_agnostic_backend.md`
- **Doctrine:**
  - `CLAUDE.md` — branch & worktree doctrine; layer rules
  - `docs/DOCTRINE.md` — architectural rules
  - `docs/ARCHITECTURE.md` — deep architecture
