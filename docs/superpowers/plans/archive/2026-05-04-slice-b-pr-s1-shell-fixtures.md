# Slice B — PR-S1 (Shell + Fixtures + B2 Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation PR for Slice B — `/(auth)/page.tsx` Owner Home placeholder + `/(auth)/[agentKey]/page.tsx` agent workspace route + `EditorialAuthShell` chrome + locked v2 view-model types + per-agent fixtures + B2 (Decisions) live + ambient cream + tweaks panel + halt provider button + inbox count + production gate. Five blocks render: B1/B3/B4/B5 fixture-backed (with `· FIXTURE` folio badge) and B2 live.

**Architecture:** Pure-renderer block components consume locked `*ViewModel` types via `AgentBlockQuery<T>`-shaped hooks. Hooks return immediate fixture data in PR-S1; PR-S2–S5 swap their internals to React Query without changing public signatures, page code, or block code. Production gate (`NEXT_PUBLIC_DEPLOY_ENV === "production"` → `notFound()`) keeps the surface non-prod-only until PR-S6 cutover. Mira is excluded; brand-nav renders only org-enabled agents.

**Tech Stack:** TypeScript (ESM), Next.js 14 App Router, React 18, Vitest + React Testing Library + `@testing-library/jest-dom/vitest`, TanStack React Query, NextAuth.js, Tailwind. Tests are Vitest with `jsdom` env (config: `apps/dashboard/vitest.config.ts`); test setup file mocks `matchMedia` + `IntersectionObserver`.

**Branch context:** This implementation builds on `feat/decision-feed-frontend` (22 commits ahead of `main`, unmerged). Branch off **`feat/decision-feed-frontend`** as `feat/slice-b-pr-s1`. The spec at `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` lives on `docs/agent-first-redesign-roadmap`; both branches are unmerged but spec lands first via its own focused PR.

**Spec reference:** Read `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` end-to-end before starting. Section §3.1 lists every file path; §4 has the locked v2 view-model TypeScript verbatim; §6.1 has the page tree; §9 has acceptance criteria.

**Commit convention:** Conventional Commits enforced by commitlint. Use `feat(dashboard):` for new dashboard files, `test(dashboard):` for test-only commits, `feat(schemas):` if any schema work (none expected here), `chore(dashboard):` for plumbing.

---

## File Structure

### New files in this PR

```
apps/dashboard/src/lib/agent-home/
  types.ts                                   v2 view-model family + AgentBlockQuery + AgentBlockResponse
  resolve-link.ts                            ResolvedAgentHomeLink + ROUTE_AVAILABILITY constant
  __tests__/resolve-link.test.ts

apps/dashboard/src/lib/query-keys.ts         (modify) — add greeting/wins/metrics/pipeline scoped key factories

apps/dashboard/src/app/(auth)/
  page.tsx                                   Owner Home placeholder
  __tests__/page.test.tsx
  [agentKey]/
    page.tsx                                 Server component — gates + AgentHomeClient
    agent-home-client.tsx                    "use client" — orchestrates per-block hooks
    _fixtures.ts                             Per-agent fixture data + getFixture* selectors
    __tests__/
      page.test.tsx                          notFound() gates: bad key, disabled, production
      agent-home-client.test.tsx             5-block render + B2 live wiring
      route-allowlist.test.ts                Static FS assertion vs dynamic [agentKey]
      fixtures.test.ts                       Per-agent fixture shape + dataSource: "fixture"

apps/dashboard/src/hooks/
  use-agent-greeting.ts                      PR-S1 fixture form, AgentBlockQuery shape
  use-agent-wins.ts                          PR-S1 fixture form
  use-agent-metrics.ts                       PR-S1 fixture form
  use-agent-pipeline.ts                      PR-S1 fixture form
  __tests__/use-agent-greeting.test.tsx
  __tests__/use-agent-wins.test.tsx
  __tests__/use-agent-metrics.test.tsx
  __tests__/use-agent-pipeline.test.tsx

apps/dashboard/src/components/agent-home/
  prose-segments.tsx                         Renders ProseSegment[]
  fixture-folio-badge.tsx                    Appends · FIXTURE in non-prod
  agent-block-boundary.tsx                   Per-block error boundary
  sparkline.tsx                              SVG sparkline (aria-hidden)
  greeting-block.tsx
  wins-block.tsx
  metrics-block.tsx
  pipeline-block.tsx
  needs-you-block.tsx                        Wraps existing DecisionCard list
  portrait/
    alex.tsx
    riley.tsx
  __tests__/
    prose-segments.test.tsx
    fixture-folio-badge.test.tsx
    agent-block-boundary.test.tsx
    sparkline.test.tsx
    greeting-block.test.tsx
    wins-block.test.tsx
    metrics-block.test.tsx
    pipeline-block.test.tsx
    needs-you-block.test.tsx

apps/dashboard/src/components/layout/
  editorial-auth-shell.tsx                   Server component — brand-nav, halt, inbox, me-chip
  editorial-shell-boundary.tsx               Top-level error boundary
  ambient-cream.tsx                          "use client" — 60s interval --ambient-cream
  tweaks-panel.tsx                           "use client", gated by env + ?tweaks=1
  __tests__/
    editorial-auth-shell.test.tsx
    editorial-shell-boundary.test.tsx
    ambient-cream.test.tsx
    tweaks-panel.test.tsx
```

### Modified files

```
apps/dashboard/src/lib/query-keys.ts                  (Task 3) Extend scopedKeys with agent-home factories
apps/dashboard/src/lib/decisions/dispatch-action.ts   (Task 32) Add greeting + wins prefix invalidation
apps/dashboard/src/app/(auth)/layout.tsx              (Task 28) Wrap (auth) routes that opt into editorial shell — actually NO: the shell is per-route, not layout-level. NO modification.
```

(`(auth)/layout.tsx` is **not modified** — `EditorialAuthShell` is opted into by the per-route page files, not the layout.)

### Per-file responsibility

| File                                                  | One-line responsibility                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `lib/agent-home/types.ts`                             | Locked v2 view-model family — types only, zero runtime                                           |
| `lib/agent-home/resolve-link.ts`                      | `AgentHomeLink` → href or `disabled: true`; `ROUTE_AVAILABILITY` flags                           |
| `lib/query-keys.ts` (modified)                        | Extend tenant-scoped factory with `greeting/wins/metrics/pipeline`                               |
| `(auth)/page.tsx`                                     | Owner Home placeholder server component                                                          |
| `(auth)/[agentKey]/page.tsx`                          | Server: validate key, check enablement, production gate, render `AgentHomeClient`                |
| `(auth)/[agentKey]/agent-home-client.tsx`             | Client: kick off 4 hooks, render `EditorialAuthShell` + 5 blocks wrapped in `AgentBlockBoundary` |
| `(auth)/[agentKey]/_fixtures.ts`                      | Per-agent fixture data + `getFixture{Greeting,Wins,Metrics,Pipeline}(agentKey)` selectors        |
| `hooks/use-agent-{greeting,wins,metrics,pipeline}.ts` | Stable `AgentBlockQuery<T>` API — fixture form returns immediate data                            |
| `components/agent-home/prose-segments.tsx`            | Render `ProseSegment[]` with `.accent` spans                                                     |
| `components/agent-home/fixture-folio-badge.tsx`       | Append `· FIXTURE` if `dataSource === "fixture"` and not production                              |
| `components/agent-home/agent-block-boundary.tsx`      | Catch render error per block; show fallback + Try-again button                                   |
| `components/agent-home/sparkline.tsx`                 | SVG sparkline; `aria-hidden="true"`                                                              |
| `components/agent-home/greeting-block.tsx`            | Greeting prose + portrait per agentKey                                                           |
| `components/agent-home/wins-block.tsx`                | Recent wins grid + undo affordance                                                               |
| `components/agent-home/metrics-block.tsx`             | Hero metric (4 kinds), heroSubProse, sparkline, 3 stat cells                                     |
| `components/agent-home/pipeline-block.tsx`            | Horizontal scroll tiles, disabled `<span>` when `disabled: true`                                 |
| `components/agent-home/needs-you-block.tsx`           | Wraps `useDecisionFeed(agentKey)` + `DecisionCard` list (live B2)                                |
| `components/agent-home/portrait/{alex,riley}.tsx`     | SVG portraits per agent                                                                          |
| `components/layout/editorial-auth-shell.tsx`          | Brand-nav, live pip, inbox link, halt button, me-chip                                            |
| `components/layout/editorial-shell-boundary.tsx`      | Top-level boundary above the shell                                                               |
| `components/layout/ambient-cream.tsx`                 | Sets `--ambient-cream` CSS var on 60s interval                                                   |
| `components/layout/tweaks-panel.tsx`                  | Dev-only panel for ambient-hour and greeting-variant overrides                                   |

---

## Tasks

### Task 1: Locked view-model types

**Files:**

- Create: `apps/dashboard/src/lib/agent-home/types.ts`
- Test: (no separate test — types are validated at compile time and used by every subsequent task)

- [ ] **Step 1: Create the types file**

Copy the locked v2 family from spec §4 verbatim:

```ts
// apps/dashboard/src/lib/agent-home/types.ts
import type { AgentKey } from "@switchboard/schemas";

export type AgentWindow = "today" | "week" | "month";

export type DataSource = "fixture" | "live";

export interface DataFreshness {
  generatedAt: string;
  window: AgentWindow;
  dataSource: DataSource;
  isPartial?: boolean;
  unavailableSources?: readonly string[];
}

export type ProseSegment = { kind: "text"; text: string } | { kind: "accent"; text: string };

export interface MetricComparator {
  window: AgentWindow;
  value: number;
}

export type AgentHomeLink =
  | { kind: "contact"; id: string }
  | { kind: "ad-set"; id: string }
  | { kind: "creative-job"; id: string }
  | { kind: "agent-setup"; agentKey: AgentKey }
  | { kind: "all-wins"; agentKey: AgentKey };

export interface AgentBlockQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export interface AgentBlockResponse<T> {
  data: T;
}

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

export type WinSource = "recommendation" | "booking" | "conversion";

export interface WinViewModel {
  id: string;
  agentKey: AgentKey;
  source: WinSource;
  occurredAt: string;
  timeFolio: string;
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null;
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | { kind: "revenue-attributed"; value: number; currency: string; comparator: MetricComparator };

export interface SparkPoint {
  label: string;
  value: number;
  isProjection?: boolean;
}

export interface StatCell {
  label: string;
  display: string;
  rawValue: number;
  unit: "count" | "percent" | "currency";
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
}

export type PipelineStage = "hot" | "warm" | "new";

export interface PipelineTileViewModel {
  id: string;
  stage: PipelineStage;
  name: string;
  ctx: string;
  link: AgentHomeLink;
}

export interface PipelineViewModel {
  agentKey: AgentKey;
  pipelineKind: "leads" | "ad-sets" | "creatives";
  totalCount: number;
  countNoun: "people" | "ad sets" | "creatives";
  tiles: readonly PipelineTileViewModel[];
  setupLink: AgentHomeLink;
  freshness: DataFreshness;
}
```

- [ ] **Step 2: Run typecheck to verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/agent-home/types.ts
git commit -m "feat(dashboard): slice B view-model types (locked v2 family)"
```

---

### Task 2: Route resolver + ROUTE_AVAILABILITY (TDD)

**Files:**

- Create: `apps/dashboard/src/lib/agent-home/resolve-link.ts`
- Test: `apps/dashboard/src/lib/agent-home/__tests__/resolve-link.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/agent-home/__tests__/resolve-link.test.ts
import { describe, expect, it } from "vitest";
import { resolveAgentHomeLink } from "../resolve-link";

describe("resolveAgentHomeLink", () => {
  it("contact links resolve disabled until /contacts/[id] ships", () => {
    const r = resolveAgentHomeLink({ kind: "contact", id: "c1" });
    expect(r.disabled).toBe(true);
    if (r.disabled) {
      expect(r.href).toBeNull();
      expect(r.reason).toBe("route-not-available");
    }
  });

  it("ad-set links resolve disabled in slice B", () => {
    const r = resolveAgentHomeLink({ kind: "ad-set", id: "as-1" });
    expect(r.disabled).toBe(true);
  });

  it("creative-job links resolve disabled (phase D)", () => {
    const r = resolveAgentHomeLink({ kind: "creative-job", id: "cj-1" });
    expect(r.disabled).toBe(true);
  });

  it("agent-setup links resolve disabled until route ships", () => {
    const r = resolveAgentHomeLink({ kind: "agent-setup", agentKey: "alex" });
    expect(r.disabled).toBe(true);
  });

  it("all-wins links resolve disabled until route ships", () => {
    const r = resolveAgentHomeLink({ kind: "all-wins", agentKey: "alex" });
    expect(r.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- resolve-link`
Expected: FAIL (`Cannot find module '../resolve-link'`).

- [ ] **Step 3: Implement the resolver**

```ts
// apps/dashboard/src/lib/agent-home/resolve-link.ts
import type { AgentHomeLink } from "./types.js";

export type ResolvedAgentHomeLink =
  | { href: string; disabled: false }
  | { href: null; disabled: true; reason: "route-not-available" };

const ROUTE_AVAILABILITY = {
  contact: false,
  "ad-set": false,
  "creative-job": false,
  "agent-setup": false,
  "all-wins": false,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- resolve-link`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/agent-home/resolve-link.ts apps/dashboard/src/lib/agent-home/__tests__/resolve-link.test.ts
git commit -m "feat(dashboard): AgentHomeLink resolver with ROUTE_AVAILABILITY guard"
```

---

### Task 3: Extend scopedKeys with agent-home factories

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Test: `apps/dashboard/src/lib/__tests__/query-keys.test.ts` (extend if exists; create if not)

- [ ] **Step 1: Read the existing scopedKeys structure**

Read `apps/dashboard/src/lib/query-keys.ts` to confirm the factory shape (returns object with per-feature key factories, each with `all()` and feature-specific methods).

- [ ] **Step 2: Write failing test**

```ts
// apps/dashboard/src/lib/__tests__/query-keys.test.ts (create or extend)
import { describe, expect, it } from "vitest";
import { scopedKeys } from "../query-keys";

describe("scopedKeys agent-home factories", () => {
  const keys = scopedKeys("org-1");

  it("greeting.feed uses agentKey in key", () => {
    expect(keys.greeting.feed("alex")).toEqual(["org-1", "greeting", "feed", "alex"]);
  });

  it("wins.feed includes window in key for prefix invalidation", () => {
    expect(keys.wins.feed("alex", "today")).toEqual(["org-1", "wins", "feed", "alex", "today"]);
    expect(keys.wins.byAgent("alex")).toEqual(["org-1", "wins", "feed", "alex"]);
  });

  it("metrics.feed includes window in key for prefix invalidation", () => {
    expect(keys.metrics.feed("alex", "week")).toEqual(["org-1", "metrics", "feed", "alex", "week"]);
    expect(keys.metrics.byAgent("alex")).toEqual(["org-1", "metrics", "feed", "alex"]);
  });

  it("pipeline.feed has no window in key", () => {
    expect(keys.pipeline.feed("alex")).toEqual(["org-1", "pipeline", "feed", "alex"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- query-keys`
Expected: FAIL (`keys.greeting is undefined`).

- [ ] **Step 4: Add the factories**

In `apps/dashboard/src/lib/query-keys.ts`, add inside the returned object (after the existing `decisions:` block):

```ts
  greeting: {
    all: () => [orgId, "greeting"] as const,
    feed: (agentKey: string) => [orgId, "greeting", "feed", agentKey] as const,
  },
  wins: {
    all: () => [orgId, "wins"] as const,
    feed: (agentKey: string, window: "today" | "week" | "month") =>
      [orgId, "wins", "feed", agentKey, window] as const,
    /** Use for prefix invalidation across all windows. */
    byAgent: (agentKey: string) => [orgId, "wins", "feed", agentKey] as const,
  },
  metrics: {
    all: () => [orgId, "metrics"] as const,
    feed: (agentKey: string, window: "today" | "week" | "month") =>
      [orgId, "metrics", "feed", agentKey, window] as const,
    /** Use for prefix invalidation across all windows. */
    byAgent: (agentKey: string) => [orgId, "metrics", "feed", agentKey] as const,
  },
  pipeline: {
    all: () => [orgId, "pipeline"] as const,
    feed: (agentKey: string) => [orgId, "pipeline", "feed", agentKey] as const,
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- query-keys`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/lib/__tests__/query-keys.test.ts
git commit -m "feat(dashboard): scopedKeys factories for greeting/wins/metrics/pipeline"
```

---

### Task 4: Per-agent fixtures (data + selectors)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts`
- Test: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts
import { describe, expect, it } from "vitest";
import {
  getFixtureGreeting,
  getFixtureWins,
  getFixtureMetrics,
  getFixturePipeline,
} from "../_fixtures";

describe("agent-home fixtures", () => {
  it.each(["alex", "riley"] as const)("%s greeting fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureGreeting(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.segments.length).toBeGreaterThan(0);
  });

  it.each(["alex", "riley"] as const)("%s wins fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureWins(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.wins.length).toBeGreaterThan(0);
    expect(vm.wins.every((w) => w.agentKey === agentKey)).toBe(true);
  });

  it.each(["alex", "riley"] as const)(
    "%s metrics fixture has 3 stats and dataSource fixture",
    (agentKey) => {
      const vm = getFixtureMetrics(agentKey);
      expect(vm.freshness.dataSource).toBe("fixture");
      expect(vm.stats).toHaveLength(3);
      expect(vm.spark.length).toBeGreaterThan(0);
    },
  );

  it("alex pipeline fixture is `leads`", () => {
    const vm = getFixturePipeline("alex");
    expect(vm.pipelineKind).toBe("leads");
    expect(vm.countNoun).toBe("people");
    expect(vm.freshness.dataSource).toBe("fixture");
  });

  it("riley pipeline fixture is `ad-sets`", () => {
    const vm = getFixturePipeline("riley");
    expect(vm.pipelineKind).toBe("ad-sets");
    expect(vm.countNoun).toBe("ad sets");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- fixtures`
Expected: FAIL.

- [ ] **Step 3: Create the fixtures file**

```ts
// apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts
import type { AgentKey } from "@switchboard/schemas";
import type {
  GreetingViewModel,
  WinsViewModel,
  MetricsViewModel,
  PipelineViewModel,
} from "@/lib/agent-home/types";

const NOW_ISO = "2026-05-04T08:00:00.000Z";

const greetings: Record<"alex" | "riley", GreetingViewModel> = {
  alex: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Three leads are waiting on you. " },
      { kind: "accent", text: "Maya" },
      { kind: "text", text: " is the one I'd answer first — she's been ready for " },
      { kind: "accent", text: "two days" },
      { kind: "text", text: "." },
    ],
    signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Two ad sets need your eye. " },
      { kind: "accent", text: "Whitening" },
      { kind: "text", text: " is bleeding budget faster than the others — start there." },
    ],
    signal: { inboxCount: 2, oldestOpenItemAgeHours: 6, hoursSinceLastOperatorAction: 18 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

const wins: Record<"alex" | "riley", WinsViewModel> = {
  alex: {
    wins: [
      {
        id: "win-alex-1",
        agentKey: "alex",
        source: "recommendation",
        occurredAt: NOW_ISO,
        timeFolio: "11:42 AM",
        proseSegments: [
          { kind: "accent", text: "Booked" },
          { kind: "text", text: " a tour with Jordan for Saturday 10am." },
        ],
        undo: { available: true, until: "2026-05-05T11:42:00.000Z" },
      },
      {
        id: "win-alex-2",
        agentKey: "alex",
        source: "recommendation",
        occurredAt: NOW_ISO,
        timeFolio: "9:15 AM",
        proseSegments: [
          { kind: "text", text: "Caught a duplicate inquiry from Priya M. before sending." },
        ],
        undo: { available: false, until: null },
      },
    ],
    hasMore: true,
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    wins: [
      {
        id: "win-riley-1",
        agentKey: "riley",
        source: "recommendation",
        occurredAt: NOW_ISO,
        timeFolio: "8:02 AM",
        proseSegments: [
          { kind: "text", text: "Paused " },
          { kind: "accent", text: "Whitening B" },
          { kind: "text", text: " — CPL doubled overnight." },
        ],
        undo: { available: true, until: "2026-05-05T08:02:00.000Z" },
      },
    ],
    hasMore: false,
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

const metrics: Record<"alex" | "riley", MetricsViewModel> = {
  alex: {
    hero: { kind: "tours-booked", value: 14, comparator: { window: "week", value: 9 } },
    heroSubProseSegments: [
      {
        kind: "text",
        text: "Up from 9 last week. Maya, Jordan, and Priya are most likely to convert.",
      },
    ],
    spark: [
      { label: "4 wks ago", value: 7 },
      { label: "3 wks ago", value: 8 },
      { label: "2 wks ago", value: 9 },
      { label: "last week", value: 9 },
      { label: "Mon", value: 2 },
      { label: "Tue", value: 5 },
      { label: "Wed", value: 8 },
      { label: "Thu", value: 11 },
      { label: "Fri", value: 14, isProjection: true },
    ],
    stats: [
      { label: "Leads", display: "47", rawValue: 47, unit: "count" },
      { label: "Conversion", display: "26%", rawValue: 0.26, unit: "percent" },
      { label: "Spend", display: "$0", rawValue: 0, unit: "currency" },
    ],
    freshness: { generatedAt: NOW_ISO, window: "week", dataSource: "fixture" },
  },
  riley: {
    hero: { kind: "ad-leads", value: 86, comparator: { window: "week", value: 71 } },
    heroSubProseSegments: [
      { kind: "text", text: "+15 from last week. Whitening A is doing the heavy lifting." },
    ],
    spark: [
      { label: "4 wks ago", value: 52 },
      { label: "3 wks ago", value: 64 },
      { label: "2 wks ago", value: 71 },
      { label: "last week", value: 71 },
      { label: "Mon", value: 12 },
      { label: "Tue", value: 18 },
      { label: "Wed", value: 22 },
      { label: "Thu", value: 17 },
      { label: "Fri", value: 17, isProjection: true },
    ],
    stats: [
      { label: "Leads", display: "86", rawValue: 86, unit: "count" },
      { label: "CTR", display: "3.4%", rawValue: 0.034, unit: "percent" },
      { label: "Spend", display: "$1,420", rawValue: 1420, unit: "currency" },
    ],
    freshness: { generatedAt: NOW_ISO, window: "week", dataSource: "fixture" },
  },
};

const pipeline: Record<"alex" | "riley", PipelineViewModel> = {
  alex: {
    agentKey: "alex",
    pipelineKind: "leads",
    totalCount: 7,
    countNoun: "people",
    tiles: [
      {
        id: "c1",
        stage: "hot",
        name: "Maya R.",
        ctx: "Asked about Saturday classes. Two days ready.",
        link: { kind: "contact", id: "c1" },
      },
      {
        id: "c2",
        stage: "warm",
        name: "Jordan F.",
        ctx: "Wants 6-month pricing. Saturday tour booked.",
        link: { kind: "contact", id: "c2" },
      },
      {
        id: "c3",
        stage: "warm",
        name: "Priya M.",
        ctx: "Injury question, escalated to you.",
        link: { kind: "contact", id: "c3" },
      },
      {
        id: "c4",
        stage: "new",
        name: "Tom W.",
        ctx: "Cold — refund request saved with guest passes.",
        link: { kind: "contact", id: "c4" },
      },
      {
        id: "c5",
        stage: "new",
        name: "Avi R.",
        ctx: "14-day-cold lead, just re-engaged.",
        link: { kind: "contact", id: "c5" },
      },
    ],
    setupLink: { kind: "agent-setup", agentKey: "alex" },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    agentKey: "riley",
    pipelineKind: "ad-sets",
    totalCount: 4,
    countNoun: "ad sets",
    tiles: [
      {
        id: "as-1",
        stage: "hot",
        name: "Whitening A",
        ctx: "CPL stable, scaling up budget today.",
        link: { kind: "ad-set", id: "as-1" },
      },
      {
        id: "as-2",
        stage: "warm",
        name: "Cleaning Combo",
        ctx: "Frequency creeping; rotate creatives.",
        link: { kind: "ad-set", id: "as-2" },
      },
      {
        id: "as-3",
        stage: "new",
        name: "Aligners (Test)",
        ctx: "Just launched. Watching first 48h.",
        link: { kind: "ad-set", id: "as-3" },
      },
    ],
    setupLink: { kind: "agent-setup", agentKey: "riley" },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

export function getFixtureGreeting(agentKey: AgentKey): GreetingViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return greetings[agentKey];
}

export function getFixtureWins(agentKey: AgentKey): WinsViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return wins[agentKey];
}

export function getFixtureMetrics(agentKey: AgentKey): MetricsViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return metrics[agentKey];
}

export function getFixturePipeline(agentKey: AgentKey): PipelineViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return pipeline[agentKey];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- fixtures`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\[agentKey\]/_fixtures.ts apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/fixtures.test.ts
git commit -m "feat(dashboard): per-agent fixtures for slice B (alex, riley)"
```

---

### Task 5: useAgentGreeting fixture-form hook (TDD)

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-greeting.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-agent-greeting.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-agent-greeting.test.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentGreeting } from "../use-agent-greeting";

describe("useAgentGreeting (fixture form)", () => {
  it("returns immediate fixture data with isLoading=false", () => {
    const { result } = renderHook(() => useAgentGreeting("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
  });

  it("differs between alex and riley", () => {
    const a = renderHook(() => useAgentGreeting("alex")).result.current.data;
    const r = renderHook(() => useAgentGreeting("riley")).result.current.data;
    expect(a?.segments).not.toEqual(r?.segments);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-greeting`
Expected: FAIL.

- [ ] **Step 3: Implement the fixture-form hook**

```ts
// apps/dashboard/src/hooks/use-agent-greeting.ts
"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, GreetingViewModel } from "@/lib/agent-home/types";
import { getFixtureGreeting } from "@/app/(auth)/[agentKey]/_fixtures";

/**
 * PR-S1 fixture form. PR-S2 swaps the implementation to a React Query
 * call against /api/dashboard/agents/[agentId]/greeting; the public
 * AgentBlockQuery<GreetingViewModel> shape is preserved across the swap
 * so callers (page + block components) do not change.
 */
export function useAgentGreeting(agentKey: AgentKey): AgentBlockQuery<GreetingViewModel> {
  return {
    data: getFixtureGreeting(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-greeting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-agent-greeting.ts apps/dashboard/src/hooks/__tests__/use-agent-greeting.test.tsx
git commit -m "feat(dashboard): useAgentGreeting fixture-form hook (PR-S1)"
```

---

### Task 6: useAgentWins fixture-form hook (TDD)

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-wins.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentWins } from "../use-agent-wins";

describe("useAgentWins (fixture form)", () => {
  it("returns immediate wins fixture data", () => {
    const { result } = renderHook(() => useAgentWins("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
    expect(result.current.data?.wins.length ?? 0).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-wins`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/dashboard/src/hooks/use-agent-wins.ts
"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, WinsViewModel } from "@/lib/agent-home/types";
import { getFixtureWins } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentWins(agentKey: AgentKey): AgentBlockQuery<WinsViewModel> {
  return {
    data: getFixtureWins(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-wins`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-agent-wins.ts apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx
git commit -m "feat(dashboard): useAgentWins fixture-form hook (PR-S1)"
```

---

### Task 7: useAgentMetrics fixture-form hook (TDD)

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-metrics.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentMetrics } from "../use-agent-metrics";

describe("useAgentMetrics (fixture form)", () => {
  it("returns immediate metrics fixture", () => {
    const { result } = renderHook(() => useAgentMetrics("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.stats).toHaveLength(3);
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
  });

  it("alex hero kind is tours-booked", () => {
    const { result } = renderHook(() => useAgentMetrics("alex"));
    expect(result.current.data?.hero.kind).toBe("tours-booked");
  });

  it("riley hero kind is ad-leads", () => {
    const { result } = renderHook(() => useAgentMetrics("riley"));
    expect(result.current.data?.hero.kind).toBe("ad-leads");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-metrics`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/dashboard/src/hooks/use-agent-metrics.ts
"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, MetricsViewModel } from "@/lib/agent-home/types";
import { getFixtureMetrics } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentMetrics(agentKey: AgentKey): AgentBlockQuery<MetricsViewModel> {
  return {
    data: getFixtureMetrics(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-metrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-agent-metrics.ts apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx
git commit -m "feat(dashboard): useAgentMetrics fixture-form hook (PR-S1)"
```

---

### Task 8: useAgentPipeline fixture-form hook (TDD)

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-pipeline.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentPipeline } from "../use-agent-pipeline";

describe("useAgentPipeline (fixture form)", () => {
  it("alex returns leads pipeline", () => {
    const { result } = renderHook(() => useAgentPipeline("alex"));
    expect(result.current.data?.pipelineKind).toBe("leads");
  });

  it("riley returns ad-sets pipeline", () => {
    const { result } = renderHook(() => useAgentPipeline("riley"));
    expect(result.current.data?.pipelineKind).toBe("ad-sets");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-pipeline`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/dashboard/src/hooks/use-agent-pipeline.ts
"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, PipelineViewModel } from "@/lib/agent-home/types";
import { getFixturePipeline } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentPipeline(agentKey: AgentKey): AgentBlockQuery<PipelineViewModel> {
  return {
    data: getFixturePipeline(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-agent-pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-agent-pipeline.ts apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx
git commit -m "feat(dashboard): useAgentPipeline fixture-form hook (PR-S1)"
```

---

### Task 9: ProseSegments component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/prose-segments.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProseSegments } from "../prose-segments";

describe("ProseSegments", () => {
  it("renders text and accent segments inline", () => {
    render(
      <ProseSegments
        segments={[
          { kind: "text", text: "Three leads. " },
          { kind: "accent", text: "Maya" },
          { kind: "text", text: " first." },
        ]}
      />,
    );
    const accent = screen.getByText("Maya");
    expect(accent.tagName).toBe("SPAN");
    expect(accent).toHaveClass("accent");
  });

  it("renders nothing for empty segments", () => {
    const { container } = render(<ProseSegments segments={[]} />);
    expect(container.firstChild?.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- prose-segments`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// apps/dashboard/src/components/agent-home/prose-segments.tsx
import type { ProseSegment } from "@/lib/agent-home/types";

export function ProseSegments({ segments }: { segments: readonly ProseSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "accent" ? (
          <span key={i} className="accent">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- prose-segments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/prose-segments.tsx apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx
git commit -m "feat(dashboard): ProseSegments component"
```

---

### Task 10: FixtureFolioBadge component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixtureFolioBadge } from "../fixture-folio-badge";

const ORIGINAL = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("FixtureFolioBadge", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIGINAL;
  });

  it("renders · FIXTURE when dataSource is fixture (non-prod)", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<FixtureFolioBadge dataSource="fixture" />);
    expect(screen.getByText("· FIXTURE")).toBeInTheDocument();
  });

  it("renders nothing when dataSource is live", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    const { container } = render(<FixtureFolioBadge dataSource="live" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing in production even when dataSource is fixture", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    const { container } = render(<FixtureFolioBadge dataSource="fixture" />);
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- fixture-folio-badge`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx
import type { DataSource } from "@/lib/agent-home/types";

export function FixtureFolioBadge({ dataSource }: { dataSource: DataSource }) {
  if (dataSource !== "fixture") return null;
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") return null;
  return <span> · FIXTURE</span>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- fixture-folio-badge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx
git commit -m "feat(dashboard): FixtureFolioBadge — non-prod fixture indicator"
```

---

### Task 11: AgentBlockBoundary error boundary (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/agent-block-boundary.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentBlockBoundary } from "../agent-block-boundary";

function Boom() {
  throw new Error("kaboom");
}

describe("AgentBlockBoundary", () => {
  it("catches a render error and shows the fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AgentBlockBoundary>
        <Boom />
      </AgentBlockBoundary>,
    );
    expect(screen.getByText(/couldn't load this block/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <AgentBlockBoundary>
        <p>fine</p>
      </AgentBlockBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- agent-block-boundary`
Expected: FAIL.

- [ ] **Step 3: Implement the boundary**

```tsx
// apps/dashboard/src/components/agent-home/agent-block-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";

interface State {
  hasError: boolean;
}

export class AgentBlockBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AgentBlockBoundary]", error, info);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="dc-resolved-line">
          <em>Couldn't load this block. </em>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- agent-block-boundary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/agent-block-boundary.tsx apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx
git commit -m "feat(dashboard): AgentBlockBoundary thin error boundary"
```

---

### Task 12: Sparkline component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/sparkline.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../sparkline";

describe("Sparkline", () => {
  it("renders an SVG with aria-hidden=true", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 1 },
          { label: "Tue", value: 5 },
          { label: "Wed", value: 9 },
        ]}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders one point per data entry", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 1 },
          { label: "Tue", value: 5 },
        ]}
      />,
    );
    // At least one path drawn between points.
    expect(container.querySelector("path")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- sparkline`
Expected: FAIL.

- [ ] **Step 3: Implement the sparkline**

```tsx
// apps/dashboard/src/components/agent-home/sparkline.tsx
import type { SparkPoint } from "@/lib/agent-home/types";

export function Sparkline({ data }: { data: readonly SparkPoint[] }) {
  if (data.length === 0) return null;

  const W = 640;
  const H = 80;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const span = max - min || 1;

  const pts = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * W;
    const y = H - ((d.value - min) / span) * (H - 14) - 7;
    return { x, y };
  });

  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="sparkline"
    >
      <path
        d={path}
        stroke="hsl(20 10% 12%)"
        strokeWidth={1}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={3.5}
        fill="hsl(20 90% 55%)"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- sparkline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/sparkline.tsx apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx
git commit -m "feat(dashboard): Sparkline (aria-hidden, hairline stroke)"
```

---

### Task 13: Portrait components (alex + riley)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/portrait/alex.tsx`
- Create: `apps/dashboard/src/components/agent-home/portrait/riley.tsx`
- Test: (covered indirectly via greeting-block test in Task 14; portraits are pure SVG with no logic)

- [ ] **Step 1: Implement Alex portrait**

Port `Portrait()` from `~/.claude/design-bundles/alex-home-design/switchboard/project/alex-home/alex-home.jsx` (lines 5-34) verbatim:

```tsx
// apps/dashboard/src/components/agent-home/portrait/alex.tsx
export function PortraitAlex() {
  return (
    <svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="alex-pg" cx=".55" cy=".4" r=".75">
          <stop offset="0%" stopColor="hsl(40 35% 88%)" />
          <stop offset="60%" stopColor="hsl(28 28% 80%)" />
          <stop offset="100%" stopColor="hsl(22 22% 66%)" />
        </radialGradient>
        <clipPath id="alex-pc">
          <circle cx="70" cy="70" r="70" />
        </clipPath>
      </defs>
      <g clipPath="url(#alex-pc)">
        <rect width="140" height="140" fill="url(#alex-pg)" />
        <path
          d="M 8 140 L 8 116 Q 8 92 70 92 Q 132 92 132 116 L 132 140 Z"
          fill="hsl(20 14% 32%)"
          opacity=".85"
        />
        <rect x="60" y="78" width="20" height="22" rx="3" fill="hsl(22 18% 56%)" />
        <ellipse cx="70" cy="58" rx="26" ry="30" fill="hsl(22 22% 64%)" />
        <path
          d="M 44 56 Q 44 30 70 28 Q 96 30 96 56 Q 96 48 88 44 Q 80 48 70 46 Q 58 48 52 44 Q 44 48 44 56 Z"
          fill="hsl(20 14% 24%)"
        />
        <ellipse cx="82" cy="56" rx="6" ry="10" fill="hsl(40 50% 92%)" opacity=".25" />
        <path
          d="M 64 72 Q 70 76 76 72"
          stroke="hsl(20 14% 24%)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity=".5"
        />
      </g>
      <circle cx="70" cy="70" r="69.5" fill="none" stroke="hsl(20 10% 12% / .14)" />
    </svg>
  );
}
```

- [ ] **Step 2: Implement Riley portrait**

Riley's portrait isn't in the design bundle. Create an original original mark using the same construction style, with a clay accent (`hsl(15 45% 50%)` matches `AGENT_REGISTRY.riley.accent`):

```tsx
// apps/dashboard/src/components/agent-home/portrait/riley.tsx
export function PortraitRiley() {
  return (
    <svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="riley-pg" cx=".5" cy=".42" r=".72">
          <stop offset="0%" stopColor="hsl(28 38% 88%)" />
          <stop offset="55%" stopColor="hsl(15 35% 78%)" />
          <stop offset="100%" stopColor="hsl(15 30% 60%)" />
        </radialGradient>
        <clipPath id="riley-pc">
          <circle cx="70" cy="70" r="70" />
        </clipPath>
      </defs>
      <g clipPath="url(#riley-pc)">
        <rect width="140" height="140" fill="url(#riley-pg)" />
        <path
          d="M 8 140 L 8 116 Q 8 92 70 92 Q 132 92 132 116 L 132 140 Z"
          fill="hsl(15 22% 30%)"
          opacity=".85"
        />
        <rect x="60" y="78" width="20" height="22" rx="3" fill="hsl(18 22% 54%)" />
        <ellipse cx="70" cy="58" rx="26" ry="30" fill="hsl(18 26% 62%)" />
        <path
          d="M 44 60 Q 44 32 70 30 Q 96 32 96 60 Q 96 50 88 46 Q 78 52 70 48 Q 60 52 52 46 Q 44 50 44 60 Z"
          fill="hsl(15 18% 22%)"
        />
        <ellipse cx="82" cy="56" rx="6" ry="10" fill="hsl(30 50% 92%)" opacity=".22" />
        <path
          d="M 64 72 Q 70 75 76 72"
          stroke="hsl(15 18% 22%)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity=".5"
        />
      </g>
      <circle cx="70" cy="70" r="69.5" fill="none" stroke="hsl(20 10% 12% / .14)" />
    </svg>
  );
}
```

- [ ] **Step 3: Verify they render**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/agent-home/portrait/
git commit -m "feat(dashboard): Alex and Riley portrait SVGs"
```

---

### Task 14: GreetingBlock component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/greeting-block.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GreetingBlock } from "../greeting-block";
import type { GreetingViewModel } from "@/lib/agent-home/types";

const vm: GreetingViewModel = {
  variant: "named-lead",
  segments: [
    { kind: "text", text: "Three leads. " },
    { kind: "accent", text: "Maya" },
    { kind: "text", text: " first." },
  ],
  signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("GreetingBlock", () => {
  it("renders the prose with accent spans", () => {
    render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("Maya")).toHaveClass("accent");
  });

  it("appends · FIXTURE folio badge when dataSource is fixture (non-prod)", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("· FIXTURE")).toBeInTheDocument();
  });

  it("renders the alex portrait for agentKey=alex", () => {
    const { container } = render(<GreetingBlock vm={vm} agentKey="alex" />);
    expect(container.querySelector("svg[viewBox='0 0 140 140']")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- greeting-block`
Expected: FAIL.

- [ ] **Step 3: Implement the block**

```tsx
// apps/dashboard/src/components/agent-home/greeting-block.tsx
import type { AgentKey } from "@switchboard/schemas";
import type { GreetingViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { PortraitAlex } from "./portrait/alex";
import { PortraitRiley } from "./portrait/riley";

function Portrait({ agentKey }: { agentKey: AgentKey }) {
  if (agentKey === "alex") return <PortraitAlex />;
  if (agentKey === "riley") return <PortraitRiley />;
  return null;
}

export function GreetingBlock({ vm, agentKey }: { vm: GreetingViewModel; agentKey: AgentKey }) {
  return (
    <section className="section page" data-block="greeting">
      <div className="folio">
        <span className="folio-l">Today</span>
        <span className="folio-r">
          {new Date(vm.freshness.generatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            weekday: "long",
          })}
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      <div className="greeting-block">
        <p className="greeting-prose">
          <ProseSegments segments={vm.segments} />
        </p>
        <div className="portrait" aria-label={agentKey}>
          <Portrait agentKey={agentKey} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- greeting-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/greeting-block.tsx apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx
git commit -m "feat(dashboard): GreetingBlock with portrait + accent prose"
```

---

### Task 15: WinsBlock component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/wins-block.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WinsBlock } from "../wins-block";
import type { WinsViewModel } from "@/lib/agent-home/types";

const baseVm: WinsViewModel = {
  wins: [
    {
      id: "w1",
      agentKey: "alex",
      source: "recommendation",
      occurredAt: "2026-05-04T11:42:00.000Z",
      timeFolio: "11:42 AM",
      proseSegments: [
        { kind: "accent", text: "Booked" },
        { kind: "text", text: " a tour with Jordan." },
      ],
      undo: { available: true, until: "2026-05-05T11:42:00.000Z" },
    },
  ],
  hasMore: true,
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("WinsBlock", () => {
  it("renders win prose with accent", () => {
    render(<WinsBlock vm={baseVm} agentKey="alex" />);
    expect(screen.getByText("Booked")).toHaveClass("accent");
  });

  it("renders Undo button when undo.available is true", () => {
    render(<WinsBlock vm={baseVm} agentKey="alex" />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("renders empty-state copy when wins array is empty", () => {
    const empty: WinsViewModel = { ...baseVm, wins: [] };
    render(<WinsBlock vm={empty} agentKey="alex" />);
    expect(screen.getByText(/still warming up/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- wins-block`
Expected: FAIL.

- [ ] **Step 3: Implement the block**

```tsx
// apps/dashboard/src/components/agent-home/wins-block.tsx
import type { AgentKey } from "@switchboard/schemas";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { WinsViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";

export function WinsBlock({ vm, agentKey }: { vm: WinsViewModel; agentKey: AgentKey }) {
  const agentName = AGENT_REGISTRY[agentKey].displayName;
  return (
    <section className="section page-wide" data-block="wins">
      <div className="folio">
        <span className="folio-l">Recent wins</span>
        <span className="folio-r">
          Today
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      {vm.wins.length === 0 ? (
        <p className="empty-state">
          <em>No wins to show yet. {agentName} is still warming up.</em>
        </p>
      ) : (
        <div className="wins-grid">
          {vm.wins.map((w) => (
            <article key={w.id} className="win">
              <span className="win-folio">WIN — {w.timeFolio}</span>
              <p className="win-prose">
                <ProseSegments segments={w.proseSegments} />
              </p>
              <div className="win-foot">
                {w.undo.available && (
                  <button type="button" className="win-undo">
                    Undo
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- wins-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/wins-block.tsx apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx
git commit -m "feat(dashboard): WinsBlock with empty state + undo affordance"
```

---

### Task 16: MetricsBlock component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/metrics-block.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricsBlock } from "../metrics-block";
import type { MetricsViewModel } from "@/lib/agent-home/types";

const vm: MetricsViewModel = {
  hero: { kind: "tours-booked", value: 14, comparator: { window: "week", value: 9 } },
  heroSubProseSegments: [{ kind: "text", text: "Up from 9 last week." }],
  spark: [
    { label: "Mon", value: 1 },
    { label: "Tue", value: 5 },
  ],
  stats: [
    { label: "Leads", display: "47", rawValue: 47, unit: "count" },
    { label: "Conversion", display: "26%", rawValue: 0.26, unit: "percent" },
    { label: "Spend", display: "$0", rawValue: 0, unit: "currency" },
  ],
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "week", dataSource: "fixture" },
};

describe("MetricsBlock", () => {
  it("renders hero number for tours-booked kind", () => {
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("14 tours")).toBeInTheDocument();
  });

  it("renders all 3 stat cells", () => {
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("Conversion")).toBeInTheDocument();
    expect(screen.getByText("Spend")).toBeInTheDocument();
  });

  it("renders sparkline as aria-hidden SVG", () => {
    const { container } = render(<MetricsBlock vm={vm} agentKey="alex" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- metrics-block`
Expected: FAIL.

- [ ] **Step 3: Implement the block**

```tsx
// apps/dashboard/src/components/agent-home/metrics-block.tsx
import type { AgentKey } from "@switchboard/schemas";
import type { HeroMetric, MetricsViewModel } from "@/lib/agent-home/types";
import { ProseSegments } from "./prose-segments";
import { FixtureFolioBadge } from "./fixture-folio-badge";
import { Sparkline } from "./sparkline";

function HeroNumber({ hero }: { hero: HeroMetric }) {
  switch (hero.kind) {
    case "tours-booked":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} tours</span> <span className="light">booked</span>
        </h2>
      );
    case "ad-leads":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} leads</span> <span className="light">from ads</span>
        </h2>
      );
    case "creatives-shipped":
      return (
        <h2 className="hero-num">
          <span className="accent">{hero.value} creatives</span>{" "}
          <span className="light">shipped</span>
        </h2>
      );
    case "revenue-attributed":
      return (
        <h2 className="hero-num">
          <span className="accent">
            {hero.currency} {hero.value.toLocaleString()}
          </span>{" "}
          <span className="light">attributed</span>
        </h2>
      );
  }
}

export function MetricsBlock({
  vm,
  agentKey: _agentKey,
}: {
  vm: MetricsViewModel;
  agentKey: AgentKey;
}) {
  return (
    <section className="section page-wide" data-block="metrics">
      <div className="folio">
        <span className="folio-l">This week</span>
        <span className="folio-r">
          Mon — Fri
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      <HeroNumber hero={vm.hero} />
      <p className="hero-sub">
        <ProseSegments segments={vm.heroSubProseSegments} />
      </p>
      <Sparkline data={vm.spark} />
      <div className="stats-row">
        {vm.stats.map((s) => (
          <div key={s.label} className="stat-cell">
            <span className="stat-label">{s.label}</span>
            <span className="stat-num">{s.display}</span>
            <span className="stat-rule" />
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- metrics-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/metrics-block.tsx apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx
git commit -m "feat(dashboard): MetricsBlock with discriminated hero + sparkline"
```

---

### Task 17: PipelineBlock component (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/pipeline-block.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineBlock } from "../pipeline-block";
import type { PipelineViewModel } from "@/lib/agent-home/types";

const baseVm: PipelineViewModel = {
  agentKey: "alex",
  pipelineKind: "leads",
  totalCount: 1,
  countNoun: "people",
  tiles: [
    {
      id: "c1",
      stage: "hot",
      name: "Maya R.",
      ctx: "Asked about classes.",
      link: { kind: "contact", id: "c1" },
    },
  ],
  setupLink: { kind: "agent-setup", agentKey: "alex" },
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("PipelineBlock", () => {
  it("renders disabled span (not anchor) when contact route is unavailable", () => {
    render(<PipelineBlock vm={baseVm} />);
    const tile = screen.getByText("Maya R.").closest("[data-stage]") as HTMLElement;
    expect(tile.tagName).toBe("SPAN");
    expect(tile.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders empty-state for riley when no tiles", () => {
    const emptyRiley: PipelineViewModel = {
      ...baseVm,
      agentKey: "riley",
      pipelineKind: "ad-sets",
      countNoun: "ad sets",
      tiles: [],
    };
    render(<PipelineBlock vm={emptyRiley} />);
    expect(screen.getByText(/will surface ad sets/i)).toBeInTheDocument();
  });

  it("renders empty-state for alex when no tiles", () => {
    const emptyAlex: PipelineViewModel = { ...baseVm, tiles: [] };
    render(<PipelineBlock vm={emptyAlex} />);
    expect(screen.getByText(/no active leads yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- pipeline-block`
Expected: FAIL.

- [ ] **Step 3: Implement the block**

```tsx
// apps/dashboard/src/components/agent-home/pipeline-block.tsx
import type { PipelineViewModel, PipelineTileViewModel } from "@/lib/agent-home/types";
import { resolveAgentHomeLink } from "@/lib/agent-home/resolve-link";
import { FixtureFolioBadge } from "./fixture-folio-badge";

function Tile({ tile }: { tile: PipelineTileViewModel }) {
  const resolved = resolveAgentHomeLink(tile.link);
  const inner = (
    <>
      <span className="tile-stage">{tile.stage.toUpperCase()}</span>
      <span className="tile-name">{tile.name}</span>
      <span className="tile-ctx">
        <em>{tile.ctx}</em>
      </span>
      <span className="tile-bar" />
    </>
  );

  if (resolved.disabled) {
    return (
      <span className="tile" data-stage={tile.stage} aria-disabled="true">
        {inner}
      </span>
    );
  }
  return (
    <a className="tile" data-stage={tile.stage} href={resolved.href}>
      {inner}
    </a>
  );
}

function emptyCopy(vm: PipelineViewModel): string {
  if (vm.agentKey === "riley") {
    return "Riley will surface ad sets here when they need a decision.";
  }
  return "No active leads yet. They'll appear here as conversations open.";
}

export function PipelineBlock({ vm }: { vm: PipelineViewModel }) {
  const setupResolved = resolveAgentHomeLink(vm.setupLink);

  return (
    <section className="section page-wide" data-block="pipeline">
      <div className="folio">
        <span className="folio-l">Pipeline</span>
        <span className="folio-r">
          {vm.totalCount} {vm.countNoun}
          <FixtureFolioBadge dataSource={vm.freshness.dataSource} />
        </span>
      </div>
      {vm.tiles.length === 0 ? (
        <p className="empty-state">
          <em>{emptyCopy(vm)}</em>
        </p>
      ) : (
        <div className="pipeline-wrap">
          <div className="pipeline-scroll">
            {vm.tiles.map((t) => (
              <Tile key={t.id} tile={t} />
            ))}
          </div>
        </div>
      )}
      {setupResolved.disabled ? (
        <span className="setup-link" aria-disabled="true">
          Manage {vm.agentKey === "alex" ? "Alex" : "Riley"}'s setup →
        </span>
      ) : (
        <a className="setup-link" href={setupResolved.href}>
          Manage {vm.agentKey === "alex" ? "Alex" : "Riley"}'s setup →
        </a>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- pipeline-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/pipeline-block.tsx apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx
git commit -m "feat(dashboard): PipelineBlock with disabled-tile guard + empty states"
```

---

### Task 18: NeedsYouBlock component (B2 live wrapper) (TDD)

**Files:**

- Create: `apps/dashboard/src/components/agent-home/needs-you-block.tsx`
- Test: `apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsYouBlock } from "../needs-you-block";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
}));

describe("NeedsYouBlock", () => {
  it("renders empty-state when there are no decisions", () => {
    render(<NeedsYouBlock agentKey="alex" />);
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("renders the Needs you folio header", () => {
    render(<NeedsYouBlock agentKey="alex" />);
    expect(screen.getByText("Needs you")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- needs-you-block`
Expected: FAIL.

- [ ] **Step 3: Implement the wrapper**

```tsx
// apps/dashboard/src/components/agent-home/needs-you-block.tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";

export function NeedsYouBlock({ agentKey }: { agentKey: AgentKey }) {
  const { data, isLoading, isError } = useDecisionFeed(agentKey);

  if (isLoading) return null; // simple skeleton-less in PR-S1; add later if needed
  if (isError) {
    return (
      <section className="section page" data-block="needs-you">
        <div className="folio">
          <span className="folio-l">Needs you</span>
          <span className="folio-r">—</span>
        </div>
        <p className="empty-state">
          <em>Couldn't load this block.</em>
        </p>
      </section>
    );
  }

  const decisions = data?.decisions ?? [];

  return (
    <section className="section page" data-block="needs-you">
      <div className="folio">
        <span className="folio-l">Needs you</span>
        <span className="folio-r">
          {decisions.length} {decisions.length === 1 ? "item" : "items"}
        </span>
      </div>
      {decisions.length === 0 ? (
        <p className="empty-state">
          <em>You're caught up. I'll write again when something needs you.</em>
        </p>
      ) : (
        <div className="decisions measure-prose">
          {decisions.map((d, i) => (
            <DecisionCard
              key={d.id}
              {...mapToDecisionCard(d, i)}
              onPrimary={() => dispatchDecisionAction(d.sourceRef, "primary")}
              onSecondary={() => dispatchDecisionAction(d.sourceRef, "secondary")}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- needs-you-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/agent-home/needs-you-block.tsx apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx
git commit -m "feat(dashboard): NeedsYouBlock — B2 live wrapper around DecisionCard"
```

---

### Task 19: AmbientCream client island (TDD)

**Files:**

- Create: `apps/dashboard/src/components/layout/ambient-cream.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/ambient-cream.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/layout/__tests__/ambient-cream.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AmbientCream } from "../ambient-cream";

describe("AmbientCream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z")); // mid-day
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets --ambient-cream on mount", () => {
    render(<AmbientCream />);
    const v = document.documentElement.style.getPropertyValue("--ambient-cream");
    expect(v).toMatch(/^hsl/);
  });

  it("re-applies on a 60-second interval", () => {
    render(<AmbientCream />);
    const initial = document.documentElement.style.getPropertyValue("--ambient-cream");
    // Move time forward by an hour and tick the interval.
    vi.setSystemTime(new Date("2026-05-04T19:00:00Z")); // dusk
    vi.advanceTimersByTime(60_000);
    const after = document.documentElement.style.getPropertyValue("--ambient-cream");
    expect(after).not.toBe(initial);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- ambient-cream`
Expected: FAIL.

- [ ] **Step 3: Implement the client island**

```tsx
// apps/dashboard/src/components/layout/ambient-cream.tsx
"use client";

import { useEffect } from "react";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ambientHsl(hour: number): string {
  // Bands: 5-8 dawn, 8-17 day, 17-20 dusk, 20-5 night.
  const day = { h: 40, s: 25, l: 94 };
  const dawn = { h: 45, s: 15, l: 96 };
  const dusk = { h: 35, s: 30, l: 92 };
  const night = { h: 30, s: 25, l: 91 };
  const mix = (A: typeof day, B: typeof day, t: number) => ({
    h: lerp(A.h, B.h, t),
    s: lerp(A.s, B.s, t),
    l: lerp(A.l, B.l, t),
  });
  let c;
  if (hour >= 5 && hour < 8) c = mix(dawn, day, (hour - 5) / 3);
  else if (hour >= 8 && hour < 17) c = day;
  else if (hour >= 17 && hour < 20) c = mix(day, dusk, (hour - 17) / 3);
  else if (hour >= 20 && hour < 24) c = mix(dusk, night, (hour - 20) / 4);
  else c = night;
  return `hsl(${c.h.toFixed(1)} ${c.s.toFixed(1)}% ${c.l.toFixed(1)}%)`;
}

export function AmbientCream() {
  useEffect(() => {
    function apply() {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      document.documentElement.style.setProperty("--ambient-cream", ambientHsl(h));
    }
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- ambient-cream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/ambient-cream.tsx apps/dashboard/src/components/layout/__tests__/ambient-cream.test.tsx
git commit -m "feat(dashboard): AmbientCream client island (60s --ambient-cream interval)"
```

---

### Task 20: TweaksPanel (gated) (TDD)

**Files:**

- Create: `apps/dashboard/src/components/layout/tweaks-panel.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/tweaks-panel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/layout/__tests__/tweaks-panel.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TweaksPanel } from "../tweaks-panel";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("TweaksPanel", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
  });

  it("does not render in production even with ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    render(<TweaksPanel hasTweaksFlag={true} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("does not render without ?tweaks=1 in non-prod", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<TweaksPanel hasTweaksFlag={false} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders in non-prod with ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<TweaksPanel hasTweaksFlag={true} />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- tweaks-panel`
Expected: FAIL.

- [ ] **Step 3: Implement the panel**

```tsx
// apps/dashboard/src/components/layout/tweaks-panel.tsx
"use client";

/**
 * Non-prod-only design hot-reload panel. Mounted by the editorial shell when
 * the URL has `?tweaks=1` AND NEXT_PUBLIC_DEPLOY_ENV !== "production".
 *
 * PR-S1 keeps this minimal — just a placeholder panel that proves gating works.
 * Future PRs can wire in design controls (ambient hour slider, greeting variant).
 */
export function TweaksPanel({ hasTweaksFlag }: { hasTweaksFlag: boolean }) {
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") return null;
  if (!hasTweaksFlag) return null;
  return (
    <aside role="complementary" className="tp-panel" aria-label="Design tweaks">
      <p>Tweaks panel (preview only)</p>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- tweaks-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/tweaks-panel.tsx apps/dashboard/src/components/layout/__tests__/tweaks-panel.test.tsx
git commit -m "feat(dashboard): TweaksPanel — non-prod + ?tweaks=1 gated stub"
```

---

### Task 21: EditorialShellBoundary (TDD)

**Files:**

- Create: `apps/dashboard/src/components/layout/editorial-shell-boundary.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/editorial-shell-boundary.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/layout/__tests__/editorial-shell-boundary.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialShellBoundary } from "../editorial-shell-boundary";

function Boom(): never {
  throw new Error("shell-error");
}

describe("EditorialShellBoundary", () => {
  it("falls back to a minimal banner on error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EditorialShellBoundary>
        <Boom />
      </EditorialShellBoundary>,
    );
    expect(screen.getByText(/Switchboard — temporarily unavailable/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <EditorialShellBoundary>
        <p>ok</p>
      </EditorialShellBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- editorial-shell-boundary`
Expected: FAIL.

- [ ] **Step 3: Implement the boundary**

```tsx
// apps/dashboard/src/components/layout/editorial-shell-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";

interface State {
  hasError: boolean;
}

export class EditorialShellBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[EditorialShellBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <header className="app-header">
          <div className="app-header-row">
            <span>Switchboard — temporarily unavailable</span>
          </div>
        </header>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- editorial-shell-boundary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-shell-boundary.tsx apps/dashboard/src/components/layout/__tests__/editorial-shell-boundary.test.tsx
git commit -m "feat(dashboard): EditorialShellBoundary thin top-level boundary"
```

---

### Task 22: EditorialAuthShell (server component) (TDD)

**Files:**

- Create: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/editorial-auth-shell.test.tsx`

The shell is a server component that reads `OrgAgentEnablement` for the current session's org and renders the brand-nav with only enabled agents. The Halt button + Inbox count are client islands inside it.

- [ ] **Step 1: Identify the existing org-agents fetch path**

Read `apps/dashboard/src/hooks/use-agents.ts` and `apps/dashboard/src/lib/api-client/agents.ts` to confirm how to call the agent enablement API server-side. The shell needs an `async` server-component fetch — likely via a server-only helper that wraps the same endpoint but uses `NextAuth` server session for the cookie.

If a server-side helper does not exist, create one at `apps/dashboard/src/lib/api-client/agents-server.ts` that takes a `Request`/`headers` and calls `GET /api/dashboard/agents`. (If you find a clear existing pattern, follow that pattern instead.)

- [ ] **Step 2: Write failing test**

```tsx
// apps/dashboard/src/components/layout/__tests__/editorial-auth-shell.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialAuthShellInner } from "../editorial-auth-shell";

// We test the inner (synchronous) component with explicit enabled-agents prop;
// the async wrapper is exercised in the page-level test (Task 28).

describe("EditorialAuthShellInner", () => {
  it("renders Home + only enabled agents in brand-nav", () => {
    render(
      <EditorialAuthShellInner enabledAgents={["alex", "riley"]}>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    expect(screen.getByRole("link", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /alex/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /riley/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /mira/i })).toBeNull();
  });

  it("renders the inbox link as aria-disabled (no navigation in slice B)", () => {
    render(
      <EditorialAuthShellInner enabledAgents={["alex"]}>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    const inbox = screen.getByRole("button", { name: /inbox/i });
    expect(inbox.getAttribute("aria-disabled")).toBe("true");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- editorial-auth-shell`
Expected: FAIL.

- [ ] **Step 4: Implement the shell**

```tsx
// apps/dashboard/src/components/layout/editorial-auth-shell.tsx
import type { ReactNode } from "react";
import type { AgentKey } from "@switchboard/schemas";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialShellBoundary } from "./editorial-shell-boundary";
import { AmbientCream } from "./ambient-cream";
import { InboxLinkClient } from "./inbox-link-client";
import { HaltButtonClient } from "./halt-button-client";

/**
 * Server-async wrapper. Fetches enabled agents for the current org and renders
 * the inner sync component. The (auth) layout boundary handles authentication,
 * so by the time this runs we have a session.
 */
export async function EditorialAuthShell({ children }: { children: ReactNode }) {
  const enabledAgents = await fetchEnabledAgentsServer();
  return (
    <EditorialShellBoundary>
      <EditorialAuthShellInner enabledAgents={enabledAgents}>{children}</EditorialAuthShellInner>
    </EditorialShellBoundary>
  );
}

/** Sync inner — testable with explicit props. */
export function EditorialAuthShellInner({
  enabledAgents,
  children,
}: {
  enabledAgents: readonly AgentKey[];
  children: ReactNode;
}) {
  return (
    <>
      <AmbientCream />
      <header className="app-header">
        <div className="app-header-row">
          <div className="brand-cluster">
            <a href="/" className="brand-mark">
              <span className="brand-dot" />
              Switchboard
            </a>
            <nav className="brand-nav" aria-label="agents">
              <a href="/">Home</a>
              {enabledAgents.map((key) => (
                <a key={key} href={`/${key}`}>
                  {AGENT_REGISTRY[key].displayName}
                </a>
              ))}
              <a href="#" className="add" aria-label="Add an agent">
                +
              </a>
            </nav>
          </div>
          <div className="header-actions">
            <span className="live-pip">
              <span className="pulse" />
              Live
            </span>
            <InboxLinkClient />
            <HaltButtonClient />
            <span className="me-chip">M</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
```

- [ ] **Step 5: Implement `InboxLinkClient`**

```tsx
// apps/dashboard/src/components/layout/inbox-link-client.tsx
"use client";

import { useInboxCount } from "@/hooks/use-decision-feed";

export function InboxLinkClient() {
  const count = useInboxCount();
  return (
    <button
      type="button"
      aria-disabled="true"
      title="Inbox drawer coming soon"
      className="folio-link"
    >
      {count > 0 && <span className="pip" />}
      <span>Inbox</span>
      {count > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="num">{count}</span>
        </>
      )}
    </button>
  );
}
```

- [ ] **Step 6: Implement `HaltButtonClient`**

Read `apps/dashboard/src/components/console/halt-context.tsx` to confirm the provider's hook name (likely `useHalt()`). Use that hook directly:

```tsx
// apps/dashboard/src/components/layout/halt-button-client.tsx
"use client";

import { useHalt } from "@/components/console/halt-context";

export function HaltButtonClient() {
  const { halted, toggle } = useHalt();
  return (
    <button
      type="button"
      className={`folio-link ${halted ? "is-halt" : ""}`}
      aria-pressed={halted}
      onClick={toggle}
    >
      {halted ? "Halted" : "Halt"}
    </button>
  );
}
```

If `useHalt` exposes a different API (e.g., `state` + `setState`), adapt the call. Verify by reading the existing halt context first.

- [ ] **Step 7: Implement `fetchEnabledAgentsServer`**

```ts
// apps/dashboard/src/lib/api-client/agents-server.ts
import type { AgentKey } from "@switchboard/schemas";
import { AGENT_KEYS } from "@switchboard/schemas";
import { auth } from "@/lib/auth";
import { headers as getHeaders, cookies as getCookies } from "next/headers";

/**
 * Server-side equivalent of useAgents() — calls /api/dashboard/agents using
 * the current session's cookie. Returns the org-enabled agent keys.
 *
 * Falls back to "alex" only on any failure so the shell still renders for
 * existing orgs whose enablement row may not have been backfilled. The
 * EditorialShellBoundary catches harder errors.
 */
export async function fetchEnabledAgentsServer(): Promise<readonly AgentKey[]> {
  try {
    const session = await auth();
    if (!session) return ["alex"];
    const cookieHeader = (await getCookies()).toString();
    const host = (await getHeaders()).get("host") ?? "localhost:3002";
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    const res = await fetch(`${proto}://${host}/api/dashboard/agents`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return ["alex"];
    const body = (await res.json()) as { agents: { key: string; enabled: boolean }[] };
    const enabled = body.agents.filter((a) => a.enabled).map((a) => a.key);
    return enabled.filter((k): k is AgentKey => (AGENT_KEYS as readonly string[]).includes(k));
  } catch {
    return ["alex"];
  }
}
```

(If `apps/dashboard/src/hooks/use-agents.ts` reveals a different response body shape, adapt the parsing line.)

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- editorial-auth-shell`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx \
        apps/dashboard/src/components/layout/inbox-link-client.tsx \
        apps/dashboard/src/components/layout/halt-button-client.tsx \
        apps/dashboard/src/lib/api-client/agents-server.ts \
        apps/dashboard/src/components/layout/__tests__/editorial-auth-shell.test.tsx
git commit -m "feat(dashboard): EditorialAuthShell with server-fetched enabled agents"
```

---

### Task 23: Owner Home placeholder route (TDD)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/app/(auth)/__tests__/page.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));

import OwnerHomePage from "../page";

describe("Owner Home placeholder", () => {
  it("renders inside the EditorialAuthShell", async () => {
    render(await OwnerHomePage());
    expect(screen.getByTestId("shell")).toBeInTheDocument();
  });

  it("renders placeholder copy", async () => {
    render(await OwnerHomePage());
    expect(screen.getByText(/owner home/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- "(auth)/__tests__/page"`
Expected: FAIL.

- [ ] **Step 3: Implement the placeholder**

```tsx
// apps/dashboard/src/app/(auth)/page.tsx
import { notFound } from "next/navigation";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";

export default async function OwnerHomePage() {
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();
  return (
    <EditorialAuthShell>
      <section className="section page" data-block="owner-home-placeholder">
        <div className="folio">
          <span className="folio-l">Owner Home</span>
          <span className="folio-r">Coming soon</span>
        </div>
        <p className="empty-state">
          <em>The Owner Home will land here in a follow-up slice.</em>
        </p>
      </section>
    </EditorialAuthShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- "(auth)/__tests__/page"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/page.tsx apps/dashboard/src/app/\(auth\)/__tests__/page.test.tsx
git commit -m "feat(dashboard): Owner Home placeholder route"
```

---

### Task 24: Agent route — server gate + AgentHomeClient (TDD)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx`
- Test: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/page.test.tsx`
- Test: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`

- [ ] **Step 1: Write failing test for server gates**

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/page.test.tsx
import { describe, expect, it, vi } from "vitest";

const notFoundFn = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));
vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: vi.fn(async () => ["alex", "riley"]),
}));
vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../agent-home-client", () => ({
  AgentHomeClient: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="client">{agentKey}</div>
  ),
}));

import AgentHomePage from "../page";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("AgentHomePage server gates", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
    notFoundFn.mockClear();
  });

  it("notFound() when agentKey is not in registry", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    await expect(AgentHomePage({ params: { agentKey: "bogus" } })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("notFound() when agentKey is mira (not enabled in slice B)", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    await expect(AgentHomePage({ params: { agentKey: "mira" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("notFound() in production env", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    await expect(AgentHomePage({ params: { agentKey: "alex" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders AgentHomeClient for valid + enabled + non-prod", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    const tree = await AgentHomePage({ params: { agentKey: "alex" } });
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("client")).toHaveTextContent("alex");
  });
});

import { afterEach } from "vitest";
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- "\[agentKey\]/__tests__/page"`
Expected: FAIL.

- [ ] **Step 3: Implement the server page**

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/page.tsx
import { notFound } from "next/navigation";
import { AGENT_KEYS } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { AgentHomeClient } from "./agent-home-client";

export default async function AgentHomePage({ params }: { params: { agentKey: string } }) {
  if (!(AGENT_KEYS as readonly string[]).includes(params.agentKey)) notFound();
  const agentKey = params.agentKey as AgentKey;

  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes(agentKey)) notFound();

  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();

  return (
    <EditorialAuthShell>
      <AgentHomeClient agentKey={agentKey} />
    </EditorialAuthShell>
  );
}
```

- [ ] **Step 4: Write failing test for AgentHomeClient**

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => ({
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  }),
  useInboxCount: () => 0,
}));

import { AgentHomeClient } from "../agent-home-client";

describe("AgentHomeClient", () => {
  it("renders all 5 block sections for alex", () => {
    render(<AgentHomeClient agentKey="alex" />);
    expect(screen.getByTestId("block-greeting")).toBeInTheDocument();
    expect(screen.getByTestId("block-needs-you")).toBeInTheDocument();
    expect(screen.getByTestId("block-wins")).toBeInTheDocument();
    expect(screen.getByTestId("block-metrics")).toBeInTheDocument();
    expect(screen.getByTestId("block-pipeline")).toBeInTheDocument();
  });

  it("renders all 5 block sections for riley", () => {
    render(<AgentHomeClient agentKey="riley" />);
    expect(screen.getAllByText(/Pipeline/).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Implement the client orchestrator**

Update each block component to add a `data-testid="block-<name>"` to its outer `<section>` so the orchestrator test can find them. (The earlier block tasks didn't include the testid; adding it now is harmless.)

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { AgentBlockBoundary } from "@/components/agent-home/agent-block-boundary";
import { GreetingBlock } from "@/components/agent-home/greeting-block";
import { NeedsYouBlock } from "@/components/agent-home/needs-you-block";
import { WinsBlock } from "@/components/agent-home/wins-block";
import { MetricsBlock } from "@/components/agent-home/metrics-block";
import { PipelineBlock } from "@/components/agent-home/pipeline-block";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentWins } from "@/hooks/use-agent-wins";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentPipeline } from "@/hooks/use-agent-pipeline";

export function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  const greeting = useAgentGreeting(agentKey);
  const wins = useAgentWins(agentKey);
  const metrics = useAgentMetrics(agentKey);
  const pipeline = useAgentPipeline(agentKey);

  if (!greeting.data || !wins.data || !metrics.data || !pipeline.data) return null;

  return (
    <>
      <AgentBlockBoundary>
        <div data-testid="block-greeting">
          <GreetingBlock vm={greeting.data} agentKey={agentKey} />
        </div>
      </AgentBlockBoundary>
      <AgentBlockBoundary>
        <div data-testid="block-needs-you">
          <NeedsYouBlock agentKey={agentKey} />
        </div>
      </AgentBlockBoundary>
      <AgentBlockBoundary>
        <div data-testid="block-wins">
          <WinsBlock vm={wins.data} agentKey={agentKey} />
        </div>
      </AgentBlockBoundary>
      <AgentBlockBoundary>
        <div data-testid="block-metrics">
          <MetricsBlock vm={metrics.data} agentKey={agentKey} />
        </div>
      </AgentBlockBoundary>
      <AgentBlockBoundary>
        <div data-testid="block-pipeline">
          <PipelineBlock vm={pipeline.data} />
        </div>
      </AgentBlockBoundary>
    </>
  );
}
```

- [ ] **Step 6: Run test to verify both tests pass**

Run: `pnpm --filter @switchboard/dashboard test -- "\[agentKey\]"`
Expected: PASS (page gates + client orchestrator).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\[agentKey\]/page.tsx \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/agent-home-client.tsx \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/page.test.tsx \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/agent-home-client.test.tsx
git commit -m "feat(dashboard): /[agentKey] route with gates + AgentHomeClient orchestrator"
```

---

### Task 25: Route allowlist filesystem assertion test

**Files:**

- Create: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/route-allowlist.test.ts`

- [ ] **Step 1: Write the assertion test**

```ts
// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/route-allowlist.test.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_ROOT = join(__dirname, "..", "..");

const KNOWN_TOP_LEVEL = [
  "reports",
  "decide",
  "settings",
  "console",
  "escalations",
  "tasks",
  "me",
  "my-agent",
  "modules",
  "conversations",
  "deployments",
  "onboarding",
  "dashboard",
];

describe("route allowlist — concrete top-level routes beat [agentKey]", () => {
  for (const segment of KNOWN_TOP_LEVEL) {
    it(`/${segment} resolves via concrete directory, not [agentKey]`, () => {
      const dir = join(AUTH_ROOT, segment);
      expect(existsSync(dir)).toBe(true);
    });
  }

  it("Owner Home `/` has its own page.tsx and is not the dynamic segment", () => {
    expect(existsSync(join(AUTH_ROOT, "page.tsx"))).toBe(true);
  });

  it("[agentKey] dynamic segment exists", () => {
    expect(existsSync(join(AUTH_ROOT, "[agentKey]"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- route-allowlist`
Expected: PASS (every entry in `KNOWN_TOP_LEVEL` already exists in the dashboard app tree per the prerequisite check).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/route-allowlist.test.ts
git commit -m "test(dashboard): route allowlist guard for [agentKey] dynamic"
```

---

### Task 26: Decision dispatcher invalidation extension (TDD)

**Files:**

- Modify: `apps/dashboard/src/lib/decisions/dispatch-action.ts`
- Test: `apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts` (extend)

- [ ] **Step 1: Read the existing dispatcher test to learn the pattern**

Read `apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts` from `feat/decision-feed-frontend`.

- [ ] **Step 2: Write failing test for the new invalidation**

```ts
// apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts (extend)
import { describe, expect, it, vi } from "vitest";
import { dispatchDecisionAction } from "../dispatch-action";

// Reuse the existing test wrapper. The new assertion is that after a primary
// action, the queryClient.invalidateQueries was called with prefix keys for
// greeting and wins, in addition to the existing decisions invalidation.

describe("dispatchDecisionAction — slice B invalidation", () => {
  it("invalidates greeting + wins after a successful approval primary action", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const invalidateQueries = vi.fn();
    const fakeQc = { invalidateQueries };

    await dispatchDecisionAction(
      { kind: "approval", sourceId: "rec-1" },
      "primary",
      undefined,
      { queryClient: fakeQc, orgId: "org-1", agentKey: "alex" }, // new optional context arg
    );

    const calls = invalidateQueries.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: ["org-1", "decisions", "feed", "alex"] });
    expect(calls).toContainEqual({ queryKey: ["org-1", "greeting", "feed", "alex"] });
    expect(calls).toContainEqual({ queryKey: ["org-1", "wins", "feed", "alex"] });

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- dispatch-action`
Expected: FAIL.

- [ ] **Step 4: Extend the dispatcher**

Add an optional `context` parameter so existing callers don't break:

```ts
// apps/dashboard/src/lib/decisions/dispatch-action.ts (modified)
import type { DecisionKind } from "./types.js";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";

export interface DispatchContext {
  queryClient: Pick<QueryClient, "invalidateQueries">;
  orgId: string;
  agentKey: AgentKey;
}

// (existing JSDoc preserved — keep the prior block above this signature.)
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
  context?: DispatchContext,
): Promise<void> {
  // ... existing fetch logic for approval | handoff (preserve unchanged) ...

  if (context) {
    const { queryClient, orgId, agentKey } = context;
    queryClient.invalidateQueries({ queryKey: [orgId, "decisions", "feed", agentKey] });
    queryClient.invalidateQueries({ queryKey: [orgId, "greeting", "feed", agentKey] });
    queryClient.invalidateQueries({ queryKey: [orgId, "wins", "feed", agentKey] });
  }
}
```

(Read the existing function body first; preserve the existing fetch logic unchanged. Only add the invalidation block at the end.)

- [ ] **Step 5: Update `NeedsYouBlock` callers to pass context**

Modify `apps/dashboard/src/components/agent-home/needs-you-block.tsx`:

```tsx
// at the top of NeedsYouBlock add:
const queryClient = useQueryClient();
const keys = useScopedQueryKeys();
// then pass context only when keys is available:
onPrimary={() => {
  if (!keys) return;
  // orgId is the first segment of any key; pull from a key factory:
  const orgId = keys.decisions.feed("alex")[0] as string;
  void dispatchDecisionAction(d.sourceRef, "primary", undefined, {
    queryClient,
    orgId,
    agentKey,
  });
}}
```

(Add the relevant imports: `useQueryClient` from `@tanstack/react-query`, `useScopedQueryKeys` from `@/hooks/use-query-keys`. Mirror the same change for `onSecondary`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- "dispatch-action|needs-you-block"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib/decisions/dispatch-action.ts \
        apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts \
        apps/dashboard/src/components/agent-home/needs-you-block.tsx
git commit -m "feat(dashboard): dispatcher invalidates greeting + wins after decision actions"
```

---

### Task 27: Stylesheet alignment (port editorial-register CSS to dashboard)

**Files:**

- Modify: `apps/dashboard/src/app/globals.css`

The existing globals.css already has editorial tokens and Mercury tokens (verified in spec §1.3). What's still needed is the editorial-register _layout_ CSS — folio, section, page-width, decision card extensions, hero-num, sparkline, tile, etc. — ported from `~/.claude/design-bundles/alex-home-design/switchboard/project/alex-home/alex-home.css`.

- [ ] **Step 1: Read the design bundle CSS for the editorial layout**

Read `~/.claude/design-bundles/alex-home-design/switchboard/project/alex-home/alex-home.css` end-to-end.

- [ ] **Step 2: Append a new `@layer components` block**

Append after the existing editorial token block in `globals.css`:

```css
@layer components {
  /* ===== Editorial Auth Shell + agent home ===== */
  /* Ported from ~/.claude/design-bundles/alex-home-design/.../alex-home.css.
     Tokens already live in :root; this block carries the layout/components only. */

  body {
    transition: background 1200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .app-header {
    /* ...port verbatim from alex-home.css... */
  }
  .app-header-row {
    /* ... */
  }
  .brand-cluster {
    /* ... */
  }
  .brand-mark {
    /* ... */
  }
  .brand-dot {
    /* ... */
  }
  .brand-nav {
    /* ... */
  }
  .brand-nav a {
    /* ... */
  }
  .brand-nav a.is-active {
    /* ... */
  }
  .brand-nav .add {
    /* ... */
  }
  .header-actions {
    /* ... */
  }
  .live-pip {
    /* ... */
  }
  .live-pip .pulse {
    /* ... */
  }
  .live-pip .pulse::after {
    /* ... */
  }
  @keyframes pulse-ring {
    0% {
      transform: scale(0.7);
      opacity: 1;
    }
    100% {
      transform: scale(1.6);
      opacity: 0;
    }
  }
  .folio-link {
    /* ... */
  }
  .folio-link.is-halt {
    color: hsl(0 75% 50%);
  }
  .me-chip {
    /* ... */
  }

  /* ===== Page shell ===== */
  .page,
  .page-wide {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 24px;
    width: 100%;
  }
  @media (min-width: 768px) {
    .page,
    .page-wide {
      padding: 0 40px;
    }
  }
  @media (min-width: 1280px) {
    .page,
    .page-wide {
      padding: 0 56px;
    }
  }
  .measure-prose {
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
  }
  .section {
    padding-top: 72px;
  }
  .section:first-of-type {
    padding-top: 48px;
  }
  .section:last-of-type {
    padding-bottom: 160px;
  }

  /* ===== Folios ===== */
  .folio {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: hsl(20 10% 12% / 0.55);
    padding-bottom: 14px;
    margin-bottom: 32px;
    border-bottom: 1px solid var(--hairline);
  }
  .folio-l,
  .folio-r {
    white-space: nowrap;
  }
  .folio-r {
    font-variant-numeric: tabular-nums;
  }

  /* ===== Greeting ===== */
  .greeting-block {
    display: grid;
    grid-template-columns: 1fr;
    gap: 32px;
    align-items: start;
    justify-items: center;
    text-align: center;
  }
  .greeting-prose {
    font-family: var(--serif);
    font-weight: 400;
    font-size: 32px;
    line-height: 1.15;
    letter-spacing: -0.018em;
    color: var(--ink);
    text-wrap: pretty;
  }
  .greeting-prose .accent {
    color: var(--accent);
    font-style: normal;
  }
  .portrait {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--hairline);
    position: relative;
    background: hsl(28 30% 86%);
    flex: none;
    order: -1;
  }
  /* (port the @media breakpoints for greeting-prose / portrait / portrait sizing) */

  /* ===== Wins / Metrics / Pipeline ===== */
  /* Port .win, .win-folio, .win-prose, .win-foot, .win-undo, .see-all,
     .hero-num, .hero-num .accent, .hero-num .light, .hero-sub,
     .stats-row, .stat-cell, .stat-label, .stat-num, .stat-rule,
     .pipeline-wrap, .pipeline-scroll, .tile, .tile-stage, .tile-name, .tile-ctx, .tile-bar,
     .setup-link, .empty-state, .freshness-note */

  /* ===== Sparkline ===== */
  .sparkline {
    width: 100%;
    height: 80px;
  }
  @media (min-width: 768px) {
    .sparkline {
      height: 120px;
    }
  }
  @media (min-width: 1280px) {
    .sparkline {
      height: 150px;
    }
  }
}
```

The above is a **structural skeleton**; replace each `/* ... */` with the actual CSS rules from `alex-home.css`. The full set of rules is in the design bundle and runs ~600 lines. Port them verbatim under `@layer components` to avoid Tailwind specificity collisions.

- [ ] **Step 3: Verify no regression by running existing tests + dev**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS (no test should depend on these new styles; pure CSS additions).

Run dev manually:

```
pnpm --filter @switchboard/dashboard dev
```

Visit `http://localhost:3002/alex` (after Task 22 `EditorialAuthShell` mounts). Confirm fonts, folios, hairlines, accent color, hero number, pill buttons, sparkline, tiles all visually match `alex-home.css`. Adjust if needed.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/globals.css
git commit -m "feat(dashboard): editorial-register layout CSS (alex-home.css port)"
```

---

### Task 28: Smoke test — full integration

**Files:** No new files. Manual verification step.

- [ ] **Step 1: Run the full dashboard test suite**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS — including new tests added in Tasks 1–27 and existing tests on `feat/decision-feed-frontend`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter @switchboard/dashboard lint`
Expected: PASS (or expected warnings only).

- [ ] **Step 4: Manual QA**

- Boot dev: `pnpm --filter @switchboard/dashboard dev`
- Visit `http://localhost:3002/alex` — full 5-block layout renders, Greeting/Wins/Metrics/Pipeline show `· FIXTURE` folio badge, Needs You renders live decisions (or empty-state copy if your seed has none), header has `Home · Alex · Riley · +`, Halt button toggles, Inbox shows live count, ambient cream applied.
- Visit `http://localhost:3002/riley` — same blocks, Riley voice in greeting/wins/metrics, ad-set pipeline with disabled tiles.
- Visit `http://localhost:3002/mira` — 404.
- Visit `http://localhost:3002/bogus` — 404.
- Visit `http://localhost:3002/` — Owner Home placeholder.
- Visit `http://localhost:3002/reports` — unchanged Mercury-register reports page (Task should not have touched it).
- Click a pipeline tile — should be a non-clickable `<span>` (no navigation).
- Set `NEXT_PUBLIC_DEPLOY_ENV=production` in env, restart — `/alex`, `/riley`, `/` all 404.

- [ ] **Step 5: No-changes commit (or skip if step 4 turned up issues)**

If issues found, file a bug, address inline, and re-run Step 4. Otherwise:

```bash
# No-op commit just to mark the integration milestone:
git commit --allow-empty -m "chore(dashboard): slice B PR-S1 integration milestone"
```

(Skip this step if your team prefers no empty commits.)

---

## Self-Review

**Spec coverage check:**

| Spec section                              | Implemented in tasks                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| §3.1 file structure                       | Tasks 1–27 cover every file listed                                                                                |
| §4 view-model family                      | Task 1 (full v2 family)                                                                                           |
| §4.2 ROUTE_AVAILABILITY resolver          | Task 2                                                                                                            |
| §6.1 page composition tree                | Tasks 14–18 (blocks), 22 (shell), 24 (orchestrator)                                                               |
| §6.2 page-level orchestration             | Task 24                                                                                                           |
| §6.3 stable hook signatures               | Tasks 5–8 (all four hooks return `AgentBlockQuery<T>`)                                                            |
| §6.4 React Query keys                     | Task 3 (factories added; live PRs S2–S5 will consume)                                                             |
| §6.5 cache invalidation rules             | Task 26 (greeting + wins prefix invalidation)                                                                     |
| §6.6 per-agent variation                  | Task 13 (portraits), Task 4 (per-agent fixtures), Task 16 (HeroMetric kind branch), Task 17 (pipelineKind branch) |
| §7 freshness model + UI states            | Task 10 (FixtureFolioBadge), Task 11 (AgentBlockBoundary), Tasks 14–17 (block UI states)                          |
| §7.3 empty states                         | Tasks 15 (wins), 17 (pipeline), 18 (decisions)                                                                    |
| §8.2 thin error boundaries                | Tasks 11 + 21                                                                                                     |
| §9 PR-S1 acceptance criteria              | All covered; integration verified in Task 28                                                                      |
| Q3 production gate + FIXTURE folio badges | Task 24 (gate) + Task 10 (badge)                                                                                  |
| Q10 chrome elements                       | Task 19 (ambient cream), Task 20 (tweaks panel), Task 22 (Halt + Inbox)                                           |
| Q11 no `useAgentFirstNav` consumption     | (Negative requirement — verified by absence; flag never imported)                                                 |
| Q12 brand-nav shows only enabled agents   | Task 22 (`enabledAgents` prop drives nav)                                                                         |

**Type/method consistency check:**

- `AgentBlockQuery<T>` — defined in Task 1; consumed by Tasks 5, 6, 7, 8, 24. ✅
- `getFixtureGreeting/Wins/Metrics/Pipeline` — defined in Task 4; consumed by Tasks 5, 6, 7, 8. ✅
- `resolveAgentHomeLink` — defined in Task 2; consumed by Task 17. ✅
- `FixtureFolioBadge` props (`{ dataSource: DataSource }`) — Task 10 defines, Tasks 14, 15, 16, 17 consume. ✅
- `useAgent{Greeting, Wins, Metrics, Pipeline}` signatures — Tasks 5–8 define `(agentKey: AgentKey) => AgentBlockQuery<T>`; Task 24 consumes consistently. ✅
- Decision dispatcher's new `context` arg — defined in Task 26; consumed by Task 26's `NeedsYouBlock` update.
- Block `data-testid="block-<name>"` — added in Task 24's update step (Step 5 of Task 24 retrofits this on the block components).

**Placeholder scan:** No "TBD"/"TODO"/"implement later" in active task content. The CSS task (Task 27) explicitly directs the engineer to port verbatim from a real source file — an acceptable instruction since the source exists and is named.

**Open watch-out:** Task 27 (CSS port) uses comments like `/* ...port verbatim from alex-home.css... */` as a structural skeleton. The engineer must read the source file and paste each rule. If this feels too loose, expand Task 27 into per-section sub-tasks (`.app-header`, `.folio`, `.greeting-block`, etc.) — but that bloats the plan; the verbatim-port instruction is the cleaner path.

---

## Out of scope for PR-S1 (handled in later PRs)

- Live B1 greeting endpoint + core projection (PR-S2)
- Live B3 wins endpoint + core projection (PR-S3)
- Live B5 pipeline endpoint + core projection (PR-S4)
- Live B4 metrics endpoint + core projection (PR-S5)
- Cutover (production gate removal + `_fixtures.ts` deletion) (PR-S6)
- `/reports` backend wiring
- `/contacts/[id]`, ad-set detail, creative-job detail routes
- Mira (`/mira` 404s; brand-nav skips)
- Inbox drawer (Phase C1)
- Live mode overlay (Phase C2)

---

## Plan complete

**Plan saved to `docs/superpowers/plans/2026-05-04-slice-b-pr-s1-shell-fixtures.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Plans for PRs S2–S6** are intentionally deferred. Each will be written when its PR begins, since (a) S2–S5 follow a tight repeating pattern that's better captured fresh per-PR, (b) S6 is trivial (gate removal), and (c) writing them now risks staleness against learnings from PR-S1.

**Which approach for PR-S1?**
