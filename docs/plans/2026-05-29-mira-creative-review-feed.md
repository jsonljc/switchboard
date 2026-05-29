# Mira Creative Review Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/mira` into a full-screen vertical TikTok-style feed of generated creative drafts that a director scrolls to triage (Continue / Stop), within Mira M1's draft-only, opt-in doctrine.

**Architecture:** A new read-only API endpoint serves the existing `MiraCreativeReadModel` seam (which already derives `draft.videoUrl` for polished + UGC) as **server-filtered, feed-ready** jobs. A dashboard feed UI (vertical scroll-snap video feed + a consequence-graded action rail) consumes it. The detail page is re-backed by the same seam (UGC parity). Home's Team Pulse chip + `MiraPanel` become enablement-aware so the feed is reachable.

**Tech Stack:** TypeScript (ESM, `.js` relative imports **except** the dashboard), pnpm + Turborepo, Zod, Prisma (Postgres), Fastify (API), Next.js 14 App Router + TanStack Query (dashboard), Vitest + Testing Library.

**Spec:** `docs/plans/2026-05-29-mira-creative-review-feed-design.md` (read it first — §11 locked decisions, §12 acceptance criteria).

---

## Before you start

- **Worktree.** This plan is implemented on a feature branch in an isolated worktree off `main` (created via `superpowers:using-git-worktrees`), e.g. `git worktree add .claude/worktrees/mira-feed -b feat/mira-creative-feed` then `pnpm worktree:init`. The spec + this plan land on `main` first via the focused docs PR on branch `docs/mira-creative-review-feed`; the implementation branch **consumes** them.
- **Baseline.** `pnpm install && pnpm typecheck && pnpm test`. If `@switchboard/db` typecheck shows missing `@prisma/client` exports (or `organizationId_idempotencyKey`), run `pnpm reset` first (stale client). Two pre-existing non-Mira flakes are NOT yours: `chat` `gateway-bridge-attribution` (full-suite load) and `dashboard` `auth-onboarding` `KnowledgeKind` mock.
- **Conventions.** Commit subjects start lowercase (commitlint). `next build` is not in CI — run `pnpm --filter @switchboard/dashboard build` before declaring the dashboard PRs done. Never add Publish/Launch/"use"/Approve-creative copy or a new mutating route. Dashboard imports omit `.js`.

---

## File structure

**PR1 — feed read endpoint (list):**

- Create: `apps/api/src/routes/agent-home/creatives.ts` — `creativesRoute`; `GET /agents/:agentId/creatives` (mira-only, enablement-gated, server-filtered).
- Modify: `apps/api/src/bootstrap/routes.ts` — register `creativesRoute`.
- Create: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts`.
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` — `listMiraCreatives(limit)`.
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/route.ts` — proxy.
- Modify: `apps/dashboard/src/lib/query-keys.ts` — `miraFeed` keys.
- Create: `apps/dashboard/src/hooks/use-mira-feed.ts` — `useMiraFeed`.

**PR2 — UGC detail parity (single):**

- Modify: `apps/api/src/routes/agent-home/creatives.ts` — add `GET /agents/:agentId/creatives/:id`.
- Modify: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts` — single-item cases.
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` — `getMiraCreative(id)`.
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/route.ts` — proxy.
- Create: `apps/dashboard/src/hooks/use-mira-creative.ts` — `useMiraCreative`.
- Modify: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx` — seam-backed.
- Create: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/__tests__/creative-detail-page.test.tsx`.

**PR3A — passive feed UI:**

- Modify: `apps/dashboard/src/app/(auth)/mira/page.tsx` — render `MiraFeedPage`.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-feed-page.tsx`.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-creative-feed.tsx`.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-clip-card.tsx`.
- Modify: `apps/dashboard/src/test-setup.ts` — stub `HTMLMediaElement.play/pause`.
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/{mira-creative-feed,mira-clip-card}.test.tsx`.

**PR3B — action rail:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx`.
- Modify: `mira-clip-card.tsx` (mount the rail), `mira-creative-feed.tsx` (`onResolve` → dismiss + advance).
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-actions.test.tsx`.

**PR4 — entry-point coherence:**

- Create: `apps/dashboard/src/hooks/use-mira-enabled.ts`.
- Modify: `apps/dashboard/src/components/agent-panel/mira-panel.tsx` (enablement-aware drill-in).
- Modify: `apps/dashboard/src/components/home/home-page.tsx` (Team Pulse Mira `setUp`).
- Modify: `apps/dashboard/src/components/agent-panel/__tests__/mira-panel.test.tsx` (+ enabled case).

**PR5 — demo seed + runbook + acceptance:**

- Create: `packages/db/src/seed/seed-mira-demo-creatives.ts` + `__tests__`.
- Modify: `packages/db/prisma/seed.ts` (call it for `org_dev`).
- Create: `docs/runbooks/2026-05-29-mira-pilot-enablement.md`.

---

## PR0 — Land the docs PR

- [ ] **Step 1: Commit this plan onto the existing docs branch**

The spec is already committed on `docs/mira-creative-review-feed`. Add this plan to the same branch.

```bash
git checkout docs/mira-creative-review-feed
git add docs/plans/2026-05-29-mira-creative-review-feed.md
git commit -m "docs(mira): add creative review feed implementation plan"
```

- [ ] **Step 2: Open the focused docs PR to main**

```bash
git push -u origin docs/mira-creative-review-feed
gh pr create --base main --title "docs(mira): creative review feed spec + plan" --body "Spec + implementation plan for the Mira creative review feed. Draft-only, opt-in; consumes the M1 seam.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(Implementation begins on a separate `feat/mira-creative-feed` worktree off `main`, consuming the merged spec + plan.)

---

## PR1 — Feed read endpoint (list)

Read-only, mira-only, enablement-gated. Returns **server-filtered** feed-ready jobs + `feed` meta. Mirrors `pipeline.ts`/`metrics.ts` preamble exactly.

### Task 1.1: The `creativesRoute` list handler

**Files:**

- Create: `apps/api/src/routes/agent-home/creatives.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the route**

```ts
// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
import { AgentKeySchema } from "@switchboard/schemas";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

// Wide read window so server-side filtering sees the whole fetched window
// BEFORE applying the feed `limit` (filter-before-limit). Bounded by the
// reader's own FETCH_CAP.
const FEED_WINDOW = 200;

// A clip is "reviewable" (belongs in the feed) only if it is in a review-ready
// status AND has a watchable draft video. UGC + polished both resolve through
// the seam's deriveDraft, so this is mode-agnostic here.
export function isReviewable(job: MiraCreativeJobSummary): boolean {
  return (
    (job.status === "awaiting_review" || job.status === "draft_ready") &&
    typeof job.draft?.videoUrl === "string"
  );
}

// "Rendering" = actively generating, nothing watchable yet (header count only).
export function isRendering(job: MiraCreativeJobSummary): boolean {
  return !job.draft?.videoUrl && (job.status === "in_progress" || job.status === "awaiting_review");
}

export const creativesRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.get("/agents/:agentId/creatives", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "Invalid limit" });

    const { agentId } = params.data;
    // The creative feed is a Mira-only surface (the seam reads creative jobs).
    if (agentId !== "mira")
      return reply.code(404).send({ error: "Feed not available for this agent" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const timezone = await getOrgTimezone(prisma, orgId);
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    const rm = await reader.read(orgId, { now: new Date(), timezone, visibleLimit: FEED_WINDOW });

    const reviewable = rm.jobs.filter(isReviewable);
    const renderingCount = rm.jobs.filter(isRendering).length;
    const jobs = reviewable.slice(0, q.data.limit);

    return reply.code(200).send({
      jobs,
      counts: rm.counts,
      feed: { reviewableCount: reviewable.length, renderingCount },
    });
  });
};
```

- [ ] **Step 2: Register the route**

In `apps/api/src/bootstrap/routes.ts`, alongside the other agent-home registrations (add the import with the others and the register next to `pipelineRoute`):

```ts
import { creativesRoute } from "../routes/agent-home/creatives.js";
// ...
// GET /api/dashboard/agents/:agentId/creatives — Mira creative review feed
await app.register(creativesRoute, { prefix: "/api/dashboard" });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS. (If `@switchboard/core`/`db` exports look missing, `pnpm reset` first.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/agent-home/creatives.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(mira): read-only creative feed endpoint (server-filtered)"
```

### Task 1.2: Feed endpoint tests (mocked Prisma)

**Files:**

- Create: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { creativesRoute } from "../creatives.js";

const PILOT = "pilot";
const OTHER = "other";

// Raw CreativeJob rows (the reader maps them through the seam). Newest first.
function baseJob(over: Record<string, unknown>) {
  return {
    taskId: "t",
    deploymentId: "d",
    productDescription: "P",
    targetAudience: "a",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    productionTier: null,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcPhaseOutputsVersion: null,
    ugcConfig: null,
    ugcFailure: null,
    organizationId: PILOT,
    createdAt: new Date("2026-05-26T10:00:00Z"),
    updatedAt: new Date("2026-05-26T10:00:00Z"),
    ...over,
  };
}

// Newest → oldest. Two newest have NO video (rendering); two older ARE reviewable.
const PILOT_ROWS = [
  baseJob({
    id: "rendering-newest",
    createdAt: new Date("2026-05-28"),
    currentStage: "trends",
    stageOutputs: {},
  }), // in_progress
  baseJob({
    id: "rendering-2",
    createdAt: new Date("2026-05-27"),
    currentStage: "hooks",
    stageOutputs: { trends: {} },
  }), // awaiting_review, no video
  baseJob({
    id: "polished-ready",
    createdAt: new Date("2026-05-26"),
    currentStage: "complete",
    stageOutputs: {
      production: {
        assembledVideos: [
          { videoUrl: "https://x/p.mp4", thumbnailUrl: "https://x/p.jpg", duration: 12 },
        ],
      },
    },
  }), // draft_ready + video
  baseJob({
    id: "ugc-ready",
    createdAt: new Date("2026-05-25"),
    mode: "ugc",
    ugcPhase: "complete",
    ugcPhaseOutputs: { production: { assets: [{ outputs: { videoUrl: "https://x/u.mp4" } }] } },
  }), // draft_ready + UGC video
];

function buildPrismaMock() {
  return {
    creativeJob: {
      findMany: async (args: { where?: { organizationId?: string } }) =>
        args?.where?.organizationId === PILOT ? PILOT_ROWS : [],
    },
    organizationConfig: { findFirst: async () => null },
  };
}

describe("GET /agents/mira/creatives", () => {
  let ctx: TestContext;

  async function get(org: string, path: string): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: "GET", url: path, headers: { "x-org-id": org } });
  }

  beforeAll(async () => {
    ctx = await buildTestServer();
    (ctx.app as unknown as { prisma: unknown }).prisma = buildPrismaMock();
    await ctx.app.register(creativesRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });
  afterAll(async () => ctx.app.close());

  it("disabled org → 404 (no leak)", async () => {
    const res = await get(OTHER, "/api/dashboard/agents/mira/creatives");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("polished-ready");
  });

  it("non-mira agent → 404 (feed is mira-only)", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/alex/creatives");
    expect(res.statusCode).toBe(404);
  });

  it("enabled org → only reviewable jobs, with feed meta", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      jobs: Array<{ id: string; draft?: { videoUrl?: string } }>;
      feed: { reviewableCount: number; renderingCount: number };
    };
    expect(body.jobs.map((j) => j.id).sort()).toEqual(["polished-ready", "ugc-ready"]);
    expect(body.jobs.every((j) => typeof j.draft?.videoUrl === "string")).toBe(true);
    expect(body.feed).toEqual({ reviewableCount: 2, renderingCount: 2 });
  });

  it("filter-before-limit: older reviewable survives newer no-video clips", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives?limit=1");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jobs: Array<{ id: string }>; feed: { reviewableCount: number } };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]!.id).toBe("polished-ready"); // newest *reviewable*, not newest overall
    expect(body.feed.reviewableCount).toBe(2);
  });

  it("invalid limit → 400", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives?limit=999");
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @switchboard/api test -- creatives-route`
Expected: PASS (the route from Task 1.1 satisfies all cases). If RED, fix the route, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts
git commit -m "test(mira): feed endpoint gate, filtering, and feed meta"
```

### Task 1.3: Dashboard data layer (api-client + proxy + keys + hook)

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/route.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/hooks/use-mira-feed.ts`

- [ ] **Step 1: Add the api-client method**

In `apps/dashboard/src/lib/api-client/governance.ts`, near `listPipeline`, add (import the types at the top of the file with the other `@switchboard/core` type imports):

```ts
import type { MiraCreativeJobSummary, MiraCreativeCounts } from "@switchboard/core";

export interface MiraFeedResponse {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
  feed: { reviewableCount: number; renderingCount: number };
}

  // (inside the api-client class, near listPipeline)
  async listMiraCreatives(limit = 20): Promise<MiraFeedResponse> {
    const path = `/api/dashboard/agents/mira/creatives?limit=${encodeURIComponent(String(limit))}`;
    return this.request<MiraFeedResponse>(path);
  }
```

- [ ] **Step 2: Add the proxy route**

Create `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Dashboard proxy for `GET /api/dashboard/agents/mira/creatives` (review feed). */
export async function GET(request: Request) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const data = await client.listMiraCreatives(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Add the query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add inside the returned object (e.g. after `creativeJobs`):

```ts
  miraFeed: {
    all: () => [orgId, "miraFeed"] as const,
    list: () => [orgId, "miraFeed", "list"] as const,
    detail: (id: string) => [orgId, "miraFeed", "detail", id] as const,
  },
```

- [ ] **Step 4: Add the hook**

Create `apps/dashboard/src/hooks/use-mira-feed.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraCreativeJobSummary, MiraCreativeCounts } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

export interface MiraFeedData {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
  feed: { reviewableCount: number; renderingCount: number };
}

/** Live Mira review feed. Server returns only reviewable (video-bearing) jobs. */
export function useMiraFeed(limit = 20) {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.list() ?? ["__disabled_mira_feed__"],
    queryFn: async (): Promise<MiraFeedData> => {
      const res = await fetch(`/api/dashboard/agents/mira/creatives?limit=${limit}`);
      if (!res.ok) throw new Error(`Mira feed fetch failed (HTTP ${res.status})`);
      return (await res.json()) as MiraFeedData;
    },
    enabled: !!keys,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
```

- [ ] **Step 5: Typecheck + build the dashboard**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: PASS (build catches the new route/page wiring CI does not).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/api-client/governance.ts apps/dashboard/src/app/api/dashboard/agents/mira apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-mira-feed.ts
git commit -m "feat(mira): dashboard feed data layer (api-client, proxy, hook)"
```

---

## PR2 — UGC detail parity (single, seam-backed)

The detail page reads the **seam** (so UGC + polished render identically) instead of the raw marketplace wire type.

### Task 2.1: Single-creative endpoint + tests

**Files:**

- Modify: `apps/api/src/routes/agent-home/creatives.ts`
- Modify: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts`

- [ ] **Step 1: Add the `/:id` handler**

In `creatives.ts`, add a second route inside `creativesRoute` (after the list handler). It reuses the same gate; org-scoping makes cross-org a 404.

```ts
const ParamsWithIdSchema = z.object({ agentId: AgentKeySchema, id: z.string().min(1) });

app.get("/agents/:agentId/creatives/:id", async (request, reply) => {
  const params = ParamsWithIdSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid params" });
  const { agentId, id } = params.data;
  if (agentId !== "mira")
    return reply.code(404).send({ error: "Feed not available for this agent" });

  const orgId = requireOrganizationScope(request, reply);
  if (!orgId) return;
  if (!app.orgAgentEnablementStore) {
    return reply.code(503).send({ error: "Enablement store unavailable" });
  }
  if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
    return reply.code(404).send({ error: "Agent not available on home" });
  }
  const prisma = app.prisma;
  if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

  const timezone = await getOrgTimezone(prisma, orgId);
  const reader = new PrismaMiraCreativeReadModelReader(prisma);
  // Org-scoped read → find by id. Cross-org ids are simply absent (→ 404).
  const rm = await reader.read(orgId, { now: new Date(), timezone, visibleLimit: FEED_WINDOW });
  const job = rm.jobs.find((j) => j.id === id);
  if (!job) return reply.code(404).send({ error: "Creative not found" });
  return reply.code(200).send({ job });
});
```

- [ ] **Step 2: Add single-item tests**

Append to `creatives-route.test.ts`:

```ts
it("single: UGC creative returns a seam-derived draft video", async () => {
  const res = await get(PILOT, "/api/dashboard/agents/mira/creatives/ugc-ready");
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    job: { id: string; draft?: { videoUrl?: string }; source: { mode: string } };
  };
  expect(body.job.id).toBe("ugc-ready");
  expect(body.job.draft?.videoUrl).toBe("https://x/u.mp4");
  expect(body.job.source.mode).toBe("ugc");
});

it("single: cross-org id → 404", async () => {
  // PILOT's job is invisible to OTHER (enable OTHER so the gate passes, prove WHERE isolation).
  await ctx.app.orgAgentEnablementStore!.enable(OTHER, "mira");
  try {
    const res = await get(OTHER, "/api/dashboard/agents/mira/creatives/polished-ready");
    expect(res.statusCode).toBe(404);
  } finally {
    await ctx.app.orgAgentEnablementStore!.setStatus(OTHER, "mira", "disabled");
  }
});
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/api test -- creatives-route`
Expected: PASS.

```bash
git add apps/api/src/routes/agent-home/creatives.ts apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts
git commit -m "feat(mira): single-creative seam endpoint for detail parity"
```

### Task 2.2: Dashboard single-creative data layer

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/route.ts`
- Create: `apps/dashboard/src/hooks/use-mira-creative.ts`

- [ ] **Step 1: api-client method**

```ts
  async getMiraCreative(id: string): Promise<{ job: MiraCreativeJobSummary }> {
    const path = `/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}`;
    return this.request<{ job: MiraCreativeJobSummary }>(path);
  }
```

- [ ] **Step 2: proxy**

Create `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { id } = await params;
    const data = await client.getMiraCreative(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: hook**

Create `apps/dashboard/src/hooks/use-mira-creative.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

/** Single Mira creative (seam-derived) for the detail page. */
export function useMiraCreative(id: string, initialData?: MiraCreativeJobSummary) {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.detail(id) ?? ["__disabled_mira_creative__"],
    initialData,
    queryFn: async (): Promise<MiraCreativeJobSummary> => {
      const res = await fetch(`/api/dashboard/agents/mira/creatives/${id}`);
      if (!res.ok) throw new Error(`Mira creative fetch failed (HTTP ${res.status})`);
      return ((await res.json()) as { job: MiraCreativeJobSummary }).job;
    },
    enabled: !!id && !!keys,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/api-client/governance.ts "apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]" apps/dashboard/src/hooks/use-mira-creative.ts
git commit -m "feat(mira): single-creative dashboard data layer"
```

### Task 2.3: Re-back the detail page with the seam

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`
- Create: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/__tests__/creative-detail-page.test.tsx`

- [ ] **Step 1: Write the failing parity test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const mockCreative = vi.fn();
const mockApprove = { mutate: vi.fn(), isPending: false, isError: false };
vi.mock("@/hooks/use-mira-creative", () => ({ useMiraCreative: () => mockCreative() }));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => mockApprove,
  useCostEstimate: () => ({ data: null }),
}));

import { MiraCreativeDetailPage } from "../creative-detail-page";

function summary(over: Partial<MiraCreativeJobSummary>): MiraCreativeJobSummary {
  return {
    id: "j",
    title: "Spring promo",
    stage: "complete",
    status: "draft_ready",
    reviewAction: { canContinue: false, canStop: false, label: "review_draft" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    ...over,
  };
}

describe("MiraCreativeDetailPage (seam-backed)", () => {
  beforeEach(() => mockCreative.mockReset());

  it("renders a UGC draft clip (no 'No draft clip yet')", () => {
    mockCreative.mockReturnValue({
      data: summary({
        source: { engine: "legacy_creative_job", mode: "ugc" },
        draft: { videoUrl: "https://x/u.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    const { container } = render(<MiraCreativeDetailPage id="j" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/u.mp4");
    expect(screen.queryByText(/No draft clip yet/i)).toBeNull();
  });

  it("renders a polished draft clip", () => {
    mockCreative.mockReturnValue({
      data: summary({ draft: { videoUrl: "https://x/p.mp4" } }),
      isLoading: false,
      isError: false,
    });
    const { container } = render(<MiraCreativeDetailPage id="j" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/p.mp4");
  });

  it("never shows publish/launch copy", () => {
    mockCreative.mockReturnValue({
      data: summary({ draft: { videoUrl: "https://x/p.mp4" } }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    expect(screen.queryByText(/publish|launch|go live|approve creative/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `pnpm --filter @switchboard/dashboard test -- creative-detail-page`
Expected: FAIL — the page still imports `useCreativeJob` and reads `stageOutputs`.

- [ ] **Step 3: Rewrite the detail page**

Replace `creative-detail-page.tsx` with a seam-backed version. Continue/Stop wiring (confirms, cost copy, irreversible-stop) is preserved; only the data source + video extraction change.

```tsx
"use client";

import { useState } from "react";
import { useMiraCreative } from "@/hooks/use-mira-creative";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";

export function MiraCreativeDetailPage({ id }: { id: string }) {
  const jobQ = useMiraCreative(id);
  const approve = useApproveStage();
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const job = jobQ.data;

  const canContinue = !!job?.reviewAction.canContinue;
  const canStop = !!job?.reviewAction.canStop;
  const estimateQ = useCostEstimate(id, canContinue);

  if (jobQ.isLoading) return <div style={{ padding: 28 }}>Loading draft…</div>;
  if (jobQ.isError)
    return <div style={{ padding: 28 }}>Couldn&apos;t load this draft — try again.</div>;
  if (!job) return <div style={{ padding: 28 }}>Draft not found.</div>;

  const videoUrl = job.draft?.videoUrl;

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          background: "#EFECF6",
          color: "#3C315C",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        Draft only — not published. Nothing goes live without you.
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{job.title}</h1>

      {videoUrl ? (
        <video
          src={videoUrl}
          poster={job.draft?.thumbnailUrl}
          controls
          playsInline
          style={{ width: "100%", borderRadius: 10 }}
        />
      ) : (
        <div style={{ color: "#777" }}>No draft clip yet — still generating.</div>
      )}

      <div style={{ fontSize: 13, color: "#777" }}>
        {job.status === "draft_ready"
          ? "Draft completed — ready for your review."
          : job.status === "stopped"
            ? "This draft was stopped."
            : job.status === "awaiting_review"
              ? "Awaiting your review."
              : "Still drafting."}
      </div>

      {canContinue || canStop ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {confirm === null && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {canContinue && (
                <button
                  disabled={approve.isPending}
                  onClick={() => setConfirm("continue")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "#3C315C",
                    color: "white",
                    border: "none",
                  }}
                >
                  Continue draft
                </button>
              )}
              {canStop && (
                <button
                  disabled={approve.isPending}
                  onClick={() => setConfirm("stop")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "transparent",
                    color: "#3C315C",
                    border: "1px solid #3C315C",
                  }}
                >
                  Stop draft
                </button>
              )}
              <span style={{ fontSize: 12, color: "#777" }}>
                {estimateQ.data
                  ? `Continue runs the next generation step (~$${estimateQ.data.basic.cost}). Stop is free but can't be undone.`
                  : "Continue runs the next generation step (a real cost). Stop is free but can't be undone."}
              </span>
            </div>
          )}

          {confirm === "continue" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: "#EFECF6",
              }}
            >
              <span style={{ fontSize: 13, color: "#3C315C" }}>
                Continue draft? Runs the next generation step. This may create provider cost
                {estimateQ.data ? ` (about $${estimateQ.data.basic.cost})` : ""}. It stays a draft —
                nothing is published.
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "continue" });
                    setConfirm(null);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "#3C315C",
                    color: "white",
                    border: "none",
                  }}
                >
                  Confirm continue
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid #999",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {confirm === "stop" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: "#F6ECEC",
              }}
            >
              <span style={{ fontSize: 13, color: "#7A2E2E" }}>
                Stop this draft? You can&apos;t continue it later. This can&apos;t be undone.
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ jobId: id, action: "stop" });
                    setConfirm(null);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "#7A2E2E",
                    color: "white",
                    border: "none",
                  }}
                >
                  Stop draft
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid #999",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {approve.isError && (
            <span style={{ color: "#7A2E2E", fontSize: 12 }}>
              Couldn&apos;t update the draft — try again.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test (GREEN) + build**

Run: `pnpm --filter @switchboard/dashboard test -- creative-detail-page && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx" "apps/dashboard/src/app/(auth)/mira/creatives/[id]/__tests__/creative-detail-page.test.tsx"
git commit -m "feat(mira): back creative detail with the seam (UGC parity)"
```

---

## PR3A — Passive feed UI

Full-screen vertical video feed. **No Continue/Stop yet** (PR3B). Isolates video-playback wiring from mutation wiring.

### Task 3A.1: Stub media playback for jsdom

**Files:**

- Modify: `apps/dashboard/src/test-setup.ts`

- [ ] **Step 1: Add play/pause stubs** (jsdom doesn't implement them; the video card calls them)

Append to `test-setup.ts`:

```ts
// jsdom does not implement HTMLMediaElement play/pause — stub so feed/clip tests
// can assert play()/pause() calls without "Not implemented" errors.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: () => {},
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/test-setup.ts
git commit -m "test(dashboard): stub HTMLMediaElement play/pause for jsdom"
```

### Task 3A.2: The clip card (video + chip + metadata)

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-clip-card.tsx`
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { MiraClipCard } from "../mira-clip-card";

function clip(over: Partial<MiraCreativeJobSummary> = {}): MiraCreativeJobSummary {
  return {
    id: "j1",
    title: "Spring promo",
    stage: "production",
    status: "awaiting_review",
    draft: { videoUrl: "https://x/v.mp4" },
    reviewAction: { canContinue: true, canStop: true, label: "continue_draft" },
    source: { engine: "legacy_creative_job", mode: "ugc" },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
    ...over,
  };
}

afterEach(() => push.mockReset());

describe("MiraClipCard", () => {
  it("renders the video and a mode-correct status chip", () => {
    const { container } = render(<MiraClipCard job={clip()} isActive />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/v.mp4");
    expect(screen.getByText(/awaiting review|in draft/i)).toBeInTheDocument();
    expect(screen.getByText(/UGC/i)).toBeInTheDocument();
  });

  it("active clip plays; inactive clip pauses", () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const { rerender } = render(<MiraClipCard job={clip()} isActive />);
    expect(playSpy).toHaveBeenCalled();
    rerender(<MiraClipCard job={clip()} isActive={false} />);
    expect(pauseSpy).toHaveBeenCalled();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("tapping the title navigates to detail", () => {
    render(<MiraClipCard job={clip()} isActive />);
    fireEvent.click(screen.getByText("Spring promo"));
    expect(push).toHaveBeenCalledWith("/mira/creatives/j1");
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-card`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card** (no actions yet; a `footer` slot is added in PR3B)

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MiraCreativeJobSummary } from "@switchboard/core";

function statusLabel(status: MiraCreativeJobSummary["status"]): string {
  switch (status) {
    case "draft_ready":
      return "Ready for review";
    case "awaiting_review":
      return "Awaiting review";
    default:
      return "In draft";
  }
}

/**
 * One full-bleed clip page. `isActive` drives autoplay (only the in-view clip
 * plays). `footer` is the action rail slot (wired in PR3B).
 */
export function MiraClipCard({
  job,
  isActive,
  footer,
}: {
  job: MiraCreativeJobSummary;
  isActive: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) void el.play().catch(() => {});
    else el.pause();
  }, [isActive]);

  return (
    <section
      data-testid="mira-clip"
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        scrollSnapAlign: "start",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {job.draft?.videoUrl ? (
        <video
          ref={videoRef}
          src={job.draft.videoUrl}
          poster={job.draft.thumbnailUrl}
          muted
          loop
          playsInline
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) void v.play().catch(() => {});
            else v.pause();
          }}
          style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
        />
      ) : (
        <div style={{ color: "#bbb", fontSize: 14 }}>This clip didn&apos;t load.</div>
      )}

      {/* status chip */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 12,
        }}
      >
        {statusLabel(job.status)}
      </div>

      {/* metadata caption → detail */}
      <button
        type="button"
        onClick={() => router.push(`/mira/creatives/${job.id}`)}
        style={{
          position: "absolute",
          left: 14,
          bottom: 18,
          maxWidth: "70%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "#fff",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 600 }}>{job.title}</span>
        <span style={{ opacity: 0.8 }}> · {job.source.mode === "ugc" ? "UGC" : "Polished"} ↗</span>
      </button>

      {/* action rail slot (PR3B) */}
      <div style={{ position: "absolute", right: 14, bottom: 24 }}>{footer}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run (GREEN) + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-card`
Expected: PASS.

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-clip-card.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-card.test.tsx
git commit -m "feat(mira): clip card (video, status chip, detail link)"
```

### Task 3A.3: The feed container

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-creative-feed.tsx`
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-creative-feed.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const feed = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feed() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { MiraCreativeFeed } from "../mira-creative-feed";

function clip(id: string): MiraCreativeJobSummary {
  return {
    id,
    title: `Clip ${id}`,
    stage: "production",
    status: "awaiting_review",
    draft: { videoUrl: `https://x/${id}.mp4` },
    reviewAction: { canContinue: true, canStop: true, label: "continue_draft" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
  };
}

describe("MiraCreativeFeed", () => {
  it("renders a card per job", () => {
    feed.mockReturnValue({
      data: {
        jobs: [clip("a"), clip("b")],
        counts: {},
        feed: { reviewableCount: 2, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeFeed />);
    expect(screen.getAllByTestId("mira-clip")).toHaveLength(2);
  });

  it("empty → honest empty state", () => {
    feed.mockReturnValue({
      data: { jobs: [], counts: {}, feed: { reviewableCount: 0, renderingCount: 0 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeFeed />);
    expect(screen.getByText(/No drafts to review yet/i)).toBeInTheDocument();
  });

  it("loading → skeleton, not empty copy", () => {
    feed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<MiraCreativeFeed />);
    expect(screen.queryByText(/No drafts to review yet/i)).toBeNull();
    expect(screen.getByTestId("mira-feed-skeleton")).toBeInTheDocument();
  });

  it("error → retry card", () => {
    feed.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MiraCreativeFeed />);
    expect(screen.getByText(/Couldn't load/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-creative-feed`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the feed** (tracks active index via IntersectionObserver; renders cards)

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { MiraClipCard } from "./mira-clip-card";

export function MiraCreativeFeed() {
  const { data, isLoading, isError } = useMiraFeed();
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const jobs = data?.jobs ?? [];

  // Update the active (in-view) clip on scroll. IntersectionObserver is the
  // browser path; the first clip is active on mount so autoplay starts without
  // waiting for an intersection (and so tests are deterministic).
  useEffect(() => {
    const root = containerRef.current;
    if (!root || jobs.length === 0) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-clip-index]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.clipIndex);
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { root, threshold: 0.6 },
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [jobs.length]);

  if (isLoading) {
    return <div data-testid="mira-feed-skeleton" style={{ height: "100%", background: "#000" }} />;
  }
  if (isError) {
    return (
      <div style={{ padding: 28, color: "#777" }}>
        Couldn&apos;t load your drafts — pull to refresh.
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div style={{ padding: 28, color: "#777" }}>
        No drafts to review yet — Mira&apos;s drafts will appear here as they generate.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", overflowY: "auto", scrollSnapType: "y mandatory" }}
    >
      {jobs.map((job, i) => (
        <div key={job.id} data-clip-index={i} style={{ height: "100%", scrollSnapAlign: "start" }}>
          <MiraClipCard job={job} isActive={i === activeIndex} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN) + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-creative-feed`
Expected: PASS.

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-creative-feed.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-creative-feed.test.tsx
git commit -m "feat(mira): vertical scroll-snap creative feed container"
```

### Task 3A.4: The feed page + `/mira` swap

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-feed-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/mira/page.tsx`

- [ ] **Step 1: Implement the feed page** (slim header: identity, halt, mission, count line + the feed)

```tsx
"use client";

import { useState } from "react";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { MiraCreativeFeed } from "./mira-creative-feed";

export function MiraFeedPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const feedQ = useMiraFeed();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;
  const meta = feedQ.data?.feed;
  const countLine = meta
    ? `${meta.reviewableCount} draft${meta.reviewableCount === 1 ? "" : "s"} to review${meta.renderingCount > 0 ? ` · ${meta.renderingCount} still rendering` : ""}`
    : null;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ position: "relative", background: "#fff" }}>
        <Identity
          statusKey="IDLE"
          halted={haltCtx.halted}
          subtitle={countLine ?? MIRA_MISSION_SUBTITLE}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
          displayName="Mira"
          avatarAccent={{ soft: MIRA_ACCENT.soft, deep: MIRA_ACCENT.deep }}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MiraCreativeFeed />
      </div>
    </div>
  );
}
```

> Verify `Identity`'s prop names against `apps/dashboard/src/components/cockpit/identity.tsx` (this plan mirrors `mira-cockpit-page.tsx`'s usage exactly: `statusKey, halted, subtitle, line, onHaltToggle, missionInteractive, onOpenMission, displayName, avatarAccent`). If `Identity` ignores `subtitle` for the count line, render `countLine` as a small element directly beneath `Identity` instead.

- [ ] **Step 2: Swap the route**

Replace `apps/dashboard/src/app/(auth)/mira/page.tsx`'s body so it renders `MiraFeedPage`:

```tsx
import { MiraFeedPage } from "@/components/cockpit/mira/mira-feed-page";

// Mira is opt-in per org (no global day-one); the route still 404s server-side
// for orgs without Mira enabled. This renders the review feed for enabled orgs.
export default function Page() {
  return <MiraFeedPage />;
}
```

> Preserve any existing metadata export / server-gating in the current `page.tsx`. The old `MiraCockpitPage` (`mira-cockpit-page.tsx`) is now unused — leave it for PR-cleanup or delete it in this step if nothing else imports it (grep first: `rg "mira-cockpit-page" apps/dashboard/src`).

- [ ] **Step 3: Build (catches page/import errors CI misses)**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-feed-page.tsx "apps/dashboard/src/app/(auth)/mira/page.tsx"
git commit -m "feat(mira): feed page with slim header; /mira renders the feed"
```

---

## PR3B — Action rail

Add Continue (cost-confirm) / Stop (irreversible-confirm), halt behavior, and the mutation-success flow (dismiss + advance + toast).

### Task 3B.1: The action rail component

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx`
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MiraReviewAction } from "@switchboard/core";

const mutate = vi.fn();
let halted = false;
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => ({ mutate, isPending: false, isError: false }),
  useCostEstimate: () => ({
    data: { basic: { cost: 4, description: "" }, pro: { cost: 9, description: "" } },
  }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({ useHalt: () => ({ halted }) }));

import { MiraClipActions } from "../mira-clip-actions";

const reviewable: MiraReviewAction = { canContinue: true, canStop: true, label: "continue_draft" };

describe("MiraClipActions", () => {
  beforeEach(() => {
    mutate.mockReset();
    halted = false;
  });

  it("Continue requires confirm before mutating", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /continue draft/i }));
    expect(mutate).not.toHaveBeenCalled(); // opened the confirm, not the mutation
    fireEvent.click(screen.getByRole("button", { name: /confirm continue/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", action: "continue" }),
    );
  });

  it("Stop requires an irreversible confirm", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^stop draft$/i }));
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm stop/i }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ jobId: "j1", action: "stop" }));
  });

  it("halted: Continue disabled + labeled, Stop still available", () => {
    halted = true;
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    expect(screen.getByRole("button", { name: /halted/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^stop draft$/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-actions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rail**

```tsx
"use client";

import { useState } from "react";
import type { MiraReviewAction } from "@switchboard/core";
import { useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";
import { useHalt } from "@/components/layout/halt/halt-context";

export function MiraClipActions({
  jobId,
  reviewAction,
  onResolve,
}: {
  jobId: string;
  reviewAction: MiraReviewAction;
  /** Called after a Continue/Stop mutation succeeds → feed dismisses + advances. */
  onResolve: (jobId: string) => void;
}) {
  const approve = useApproveStage();
  const { halted } = useHalt();
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const estimateQ = useCostEstimate(jobId, reviewAction.canContinue && confirm === "continue");

  function run(action: "continue" | "stop") {
    approve.mutate(
      { jobId, action },
      {
        onSuccess: () => {
          setConfirm(null);
          onResolve(jobId);
        },
      },
    );
  }

  const btn = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const;

  if (confirm === "continue") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "rgba(60,49,92,0.95)",
          padding: 10,
          borderRadius: 10,
          maxWidth: 220,
        }}
      >
        <span style={{ color: "#fff", fontSize: 12 }}>
          Continue draft? Runs the next generation step. This may create provider cost
          {estimateQ.data ? ` (about $${estimateQ.data.basic.cost})` : ""}.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...btn, background: "#fff", color: "#3C315C" }}
            disabled={approve.isPending}
            onClick={() => run("continue")}
          >
            Confirm continue
          </button>
          <button
            style={{ ...btn, background: "transparent", border: "1px solid #fff" }}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (confirm === "stop") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "rgba(122,46,46,0.95)",
          padding: 10,
          borderRadius: 10,
          maxWidth: 220,
        }}
      >
        <span style={{ color: "#fff", fontSize: 12 }}>
          Stop this draft? You can&apos;t continue it later. This can&apos;t be undone.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...btn, background: "#fff", color: "#7A2E2E" }}
            disabled={approve.isPending}
            onClick={() => run("stop")}
          >
            Confirm stop
          </button>
          <button
            style={{ ...btn, background: "transparent", border: "1px solid #fff" }}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      {reviewAction.canContinue &&
        (halted ? (
          <button
            style={{ ...btn, background: "#555", cursor: "not-allowed" }}
            disabled
            title="Resume Mira to continue drafts."
          >
            Halted
          </button>
        ) : (
          <button style={{ ...btn, background: "#3C315C" }} onClick={() => setConfirm("continue")}>
            Continue draft
          </button>
        ))}
      {reviewAction.canStop && (
        <button
          style={{ ...btn, background: "rgba(0,0,0,0.55)" }}
          onClick={() => setConfirm("stop")}
        >
          Stop draft
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN) + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-actions`
Expected: PASS.

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-actions.test.tsx
git commit -m "feat(mira): clip action rail (cost-confirm, irreversible-stop, halt)"
```

### Task 3B.2: Wire the rail into the card + feed dismissal

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/mira/mira-clip-card.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-creative-feed.tsx`

- [ ] **Step 1: Pass an `onResolve` through the card into the rail**

In `mira-clip-card.tsx`, add an `onResolve` prop and render `MiraClipActions` in the existing `footer` slot:

```tsx
import { MiraClipActions } from "./mira-clip-actions";

// extend the props:
export function MiraClipCard({
  job,
  isActive,
  onResolve,
}: {
  job: MiraCreativeJobSummary;
  isActive: boolean;
  onResolve: (jobId: string) => void;
}) {
  // ...unchanged video/chip/metadata...
  // replace the footer slot with:
  //   <div style={{ position: "absolute", right: 14, bottom: 24 }}>
  //     <MiraClipActions jobId={job.id} reviewAction={job.reviewAction} onResolve={onResolve} />
  //   </div>
}
```

(Remove the now-unused `footer?: ReactNode` prop + `ReactNode` import.)

- [ ] **Step 2: Feed dismisses resolved clips + advances + invalidates**

In `mira-creative-feed.tsx`, track resolved ids, filter them out, invalidate the feed query, and advance:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
// ...
const queryClient = useQueryClient();
const keys = useScopedQueryKeys();
const [resolved, setResolved] = useState<Set<string>>(new Set());

const jobs = (data?.jobs ?? []).filter((j) => !resolved.has(j.id));

function handleResolve(jobId: string) {
  setResolved((prev) => new Set(prev).add(jobId));
  setActiveIndex((i) => Math.min(i, Math.max(0, jobs.length - 2))); // advance toward next
  if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.list() });
}
// pass onResolve={handleResolve} to <MiraClipCard/>
```

- [ ] **Step 3: Update the feed test for dismissal**

Add to `mira-creative-feed.test.tsx`:

```tsx
it("dismisses a resolved clip from the feed", () => {
  feed.mockReturnValue({
    data: {
      jobs: [clip("a"), clip("b")],
      counts: {},
      feed: { reviewableCount: 2, renderingCount: 0 },
    },
    isLoading: false,
    isError: false,
  });
  render(<MiraCreativeFeed />);
  // resolve clip "a" via its Continue→confirm (rail is now mounted in the card)
  // (the rail mutation hook is real here; mock it if this test should stay isolated)
  expect(screen.getAllByTestId("mira-clip").length).toBeGreaterThan(0);
});
```

> The feed test now renders the real action rail (which uses `useApproveStage`/`useCostEstimate`/`useHalt`). Either wrap the render in a `QueryClientProvider` + mock `useHalt`, or keep the dismissal assertion in `mira-clip-actions` (unit) + a thin feed integration test. Prefer the latter to keep the feed test from depending on the mutation stack.

- [ ] **Step 4: Run + build + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira- && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

```bash
git add apps/dashboard/src/components/cockpit/mira/
git commit -m "feat(mira): mount action rail; feed dismisses resolved clips"
```

---

## PR4 — Entry-point coherence

Make `/mira` reachable: an enablement-aware Home Team Pulse chip + a `MiraPanel` that drills into the feed.

### Task 4.1: The enablement probe hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-mira-enabled.ts`

- [ ] **Step 1: Implement** (probe the gated mission endpoint: 200 ⇒ enabled, 404 ⇒ not)

```ts
"use client";

import { useAgentMission } from "./use-agent-mission";

/**
 * Mira is opt-in per org. Its agent-home endpoints 404 unless enabled, so the
 * mission probe is the dashboard's source of truth for enablement.
 *   enabled === undefined → still loading (don't flash "not set up")
 */
export function useMiraEnabled(): { enabled: boolean | undefined; isLoading: boolean } {
  const m = useAgentMission("mira");
  if (m.isLoading) return { enabled: undefined, isLoading: true };
  return { enabled: !m.isError && !!m.data, isLoading: false };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/hooks/use-mira-enabled.ts
git commit -m "feat(mira): dashboard enablement probe hook"
```

### Task 4.2: Enablement-aware MiraPanel

**Files:**

- Modify: `apps/dashboard/src/components/agent-panel/mira-panel.tsx`
- Modify: `apps/dashboard/src/components/agent-panel/__tests__/mira-panel.test.tsx`

- [ ] **Step 1: Update the test (RED on the enabled case)**

Replace `mira-panel.test.tsx` with both states (mock the hooks):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
let enabled: boolean | undefined = false;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/use-mira-enabled", () => ({
  useMiraEnabled: () => ({ enabled, isLoading: false }),
}));

import { MiraPanel } from "@/components/agent-panel/mira-panel";

describe("MiraPanel", () => {
  it("not enabled → honest 'not set up', no dead anchors", () => {
    enabled = false;
    const { container } = render(<MiraPanel />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(container.querySelector('a[href^="#"]')).toBeNull();
  });

  it("enabled → drills into the workspace", () => {
    enabled = true;
    render(<MiraPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open.*workspace|open mira/i }));
    expect(push).toHaveBeenCalledWith("/mira");
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-panel`
Expected: FAIL — `MiraPanel` has no enabled branch / no router.

- [ ] **Step 3: Implement the enablement-aware panel**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import styles from "./agent-panel.module.css";

/**
 * Enablement-aware Mira drill-in. When Mira is enabled for the org, offer to
 * open her review feed (/mira). Otherwise show the honest "not set up" body —
 * no dead anchors, no fabricated capability claims.
 */
export function MiraPanel() {
  const router = useRouter();
  const { enabled } = useMiraEnabled();

  if (enabled) {
    return (
      <div className={styles.notset}>
        <div className={styles.notsetMark} aria-hidden="true">
          M
        </div>
        <h3 className={styles.notsetHeading}>Mira is set up</h3>
        <p className={styles.notsetSub}>
          Review her latest creative drafts and decide what moves forward.
        </p>
        <button type="button" onClick={() => router.push("/mira")}>
          Open Mira&apos;s workspace →
        </button>
      </div>
    );
  }

  return (
    <div className={styles.notset}>
      <div className={styles.notsetMark} aria-hidden="true">
        M
      </div>
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN) + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-panel`
Expected: PASS.

```bash
git add apps/dashboard/src/components/agent-panel/mira-panel.tsx apps/dashboard/src/components/agent-panel/__tests__/mira-panel.test.tsx
git commit -m "feat(mira): enablement-aware MiraPanel drill-in"
```

### Task 4.3: Home Team Pulse chip reflects real enablement

**Files:**

- Modify: `apps/dashboard/src/components/home/home-page.tsx`

- [ ] **Step 1: Use the probe for Mira's `setUp`**

In `home-page.tsx`, add the hook near the other hooks:

```tsx
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
// ...
const miraEnabled = useMiraEnabled();
```

Then in the `teamPulseAgents` map, replace Mira's branch so it uses the real signal (alex/riley unchanged):

```tsx
let setUp: boolean;
if (key === "alex" && alexMission.data) {
  setUp = !coreSetupIncomplete(alexMission.data, "alex");
} else if (key === "riley" && rileyMission.data) {
  setUp = !coreSetupIncomplete(rileyMission.data, "riley");
} else if (key === "mira") {
  // Real per-org enablement (probe). Loading/unknown → not set up (Mira is
  // day-thirty), so we never flash a transient wrong state.
  setUp = miraEnabled.enabled === true;
} else {
  setUp = entry.launchTier === "day-one";
}
```

Remove the now-stale comment claiming "Mira has no mission endpoint (404)".

- [ ] **Step 2: Build (page wiring)**

Run: `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/home/home-page.tsx
git commit -m "feat(mira): Home Team Pulse reflects real Mira enablement"
```

---

## PR5 — Demo seed + enablement runbook + acceptance

### Task 5.1: Dev-only demo creative drafts for `org_dev`

**Files:**

- Create: `packages/db/src/seed/seed-mira-demo-creatives.ts`
- Create: `packages/db/src/seed/__tests__/seed-mira-demo-creatives.test.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Implement the seed** (reuses an existing org deployment; idempotent; dev-only)

```ts
import type { PrismaClient } from "@prisma/client";

// Non-production demo assets — short hosted sample clips so the local feed
// renders. Swap for real Mira output before any non-dev use.
const SAMPLE_POLISHED =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
const SAMPLE_UGC = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";

/**
 * Seeds two demo creative drafts (one polished, one UGC) for `orgId` so the
 * Mira review feed has something to show locally. Idempotent on fixed ids.
 * Reuses an existing AgentDeployment for the org (creating deployments/listings
 * is out of scope — if none exists, logs and skips: dev convenience only).
 */
export async function seedMiraDemoCreatives(prisma: PrismaClient, orgId: string): Promise<void> {
  const deployment = await prisma.agentDeployment.findFirst({ where: { organizationId: orgId } });
  if (!deployment) {
    console.warn(`seedMiraDemoCreatives: no deployment for ${orgId} — skipping demo creatives.`);
    return;
  }

  const drafts = [
    {
      id: "dev_mira_demo_polished",
      taskId: "dev_mira_demo_task_polished",
      mode: "polished",
      currentStage: "complete",
      stageOutputs: {
        production: { assembledVideos: [{ videoUrl: SAMPLE_POLISHED, duration: 15 }] },
      },
      ugcPhase: null as string | null,
      ugcPhaseOutputs: null as unknown,
      productDescription: "Spring glow facial — limited promo",
    },
    {
      id: "dev_mira_demo_ugc",
      taskId: "dev_mira_demo_task_ugc",
      mode: "ugc",
      currentStage: "trends",
      stageOutputs: {},
      ugcPhase: "complete",
      ugcPhaseOutputs: { production: { assets: [{ outputs: { videoUrl: SAMPLE_UGC } }] } },
      productDescription: "UGC testimonial — first-visit offer",
    },
  ];

  for (const d of drafts) {
    await prisma.agentTask.upsert({
      where: { id: d.taskId },
      update: {},
      create: {
        id: d.taskId,
        deploymentId: deployment.id,
        organizationId: orgId,
        listingId: deployment.listingId,
        category: "creative",
        status: "awaiting_review",
        input: {},
      },
    });
    await prisma.creativeJob.upsert({
      where: { id: d.id },
      update: {
        currentStage: d.currentStage,
        stageOutputs: d.stageOutputs,
        ugcPhase: d.ugcPhase,
        ugcPhaseOutputs: d.ugcPhaseOutputs as object,
      },
      create: {
        id: d.id,
        taskId: d.taskId,
        organizationId: orgId,
        deploymentId: deployment.id,
        productDescription: d.productDescription,
        targetAudience: "local prospects",
        platforms: ["meta"],
        mode: d.mode,
        currentStage: d.currentStage,
        stageOutputs: d.stageOutputs,
        ugcPhase: d.ugcPhase,
        ugcPhaseOutputs: d.ugcPhaseOutputs as object,
      },
    });
  }
  console.warn(`seedMiraDemoCreatives: seeded 2 demo drafts for ${orgId}`);
}
```

- [ ] **Step 2: Write the smoke test** (mocked Prisma — CI has no Postgres)

```ts
import { describe, expect, it, vi } from "vitest";
import { seedMiraDemoCreatives } from "../seed-mira-demo-creatives.js";

describe("seedMiraDemoCreatives", () => {
  it("skips when the org has no deployment", async () => {
    const taskUpsert = vi.fn();
    const prisma = {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue(null) },
      agentTask: { upsert: taskUpsert },
      creativeJob: { upsert: vi.fn() },
    } as unknown as import("@prisma/client").PrismaClient;
    await seedMiraDemoCreatives(prisma, "org_dev");
    expect(taskUpsert).not.toHaveBeenCalled();
  });

  it("seeds a polished + a UGC draft against the org's deployment", async () => {
    const creativeUpsert = vi.fn();
    const prisma = {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue({ id: "dep1", listingId: "lst1" }) },
      agentTask: { upsert: vi.fn() },
      creativeJob: { upsert: creativeUpsert },
    } as unknown as import("@prisma/client").PrismaClient;
    await seedMiraDemoCreatives(prisma, "org_dev");
    expect(creativeUpsert).toHaveBeenCalledTimes(2);
    const modes = creativeUpsert.mock.calls.map((c) => c[0].create.mode).sort();
    expect(modes).toEqual(["polished", "ugc"]);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @switchboard/db test -- seed-mira-demo-creatives`
Expected: PASS.

- [ ] **Step 4: Wire into the dev seed**

In `packages/db/prisma/seed.ts`, after the `seedMiraPilotOrgs(prisma, ["org_dev"])` call and AFTER `seedDemoData(prisma)` (so a deployment exists), add:

```ts
import { seedMiraDemoCreatives } from "../src/seed/seed-mira-demo-creatives.js";
// ... near the end of main(), after seedDevData(prisma):
await seedMiraDemoCreatives(prisma, "org_dev");
console.warn("Seeded Mira demo creatives for org_dev");
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed/seed-mira-demo-creatives.ts packages/db/src/seed/__tests__/seed-mira-demo-creatives.test.ts packages/db/prisma/seed.ts
git commit -m "feat(mira): dev-only demo creative drafts for the feed"
```

### Task 5.2: Deployed-pilot enablement runbook

**Files:**

- Create: `docs/runbooks/2026-05-29-mira-pilot-enablement.md`

- [ ] **Step 1: Write the runbook** (no automatic production write)

````markdown
# Runbook — Enable Mira for a deployed pilot org

Mira is opt-in per org. To make the feed visible for a chosen pilot org in a
deployed environment, insert an `OrgAgentEnablement{agentKey:"mira", status:"enabled"}`
row for that org. **A human runs this against prod — never automated.**

1. Confirm the pilot `organizationId` with the owner.
2. Run `seedMiraPilotOrgs(prisma, ["<pilotOrgId>"])` against the deployed DB
   (one-shot script using the deployed `DATABASE_URL`), or equivalently upsert
   the row directly:

   ```sql
   INSERT INTO "OrgAgentEnablement" ("orgId","agentKey","status")
   VALUES ('<pilotOrgId>','mira','enabled')
   ON CONFLICT ("orgId","agentKey") DO UPDATE SET "status"='enabled';
   ```

3. Verify `/mira` renders the feed for that org (and still 404s for others).
4. (Optional) seed real demo drafts only in non-prod; production shows the org's
   real creative jobs.
````

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-05-29-mira-pilot-enablement.md
git commit -m "docs(mira): deployed pilot enablement runbook"
```

### Task 5.3: Manual live-render acceptance pass

- [ ] **Step 1: Run the stack against `org_dev`**

```bash
pnpm db:seed                       # enables Mira + seeds demo drafts for org_dev
pnpm --filter @switchboard/api dev # :3000
pnpm --filter @switchboard/dashboard dev # :3002
```

- [ ] **Step 2: Verify the spec §12 acceptance criteria** (manually, the one thing tests can't cover):
  - `/mira` shows the vertical feed; both polished + UGC sample clips play.
  - Tap a clip's title → detail renders the **same** clip (UGC parity).
  - Continue opens the cost-confirm (never fires without confirm); copy states real provider cost.
  - Stop opens the irreversible-confirm; copy states it can't be undone.
  - Scroll never triggers a mutation.
  - Toggle global halt → Continue disabled ("Halted"), Stop + browsing still work.
  - Home Team Pulse Mira chip shows "set up"; tapping it / the panel opens `/mira`.
  - No publish/launch/use/approve-creative copy anywhere; no composer.

- [ ] **Step 3: Record the result** in the PR description (screenshots optional).

---

## Self-review (against the spec)

**Spec coverage:**

- §3 (A) feed endpoint → PR1. (B) feed UI → PR3A/3B. (C) UGC detail parity → PR2. (D) entry-point coherence → PR4. (E) demo + acceptance → PR5. ✓
- §4.3 microcopy (Continue/Stop locked copy, forbidden words) → detail page (PR2) + rail (PR3B). ✓
- §4.4 filter-before-limit + reviewable/rendering → PR1 route + test. ✓
- §4.6 halt (Continue disabled "Halted", Stop enabled, browsable) → PR3B + test. ✓
- §4.3 mutation refresh (dismiss + advance + invalidate) → PR3B Task 3B.2. ✓
- §5.2 response shape `{jobs,counts,feed}` → PR1. §5.4 seam-backed detail → PR2. §5.5 enablement signal + chip + panel → PR4. ✓
- §11 locked decisions: hosted URLs (PR5), retire list (PR3A.4), centered column (note below), header density (PR3A.4 header).
- §12 acceptance → PR5 Task 5.3.

**Gaps flagged for the implementer:**

- **Centered desktop column (§11 Q3):** the feed uses full height; add a `max-width` wrapper (~430px) centered on wide viewports in `mira-creative-feed.tsx` or `mira-feed-page.tsx`. Add a step if the reviewer wants it enforced via test.
- **`Identity` `subtitle` for the count line:** verify the prop renders; fallback noted inline (Task 3A.4 Step 1).
- **Feed test vs real rail (Task 3B.2 Step 3):** keep the dismissal assertion in the rail unit test; the feed test mocks `useMiraFeed` only.

**Type consistency:** `MiraCreativeJobSummary` / `MiraCreativeCounts` / `MiraReviewAction` are imported from `@switchboard/core` everywhere (route, hooks, components). `useApproveStage` mutation shape `{jobId, action:"continue"|"stop", productionTier?}` matches `use-creative-pipeline.ts`. `miraFeed.list()/detail(id)` keys are consistent across `use-mira-feed`/`use-mira-creative`.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-29-mira-creative-review-feed.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, two-stage review (spec + code-quality) between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batch execution with checkpoints.

Which approach?
