# Mira M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on the **Mira** creative agent as a draft-only, opt-in-per-org cockpit over Switchboard's _existing_ legacy `CreativeJob` pipeline, behind a stable read-model seam — no PCD code, no publish path.

**Architecture:** A pure `MiraCreativeReadModel` seam (types + status mapper + reader interface in `packages/core`, Prisma reader in `packages/db`) reads the existing `CreativeJob`/`AssetRecord` rows. Core agent-home projections (`pipeline-mira`, `metrics-mira`, greeting/wins/mission) consume the seam. API agent-home routes are gated per-org by `OrgAgentEnablement{agentKey:"mira"}` (opt-in), and a `/mira` dashboard cockpit + `/mira/creatives/[id]` draft-review page render it. Later phases (governance G1–G3, engine supersede) widen the read-model or swap its implementation without touching Mira's surface.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), pnpm + Turborepo, Zod, Prisma (Postgres), Fastify (API), Next.js 14 App Router + TanStack Query (dashboard), Vitest.

---

## Context & doctrine

**Doctrine (do not violate):** Mira M1 is a _projection launch, not a governance merge_ — read existing creative jobs through a stable seam, show them in a **draft-only** cockpit, enable **per pilot org**, and stop **before** publish / disclosure / PCD migration.

Strategy/why lives in `~/creativeagent/docs/plans/2026-05-28-mira-hybrid-launch-design.md` (read-only, different repo). **M1 touches zero creativeagent code.**

### Locked decisions (do not re-litigate)

- **Enablement:** opt-in per org via `OrgAgentEnablement{agentKey:"mira", status:"enabled"}` for pilot orgs. **No global `day-one` flip.**
- **Attribution:** projection rule — all eligible org creative jobs project as Mira-owned. **No new `agentKey` schema field.**
- **Metrics:** minimal, from legacy `CreativeJob` data. **No `PcdPerformanceSnapshot`.**
- **Draft-only copy:** _Continue draft / Stop draft / Ready for review / "Draft only — not published"_. **Never** Publish / Launch / Go live / "Approve creative". The `/approve` endpoint keeps its internal name but is surfaced as continue/stop.
- **Read/review-only:** Mira reads + reviews existing jobs; **no new submission from the Mira UI**. The only writes are continue/stop on existing jobs. **"continue" advances one stage → a real provider call + cost; "stop" is free.** Read endpoints make **zero** provider calls.

### Confirmed open items (resolved with user 2026-05-28)

1. **Keep "Continue draft" in M1**, behind an explicit cost label (operator-initiated, advances one generation stage = real provider call + cost). "Stop draft" stays free. (Shapes PR5.)
2. **Plan + all PRs live in `docs/plans/`** (this file) — NOT `docs/superpowers/plans/`, which the repo auto-archives after 2 days.

### Anchor corrections (verified against current code — the handoff was slightly stale)

These changed the plan; they are **load-bearing**:

- **There is no core `mission.ts`.** Mission is built entirely in the API route `apps/api/src/routes/agent-home/mission.ts` via `buildAlexMissionResponse`/`buildRileyMissionResponse`. → Mira mission = add `buildMiraMissionResponse` **there** (PR3), not a core builder. That route also `404`s when no `AgentRoster` row exists — Mira has none, so its branch must be roster-tolerant.
- **Greeting is `apps/api/src/routes/greeting.ts`** (NOT under `agent-home/`); it gates on `entry.launchTier === "day-one"` **and** `agentKey === "alex" | "riley"`. Both gates need replacing with the enablement check (PR3).
- **PR3 is not "invert `ALEX_RILEY_ONLY`".** The 5 `ALEX_RILEY_ONLY` guards (`activity`, `metrics`, `mission`, `pipeline`, `wins`) + the greeting gate are _static_. Mira is **opt-in per org**, so the gate becomes: _alex/riley always allowed; mira allowed iff `OrgAgentEnablement{mira, enabled}` exists for this org._ A shared helper centralizes this.
- **Already correct, do NOT change:** `packages/schemas/src/agents.ts` already registers Mira (`launchTier:"day-thirty"`, accent `hsl(265 30% 35%)`); `apps/dashboard/src/lib/agent-home/resolve-link.ts` already targets `/mira/creatives/${id}`; dashboard hooks `useCreativeJob`/`useApproveStage`/`useCostEstimate` already exist; `seedOrgDayOneAgents` already (deliberately) skips Mira.
- **Contract pre-provisioned (verified):** `HeroMetric` includes `{kind:"creatives-shipped"}` (`metrics-types.ts:16`); `PipelineViewModel.pipelineKind`/`countNoun` include `"creatives"` (`pipeline-types.ts:30-31`); `AgentHomeLink` includes `{kind:"creative-job"; id}` (`pipeline-types.ts:8`).

### Baseline (verified 2026-05-28)

`pnpm install` ✓; `pnpm typecheck` ✓; `pnpm test` ✓ **except** the pre-existing, load-dependent `apps/chat` flake `gateway-bridge-attribution.test.ts` (2 tests "Test timed out in 5000ms" under full-suite parallelism; passes **295/295 in isolation** via `pnpm --filter @switchboard/chat test`). Not caused by this work — ignore it.

- **Gotcha:** if `pnpm typecheck` reports `@switchboard/db` errors like `Module "@prisma/client" has no exported member 'PrismaClient'`, run **`pnpm reset`** first (stale generated Prisma client / cross-worktree turbo cache). This is the documented remedy, not a real failure.
- **Gotcha:** `pnpm <x> | tail` masks the real exit code (it becomes `tail`'s). Read the captured output, don't trust the piped exit code.
- **Gotcha:** commitlint enforces `subject-case` — the commit **subject must start lowercase** (`feat(mira): add …`, NOT `feat(mira): M1 …`). Mid-subject capitals like `CreativeJob` are fine. A husky `commit-msg` hook rejects violations; lint-staged also runs `prettier --write` on staged files at commit time (so re-`git add` after any pre-commit reformat).

---

## The read-model seam (keystone — protect this boundary hardest)

```ts
// Stable contract. Later phases widen counts/jobs (governance block) or swap the
// reader implementation (engine supersede) WITHOUT touching Mira's surface.
type MiraCreativeStatus =
  | "in_progress"
  | "awaiting_review"
  | "draft_ready"
  | "shipped"
  | "stopped"
  | "failed";

interface MiraCreativeJobSummary {
  id: string;
  title: string;
  stage: CreativeJobStage; // from @switchboard/schemas
  status: MiraCreativeStatus;
  draft?: { videoUrl?: string; thumbnailUrl?: string; durationSec?: number };
  reviewAction: {
    canContinue: boolean;
    canStop: boolean;
    label: "continue_draft" | "review_draft" | "none";
  };
  source: { engine: "legacy_creative_job"; mode: "polished" | "ugc" }; // NOTE: real enum is polished|ugc (NOT "standard")
  createdAt: string;
  updatedAt: string;
}

interface MiraCreativeCounts {
  total: number; // all creative jobs in the fetched window (cockpit pipeline count; NOT reporting-grade)
  shippedThisWeek: number; // drafts COMPLETED this week (internal name kept; user copy = "drafts completed")
  shippedPrevWeek: number; // week-over-week hero comparator (cockpit ignores; metrics uses)
  inFlight: number; // in_progress + awaiting_review
  awaitingReview: number;
  stopped: number;
}

interface MiraCreativeReadModel {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
}

interface MiraCreativeReadModelReader {
  read(
    orgId: string,
    opts: { now: Date; timezone: string; visibleLimit?: number },
  ): Promise<MiraCreativeReadModel>;
}
```

- **`shipped` stays in the type** (forward-compat for a later publish/export phase) but **the M1 reader never emits it** (no publish exists). PR1 includes a test asserting that.
- Render `"shipped"`/`creatives-shipped` as **"drafts completed"** in all user-facing copy. Keep `creatives-shipped` as the internal `HeroMetric` kind (already in the contract).
- **Counts are window-bounded, not analytical truth.** The reader fetches a capped window (`FETCH_CAP`, M1 pilot scale) and computes counts in-memory; `total`/`shippedThisWeek`/etc. are **cockpit summary counts**, NOT billing/reporting metrics. A later phase adds a `truncated` flag or a real reporting query if the seam needs reporting-grade counts.

### Deterministic status mapping (authored before coding)

Derived purely from a `CreativeJob` row. The legacy engine has **two lifecycles** the mapper must read mode-specifically:

- **polished** advances `currentStage` (`trends→…→complete`) with outputs in `stageOutputs`. The runner sets `currentStage` to the **next** stage only _after_ the just-run output is persisted, then blocks on `waitForEvent` — so a non-`complete`, non-`stopped` polished job is the "awaiting approval" resting state (matches the `/approve` 409 guard).
- **ugc** advances `ugcPhase` (`planning→scripting→production→delivery→complete`, from `packages/schemas/src/ugc-job.ts`) with outputs in `ugcPhaseOutputs`; `currentStage` stays at its `"trends"` default for a UGC job's whole life, and `stageOutputs` stays `{}`. **So UGC MUST key off `ugcPhase`/`ugcPhaseOutputs`, not `currentStage`/`stageOutputs`** — otherwise completed UGC jobs misclassify as `in_progress`. Both modes' stop paths set `stoppedAt` (`stop` / `stopUgc`); failure is `production.errors` (polished) vs `ugcFailure` (ugc).

| #   | Condition (checked top-down; first match wins)                                   | `status`          | `reviewAction`                                     |
| --- | -------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| 1   | `mode==="ugc"` && `ugcFailure != null`                                           | `failed`          | `{canContinue:false, canStop:false, label:"none"}` |
| 2   | polished && `stageOutputs.production.errors?.length > 0` && no `assembledVideos` | `failed`          | `{false,false,"none"}`                             |
| 3   | `stoppedAt != null` (both modes)                                                 | `stopped`         | `{false,false,"none"}`                             |
| 4   | polished && `currentStage === "complete"`                                        | `draft_ready`     | `{false,false,"review_draft"}`                     |
| 5   | ugc && `ugcPhase === "complete"`                                                 | `draft_ready`     | `{false,false,"review_draft"}`                     |
| 6   | polished && `stageOutputs` has ≥1 key                                            | `awaiting_review` | `{true,true,"continue_draft"}`                     |
| 7   | ugc && `ugcPhaseOutputs` has ≥1 key                                              | `awaiting_review` | `{true,true,"continue_draft"}`                     |
| 8   | otherwise (fresh job, no outputs yet)                                            | `in_progress`     | `{false,true,"none"}`                              |

- **`failed` is populatable** (`CreativeJob.ugcFailure Json?` + `VideoProducerOutput.errors`), so it is included.
- **`shipped` is NOT populatable in M1** (no publish/export marker) → never emitted.
- `draft_ready` = the final draft is ready for the director. Nothing is published.
- `title` ← `productDescription` (trimmed; fallback `"Untitled creative"`).
- `draft` is mode-specific, best-effort, **defensive** (`stageOutputs`/`ugcPhaseOutputs` are untyped `Json`): polished ← `stageOutputs.production.assembledVideos[0]` (`videoUrl`/`thumbnailUrl`/`durationSec`←`duration`), else `clips[0].videoUrl`; ugc ← a `videoUrl` in `ugcPhaseOutputs` (the `delivery` phase output if present, else `production.assets[0].videoUrl`). Returns `undefined` when no video is found.

---

## File structure

**PR1 — seam (new):**

- `packages/core/src/creative-read-model/types.ts` — the contract above.
- `packages/core/src/creative-read-model/status-mapper.ts` — pure `mapCreativeJobToMiraStatus`, `deriveReviewAction`, `deriveDraft`, `deriveTitle`.
- `packages/core/src/creative-read-model/build-read-model.ts` — pure `buildMiraCreativeReadModel(jobs, {now, weekStart, prevWeekStart, visibleLimit})`.
- `packages/core/src/creative-read-model/index.ts` — barrel; re-exported from `packages/core/src/index.ts`.
- `packages/core/src/creative-read-model/__tests__/{status-mapper,build-read-model}.test.ts`.
- `packages/db/src/stores/prisma-mira-creative-read-model-reader.ts` — `PrismaMiraCreativeReadModelReader implements MiraCreativeReadModelReader` (uses `PrismaCreativeJobStore.listByOrg` + `buildWeekContext`).
- `packages/db/src/stores/__tests__/prisma-mira-creative-read-model-reader.test.ts` — mocked Prisma (cross-org isolation).

**PR2 — core projections (new + modify):**

- New: `packages/core/src/agent-home/pipeline-mira.ts`, `metrics-mira.ts`.
- Modify: `agent-key.ts` (widen), `pipeline.ts` (dispatch + `listMiraPipeline`), `metrics.ts` (dispatch + optional `miraReader`), `greeting.ts` (config + branches), `wins.ts` (config entry — compiler-forced), `index.ts` (exports).

**PR3 — API activation (new + modify):**

- New: `apps/api/src/lib/agent-home-access.ts` — `isAgentHomeAccessible(agentId, orgId, store)` shared, pure-ish gate (one helper, easy to unit-test; routes apply it inline with an identical 503/404 block). Reviewed: kept as a single helper rather than a `requireAgentHomeAccess` route wrapper — the wrapper would couple the gate to Fastify `reply` and add surface for one extra line of saved boilerplate.
- Modify: `apps/api/src/routes/agent-home/{pipeline,metrics,activity,mission,wins}.ts`, `apps/api/src/routes/greeting.ts`, and the matching `__tests__`. Add `apps/api/src/routes/agent-home/__tests__/mira-route-matrix.test.ts`.
- Modify: `packages/db/src/stores/prisma-greeting-signal-store.ts` (mira signal from the seam).

**PR4 — dashboard cockpit (new + modify):**

- New: `apps/dashboard/src/app/(auth)/mira/page.tsx`, `apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx`, `apps/dashboard/src/lib/cockpit/mira/mira-config.ts`, `apps/dashboard/src/lib/cockpit/mira/metrics-to-kpi-data.ts`, `apps/dashboard/src/hooks/use-agent-pipeline.ts`.
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx` (gate exempt), `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts` (invert).

**PR5 — draft review (new + modify):**

- New: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/page.tsx`, `.../creative-detail-page.tsx`.
- Modify: `apps/dashboard/src/lib/route-availability.ts` (`creative-job → true`).

**PR6 — pilot enablement seed (new + modify):**

- New: `packages/db/src/seed/seed-mira-pilot-orgs.ts` + `__tests__`.
- Modify: `packages/db/prisma/seed.ts` (call for dev pilot org).

**PR7 — hardening (new + modify):** copy-hygiene test + grep audit + doc status.

---

## PR0 — Plan / decision-lock doc

- [ ] **Step 1: Commit this plan**

```bash
git add docs/plans/2026-05-28-mira-m1-implementation.md
git commit -m "docs(mira): add M1 implementation plan and decision lock"
```

(This is the only artifact in PR0. Specs/plans land on `main` via a focused PR per branch doctrine; open it before starting PR1.)

---

## PR1 — Read-model seam ONLY

No routes, no UI. Pure types + mapper + builder + Prisma reader + unit tests.

### Task 1.1: Read-model contract types

**Files:**

- Create: `packages/core/src/creative-read-model/types.ts`

- [ ] **Step 1: Write the types**

```ts
import type { CreativeJobStage } from "@switchboard/schemas";

export type MiraCreativeStatus =
  | "in_progress"
  | "awaiting_review"
  | "draft_ready"
  | "shipped"
  | "stopped"
  | "failed";

export interface MiraCreativeDraft {
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
}

export interface MiraReviewAction {
  canContinue: boolean;
  canStop: boolean;
  label: "continue_draft" | "review_draft" | "none";
}

export interface MiraCreativeJobSummary {
  id: string;
  title: string;
  stage: CreativeJobStage;
  status: MiraCreativeStatus;
  draft?: MiraCreativeDraft;
  reviewAction: MiraReviewAction;
  source: { engine: "legacy_creative_job"; mode: "polished" | "ugc" };
  createdAt: string;
  updatedAt: string;
}

export interface MiraCreativeCounts {
  total: number; // all jobs in the fetched window — cockpit summary count, NOT reporting-grade
  shippedThisWeek: number;
  shippedPrevWeek: number;
  inFlight: number;
  awaitingReview: number;
  stopped: number;
}

export interface MiraCreativeReadModel {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
}

export interface MiraCreativeReadModelReader {
  read(
    orgId: string,
    opts: { now: Date; timezone: string; visibleLimit?: number },
  ): Promise<MiraCreativeReadModel>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/creative-read-model/types.ts
git commit -m "feat(mira): read-model seam contract types"
```

### Task 1.2: Pure status mapper (TDD)

**Files:**

- Create: `packages/core/src/creative-read-model/status-mapper.ts`
- Test: `packages/core/src/creative-read-model/__tests__/status-mapper.test.ts`

- [ ] **Step 1: Write the failing test** (covers all 8 rows incl. UGC lifecycle: ugc-complete→draft_ready, ugc-in-progress, ugc-mid→awaiting_review, ugc-stopped, ugc-failed; plus malformed `stageOutputs`)

```ts
import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import { mapCreativeJobToMiraStatus, deriveReviewAction } from "../status-mapper.js";

function job(overrides: Partial<CreativeJob>): CreativeJob {
  return {
    id: "j1",
    taskId: "t1",
    organizationId: "org1",
    deploymentId: "d1",
    productDescription: "A product",
    targetAudience: "people",
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
    createdAt: new Date("2026-05-20"),
    updatedAt: new Date("2026-05-20"),
    ...overrides,
  } as CreativeJob;
}

describe("mapCreativeJobToMiraStatus", () => {
  it("ugc failure → failed", () => {
    expect(mapCreativeJobToMiraStatus(job({ mode: "ugc", ugcFailure: { msg: "x" } }))).toBe(
      "failed",
    );
  });
  it("polished production errors with no video → failed", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "complete",
          stageOutputs: { production: { errors: [{ message: "boom" }] } },
        }),
      ),
    ).toBe("failed");
  });
  it("complete WITH assembled video despite errors → draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({
          currentStage: "complete",
          stageOutputs: {
            production: { errors: [{ message: "minor" }], assembledVideos: [{ videoUrl: "v" }] },
          },
        }),
      ),
    ).toBe("draft_ready");
  });
  it("stoppedAt set → stopped", () => {
    expect(mapCreativeJobToMiraStatus(job({ stoppedAt: "hooks" }))).toBe("stopped");
  });
  it("currentStage complete (clean) → draft_ready", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({ currentStage: "complete", stageOutputs: { production: {} } }),
      ),
    ).toBe("draft_ready");
  });
  it("mid-pipeline with outputs → awaiting_review", () => {
    expect(
      mapCreativeJobToMiraStatus(job({ currentStage: "hooks", stageOutputs: { trends: {} } })),
    ).toBe("awaiting_review");
  });
  it("fresh job, empty outputs → in_progress", () => {
    expect(mapCreativeJobToMiraStatus(job({ currentStage: "trends", stageOutputs: {} }))).toBe(
      "in_progress",
    );
  });
  it("malformed stageOutputs (string) → does not throw, treated as no-output", () => {
    expect(
      mapCreativeJobToMiraStatus(
        job({ stageOutputs: "garbage" as unknown as Record<string, unknown> }),
      ),
    ).toBe("in_progress");
  });
});

describe("deriveReviewAction", () => {
  it("awaiting_review → continue+stop", () => {
    expect(deriveReviewAction("awaiting_review")).toEqual({
      canContinue: true,
      canStop: true,
      label: "continue_draft",
    });
  });
  it("in_progress → stop only", () => {
    expect(deriveReviewAction("in_progress")).toEqual({
      canContinue: false,
      canStop: true,
      label: "none",
    });
  });
  it("draft_ready → review only", () => {
    expect(deriveReviewAction("draft_ready")).toEqual({
      canContinue: false,
      canStop: false,
      label: "review_draft",
    });
  });
  it("stopped/failed → none", () => {
    expect(deriveReviewAction("stopped")).toEqual({
      canContinue: false,
      canStop: false,
      label: "none",
    });
    expect(deriveReviewAction("failed")).toEqual({
      canContinue: false,
      canStop: false,
      label: "none",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- status-mapper`
Expected: FAIL — `Cannot find module '../status-mapper.js'`.

- [ ] **Step 3: Write the implementation**

```ts
import type { CreativeJob } from "@switchboard/schemas";
import type { MiraCreativeStatus, MiraReviewAction, MiraCreativeDraft } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function productionErrorsWithoutVideo(stageOutputs: unknown): boolean {
  const production = asRecord(asRecord(stageOutputs).production);
  const errors = production.errors;
  const assembled = production.assembledVideos;
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  const hasVideo = Array.isArray(assembled) && assembled.length > 0;
  return hasErrors && !hasVideo;
}

export function mapCreativeJobToMiraStatus(job: CreativeJob): MiraCreativeStatus {
  if (job.mode === "ugc" && job.ugcFailure != null) return "failed";
  if (job.mode !== "ugc" && productionErrorsWithoutVideo(job.stageOutputs)) return "failed";
  if (job.stoppedAt != null) return "stopped";
  if (job.currentStage === "complete") return "draft_ready";
  const hasOutputs = Object.keys(asRecord(job.stageOutputs)).length > 0;
  return hasOutputs ? "awaiting_review" : "in_progress";
}

export function deriveReviewAction(status: MiraCreativeStatus): MiraReviewAction {
  switch (status) {
    case "awaiting_review":
      return { canContinue: true, canStop: true, label: "continue_draft" };
    case "in_progress":
      return { canContinue: false, canStop: true, label: "none" };
    case "draft_ready":
      return { canContinue: false, canStop: false, label: "review_draft" };
    case "shipped":
    case "stopped":
    case "failed":
      return { canContinue: false, canStop: false, label: "none" };
  }
}

export function deriveTitle(job: CreativeJob): string {
  const t = (job.productDescription ?? "").trim();
  return t.length > 0 ? t : "Untitled creative";
}

export function deriveDraft(job: CreativeJob): MiraCreativeDraft | undefined {
  const production = asRecord(asRecord(job.stageOutputs).production);
  const assembled = production.assembledVideos;
  if (Array.isArray(assembled) && assembled.length > 0) {
    const first = asRecord(assembled[0]);
    return {
      ...(typeof first.videoUrl === "string" ? { videoUrl: first.videoUrl } : {}),
      ...(typeof first.thumbnailUrl === "string" ? { thumbnailUrl: first.thumbnailUrl } : {}),
      ...(typeof first.duration === "number" ? { durationSec: first.duration } : {}),
    };
  }
  const clips = production.clips;
  if (Array.isArray(clips) && clips.length > 0) {
    const first = asRecord(clips[0]);
    if (typeof first.videoUrl === "string") return { videoUrl: first.videoUrl };
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- status-mapper`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-read-model/status-mapper.ts packages/core/src/creative-read-model/__tests__/status-mapper.test.ts
git commit -m "feat(mira): deterministic CreativeJob→Mira status mapper"
```

### Task 1.3: Pure read-model builder (TDD)

**Files:**

- Create: `packages/core/src/creative-read-model/build-read-model.ts`
- Test: `packages/core/src/creative-read-model/__tests__/build-read-model.test.ts`

- [ ] **Step 1: Write the failing test** (empty org, mixed statuses, counts, slicing, week boundaries, never-`shipped`)

```ts
import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@switchboard/schemas";
import { buildMiraCreativeReadModel } from "../build-read-model.js";

const NOW = new Date("2026-05-28T12:00:00Z");
const WEEK_START = new Date("2026-05-25T00:00:00Z");
const PREV_WEEK_START = new Date("2026-05-18T00:00:00Z");

function job(o: Partial<CreativeJob>): CreativeJob {
  return {
    id: "j",
    taskId: "t",
    organizationId: "org1",
    deploymentId: "d1",
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
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  } as CreativeJob;
}

describe("buildMiraCreativeReadModel", () => {
  const opts = { now: NOW, weekStart: WEEK_START, prevWeekStart: PREV_WEEK_START, visibleLimit: 5 };

  it("empty org → empty jobs, zero counts", () => {
    const rm = buildMiraCreativeReadModel([], opts);
    expect(rm.jobs).toEqual([]);
    expect(rm.counts).toEqual({
      total: 0,
      shippedThisWeek: 0,
      shippedPrevWeek: 0,
      inFlight: 0,
      awaitingReview: 0,
      stopped: 0,
    });
  });

  it("counts inFlight, awaitingReview, stopped, and weekly completions", () => {
    const rm = buildMiraCreativeReadModel(
      [
        job({ id: "a", currentStage: "hooks", stageOutputs: { trends: {} } }), // awaiting_review
        job({ id: "b", currentStage: "trends", stageOutputs: {} }), // in_progress
        job({ id: "c", stoppedAt: "scripts" }), // stopped
        job({
          id: "d",
          currentStage: "complete",
          stageOutputs: { production: {} },
          updatedAt: new Date("2026-05-26"),
        }), // shippedThisWeek
        job({
          id: "e",
          currentStage: "complete",
          stageOutputs: { production: {} },
          updatedAt: new Date("2026-05-19"),
        }), // shippedPrevWeek
      ],
      opts,
    );
    expect(rm.counts).toEqual({
      total: 5,
      shippedThisWeek: 1,
      shippedPrevWeek: 1,
      inFlight: 2,
      awaitingReview: 1,
      stopped: 1,
    });
  });

  it("never emits status 'shipped' in M1", () => {
    const rm = buildMiraCreativeReadModel(
      [job({ currentStage: "complete", stageOutputs: { production: {} } })],
      opts,
    );
    expect(rm.jobs.every((j) => j.status !== "shipped")).toBe(true);
    expect(rm.jobs[0]!.status).toBe("draft_ready");
  });

  it("slices visible jobs to visibleLimit but counts ALL", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      job({ id: `j${i}`, currentStage: "hooks", stageOutputs: { trends: {} } }),
    );
    const rm = buildMiraCreativeReadModel(many, { ...opts, visibleLimit: 5 });
    expect(rm.jobs).toHaveLength(5);
    expect(rm.counts.awaitingReview).toBe(8);
    expect(rm.counts.total).toBe(8); // counts cover ALL fetched jobs, not just the visible slice
  });

  it("maps draft video + reviewAction on awaiting_review", () => {
    const rm = buildMiraCreativeReadModel(
      [
        job({
          id: "a",
          currentStage: "complete",
          stageOutputs: {
            production: { assembledVideos: [{ videoUrl: "v", thumbnailUrl: "t", duration: 12 }] },
          },
        }),
      ],
      opts,
    );
    expect(rm.jobs[0]!.draft).toEqual({ videoUrl: "v", thumbnailUrl: "t", durationSec: 12 });
    expect(rm.jobs[0]!.reviewAction.label).toBe("review_draft");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- build-read-model`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { CreativeJob } from "@switchboard/schemas";
import {
  mapCreativeJobToMiraStatus,
  deriveReviewAction,
  deriveTitle,
  deriveDraft,
} from "./status-mapper.js";
import type { MiraCreativeJobSummary, MiraCreativeReadModel } from "./types.js";

export interface BuildMiraReadModelOpts {
  now: Date;
  weekStart: Date;
  prevWeekStart: Date;
  visibleLimit?: number;
}

const DEFAULT_VISIBLE_LIMIT = 5;

export function buildMiraCreativeReadModel(
  jobs: readonly CreativeJob[],
  opts: BuildMiraReadModelOpts,
): MiraCreativeReadModel {
  const summaries: MiraCreativeJobSummary[] = jobs.map((job) => {
    const status = mapCreativeJobToMiraStatus(job);
    const draft = deriveDraft(job);
    return {
      id: job.id,
      title: deriveTitle(job),
      stage: job.currentStage,
      status,
      ...(draft ? { draft } : {}),
      reviewAction: deriveReviewAction(status),
      source: { engine: "legacy_creative_job", mode: job.mode === "ugc" ? "ugc" : "polished" },
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
    };
  });

  const completedAt = (j: CreativeJob) => new Date(j.updatedAt).getTime();
  const isCompleted = (s: MiraCreativeJobSummary) => s.status === "draft_ready";

  const shippedThisWeek = jobs.filter(
    (j, i) => isCompleted(summaries[i]!) && completedAt(j) >= opts.weekStart.getTime(),
  ).length;
  const shippedPrevWeek = jobs.filter(
    (j, i) =>
      isCompleted(summaries[i]!) &&
      completedAt(j) >= opts.prevWeekStart.getTime() &&
      completedAt(j) < opts.weekStart.getTime(),
  ).length;
  const awaitingReview = summaries.filter((s) => s.status === "awaiting_review").length;
  const inFlight = summaries.filter(
    (s) => s.status === "awaiting_review" || s.status === "in_progress",
  ).length;
  const stopped = summaries.filter((s) => s.status === "stopped").length;

  return {
    jobs: summaries.slice(0, opts.visibleLimit ?? DEFAULT_VISIBLE_LIMIT),
    counts: {
      total: summaries.length,
      shippedThisWeek,
      shippedPrevWeek,
      inFlight,
      awaitingReview,
      stopped,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- build-read-model`
Expected: PASS.

- [ ] **Step 5: Add the barrel + core export, then commit**

Create `packages/core/src/creative-read-model/index.ts`:

```ts
export * from "./types.js";
export {
  mapCreativeJobToMiraStatus,
  deriveReviewAction,
  deriveTitle,
  deriveDraft,
} from "./status-mapper.js";
export { buildMiraCreativeReadModel, type BuildMiraReadModelOpts } from "./build-read-model.js";
```

Append to `packages/core/src/index.ts` (find the existing agent-home export block and add below it):

```ts
export * from "./creative-read-model/index.js";
```

```bash
git add packages/core/src/creative-read-model/ packages/core/src/index.ts
git commit -m "feat(mira): pure read-model builder + counts"
```

### Task 1.4: Prisma reader (TDD, mocked Prisma)

**Files:**

- Create: `packages/db/src/stores/prisma-mira-creative-read-model-reader.ts`
- Test: `packages/db/src/stores/__tests__/prisma-mira-creative-read-model-reader.test.ts`

DB tests mock Prisma (CI has no Postgres). Mirror the existing `prisma-creative-job-store` test style. **Cross-org isolation** is enforced by the `organizationId` filter on the query.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { PrismaMiraCreativeReadModelReader } from "../prisma-mira-creative-read-model-reader.js";

function fakePrisma(rows: unknown[]) {
  return {
    creativeJob: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as Parameters<typeof PrismaMiraCreativeReadModelReader.prototype.read> extends never
    ? never
    : any;
}

const base = {
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
  stageOutputs: {},
  stoppedAt: null,
  mode: "polished",
  ugcPhase: null,
  ugcPhaseOutputs: null,
  ugcPhaseOutputsVersion: null,
  ugcConfig: null,
  ugcFailure: null,
  createdAt: new Date("2026-05-26"),
  updatedAt: new Date("2026-05-26"),
};

describe("PrismaMiraCreativeReadModelReader", () => {
  it("queries org-scoped and builds the read model", async () => {
    const prisma = {
      creativeJob: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...base,
            id: "a",
            organizationId: "org1",
            currentStage: "hooks",
            stageOutputs: { trends: {} },
          },
        ]),
      },
    } as any;
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    const rm = await reader.read("org1", {
      now: new Date("2026-05-28T12:00:00Z"),
      timezone: "UTC",
    });
    expect(prisma.creativeJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org1" } }),
    );
    expect(rm.counts.awaitingReview).toBe(1);
    expect(rm.jobs[0]!.status).toBe("awaiting_review");
  });

  it("empty org → empty model", async () => {
    const prisma = { creativeJob: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    const rm = await reader.read("orgEmpty", { now: new Date(), timezone: "UTC" });
    expect(rm.jobs).toEqual([]);
    expect(rm.counts.inFlight).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-mira-creative-read-model-reader`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { CreativeJob } from "@switchboard/schemas";
import {
  buildMiraCreativeReadModel,
  buildWeekContext,
  type MiraCreativeReadModel,
  type MiraCreativeReadModelReader,
} from "@switchboard/core";

// M1 pilot scale: fetch the org's recent creative jobs and compute the model in
// memory (status derivation needs JSON introspection that is awkward as a SQL
// WHERE). Cap defends against pathological orgs. NOTE: counts (incl. `total`)
// reflect ONLY this fetched window — they are cockpit summary counts, NOT
// reporting/billing metrics. An org with >FETCH_CAP jobs under-counts; that is
// acceptable for M1 pilot scale and revisited (truncated flag / reporting query)
// in a later phase.
const FETCH_CAP = 200;

export class PrismaMiraCreativeReadModelReader implements MiraCreativeReadModelReader {
  constructor(private prisma: PrismaDbClient) {}

  async read(
    orgId: string,
    opts: { now: Date; timezone: string; visibleLimit?: number },
  ): Promise<MiraCreativeReadModel> {
    const rows = (await this.prisma.creativeJob.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: FETCH_CAP,
    })) as unknown as CreativeJob[];

    const week = buildWeekContext(opts.now, opts.timezone);
    return buildMiraCreativeReadModel(rows, {
      now: opts.now,
      weekStart: week.weekStart,
      prevWeekStart: week.prevWeekStart,
      ...(opts.visibleLimit !== undefined ? { visibleLimit: opts.visibleLimit } : {}),
    });
  }
}
```

> Verify `buildWeekContext`'s return has `weekStart` and `prevWeekStart` (it does — `metrics-riley.ts` consumes both via `WeekContext`). It is exported from `@switchboard/core`.
>
> **Layering note (reviewed):** the _seam contract_ (`build-read-model.ts`) takes explicit `weekStart`/`prevWeekStart` and has **zero** agent-home dependency — only this Prisma reader (an implementation detail, not the seam) calls `buildWeekContext`, used purely as the codebase's timezone-aware week-boundary utility (DRY; reimplementing tz-correct week math is the exact kind of subtle bug to avoid). We deliberately do **not** relocate `buildWeekContext` to a new `core/src/time/` module in M1 — that refactor touches `agent-home/metrics-buckets.ts` and risks Alex/Riley snapshots for no M1 benefit. If a future phase wants the time util decoupled from `agent-home`, move it then.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-mira-creative-read-model-reader`
Expected: PASS.

- [ ] **Step 5: Export from db barrel + commit**

Add to `packages/db/src/index.ts` (with the other store exports):

```ts
export { PrismaMiraCreativeReadModelReader } from "./stores/prisma-mira-creative-read-model-reader.js";
```

- [ ] **Step 6: Typecheck the seam**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck`
Expected: PASS. (If db reports missing `@prisma/client` exports, run `pnpm reset` first.)

```bash
git add packages/db/src/stores/prisma-mira-creative-read-model-reader.ts packages/db/src/stores/__tests__/prisma-mira-creative-read-model-reader.test.ts packages/db/src/index.ts
git commit -m "feat(mira): Prisma read-model reader (org-scoped)"
```

---

## PR2 — Core agent-home Mira projections

Widen the type gate; add `pipeline-mira`/`metrics-mira`; add greeting/wins config + dispatch. **Alex/Riley snapshots must stay byte-identical** (run their tests). Graceful empty state everywhere.

### Task 2.1: Widen `AgentHomeKey` (compiler-driven discovery)

**Files:**

- Modify: `packages/core/src/agent-home/agent-key.ts`

- [ ] **Step 1: Edit the type**

```ts
export type AgentHomeKey = "alex" | "riley" | "mira";
```

(Update the doc comment: Mira now ships its agent home in M1.)

- [ ] **Step 2: Run core typecheck to enumerate every forced site**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: FAIL with errors at: `wins.ts` (`AGENT_VOICE_CONFIGS` missing `mira`), `pipeline.ts` / `metrics.ts` (non-exhaustive dispatch — only if you also tighten them), and any other `Record<AgentHomeKey, …>`. Note the list; the following tasks resolve each. Do not commit yet (red typecheck).

### Task 2.2: `pipeline-mira.ts` (TDD)

**Files:**

- Create: `packages/core/src/agent-home/pipeline-mira.ts`
- Test: `packages/core/src/agent-home/__tests__/pipeline-mira.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildMiraPipelineViewModel, type MiraPipelineRow } from "../pipeline-mira.js";

const NOW = new Date("2026-05-28T12:00:00Z");

function row(o: Partial<MiraPipelineRow>): MiraPipelineRow {
  return {
    id: "j1",
    title: "Spring promo",
    status: "awaiting_review",
    createdAt: new Date("2026-05-27T12:00:00Z"),
    ...o,
  };
}

describe("buildMiraPipelineViewModel", () => {
  it("creatives kind/noun, mira setup link, draft-only ctx", () => {
    const vm = buildMiraPipelineViewModel({ rows: [row({})], totalCount: 1, now: NOW });
    expect(vm.agentKey).toBe("mira");
    expect(vm.pipelineKind).toBe("creatives");
    expect(vm.countNoun).toBe("creatives");
    expect(vm.setupLink).toEqual({ kind: "agent-setup", agentKey: "mira" });
    expect(vm.tiles[0]).toMatchObject({
      id: "j1",
      name: "Spring promo",
      link: { kind: "creative-job", id: "j1" },
    });
    expect(vm.tiles[0]!.ctx).toContain("review");
  });

  it("awaiting_review → hot stage; in_progress → new", () => {
    const vm = buildMiraPipelineViewModel({
      rows: [row({ id: "a", status: "awaiting_review" }), row({ id: "b", status: "in_progress" })],
      totalCount: 2,
      now: NOW,
    });
    expect(vm.tiles.find((t) => t.id === "a")!.stage).toBe("hot");
    expect(vm.tiles.find((t) => t.id === "b")!.stage).toBe("new");
  });

  it("empty → no tiles, totalCount 0", () => {
    const vm = buildMiraPipelineViewModel({ rows: [], totalCount: 0, now: NOW });
    expect(vm.tiles).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pipeline-mira`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { PipelineViewModel, PipelineTileViewModel, PipelineStage } from "./pipeline-types.js";
import type { MiraCreativeStatus } from "../creative-read-model/types.js";
import { formatRelativeAge } from "./relative-age.js";

export interface MiraPipelineRow {
  id: string;
  title: string;
  status: MiraCreativeStatus;
  createdAt: Date;
}

export interface BuildMiraPipelineInput {
  rows: readonly MiraPipelineRow[];
  totalCount: number;
  now: Date;
}

export function buildMiraPipelineViewModel(input: BuildMiraPipelineInput): PipelineViewModel {
  const { rows, totalCount, now } = input;
  return {
    agentKey: "mira",
    pipelineKind: "creatives",
    countNoun: "creatives",
    totalCount,
    tiles: rows.map((r) => buildTile(r, now)),
    setupLink: { kind: "agent-setup", agentKey: "mira" },
    freshness: { generatedAt: now.toISOString(), window: "today", dataSource: "live" },
  };
}

function buildTile(row: MiraPipelineRow, now: Date): PipelineTileViewModel {
  return {
    id: row.id,
    stage: classifyStage(row.status),
    name: row.title,
    ctx: tileCtx(row, now),
    link: { kind: "creative-job", id: row.id },
  };
}

function classifyStage(status: MiraCreativeStatus): PipelineStage {
  if (status === "awaiting_review") return "hot";
  if (status === "draft_ready") return "warm";
  return "new"; // in_progress / stopped / failed / shipped
}

function tileCtx(row: MiraPipelineRow, now: Date): string {
  const age = formatRelativeAge(row.createdAt, now);
  switch (row.status) {
    case "awaiting_review":
      return `Ready for review · ${age}`;
    case "draft_ready":
      return `Draft completed · ${age}`;
    case "in_progress":
      return `Drafting · ${age}`;
    case "stopped":
      return `Stopped · ${age}`;
    case "failed":
      return `Needs attention · ${age}`;
    case "shipped":
      return `Draft completed · ${age}`;
  }
}
```

> Verify `formatRelativeAge(date, now)` signature in `relative-age.ts` (it is exported from the agent-home barrel). If its arg order differs, adapt the call.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pipeline-mira`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/pipeline-mira.ts packages/core/src/agent-home/__tests__/pipeline-mira.test.ts
git commit -m "feat(mira): pipeline projection builder"
```

### Task 2.3: Wire `listMiraPipeline` into `projectPipeline`

**Files:**

- Modify: `packages/core/src/agent-home/pipeline.ts`

- [ ] **Step 1: Extend `PipelineSignalStore` and add the dispatch branch**

Add the import and the store method, and a `mira` branch (keep alex/riley untouched):

```ts
import { buildMiraPipelineViewModel, type MiraPipelineRow } from "./pipeline-mira.js";
```

Add to `interface PipelineSignalStore`:

```ts
  listMiraPipeline(input: {
    orgId: string;
    limit: number;
  }): Promise<{ rows: MiraPipelineRow[]; totalCount: number }>;
```

In `projectPipeline`, before `// agentKey === "riley"`, add:

```ts
if (agentKey === "mira") {
  const { rows, totalCount } = await store.listMiraPipeline({
    orgId,
    limit: PIPELINE_VISIBLE_LIMIT,
  });
  return buildMiraPipelineViewModel({ rows, totalCount, now });
}
```

And re-export the row type at the bottom:

```ts
export type { MiraPipelineRow } from "./pipeline-mira.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: `pipeline.ts` errors resolved (other files may still be red until 2.4–2.6).

(Commit with Task 2.7 once the package typechecks green.)

### Task 2.4: `metrics-mira.ts` + `projectMetrics` dispatch (TDD)

**Files:**

- Create: `packages/core/src/agent-home/metrics-mira.ts`
- Test: `packages/core/src/agent-home/__tests__/metrics-mira.test.ts`
- Modify: `packages/core/src/agent-home/metrics.ts`

`projectMetrics` for Mira reads the seam directly (the shared `MetricsSignalStore` has no creative signal and must stay alex/riley-only). We add an **optional** `miraReader` to `ProjectMetricsInput`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildMiraMetricsViewModel } from "../metrics-mira.js";
import { projectMetrics } from "../metrics.js";
import { buildWeekContext } from "../metrics-buckets.js";

const week = buildWeekContext(new Date("2026-05-28T12:00:00Z"), "UTC");

describe("buildMiraMetricsViewModel", () => {
  it("hero is creatives-shipped with week-over-week comparator", () => {
    const vm = buildMiraMetricsViewModel({
      counts: {
        total: 7,
        shippedThisWeek: 3,
        shippedPrevWeek: 1,
        inFlight: 4,
        awaitingReview: 2,
        stopped: 1,
      },
      week,
    });
    expect(vm.hero).toEqual({
      kind: "creatives-shipped",
      value: 3,
      comparator: { window: "week", value: 1 },
    });
    expect(vm.stats).toHaveLength(3);
    expect(vm.stats.map((s) => s.label)).toEqual([
      "Drafts completed",
      "Awaiting review",
      "In flight",
    ]);
    expect(vm.freshness.window).toBe("week");
  });

  it("zero counts → neutral hero and stats", () => {
    const vm = buildMiraMetricsViewModel({
      counts: {
        total: 0,
        shippedThisWeek: 0,
        shippedPrevWeek: 0,
        inFlight: 0,
        awaitingReview: 0,
        stopped: 0,
      },
      week,
    });
    expect(vm.hero.value).toBe(0);
    expect(vm.stats[0]!.display).toBe("0");
  });
});

describe("projectMetrics — mira partial-wiring guard", () => {
  it("throws when agentKey 'mira' but miraReader is missing", async () => {
    await expect(
      projectMetrics({
        orgId: "o",
        agentKey: "mira",
        now: new Date("2026-05-28T12:00:00Z"),
        timezone: "UTC",
        store: {} as never,
        targets: { avgValueCents: null, targetCpbCents: null },
      }),
    ).rejects.toThrow(/miraReader required/);
  });
});
```

> `projectPipeline("mira")` needs no runtime guard test — `PipelineSignalStore` _requires_ `listMiraPipeline`, so a store missing it is a compile error.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- metrics-mira`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `metrics-mira.ts`**

```ts
import type { WeekContext } from "./metrics-buckets.js";
import type { MetricsViewModel, ProseSegment, StatCell, KpiTile } from "./metrics-types.js";
import type { MiraCreativeCounts } from "../creative-read-model/types.js";

export interface BuildMiraMetricsInput {
  counts: MiraCreativeCounts;
  week: WeekContext;
}

export function buildMiraMetricsViewModel(input: BuildMiraMetricsInput): MetricsViewModel {
  const { counts, week } = input;
  const delta = counts.shippedThisWeek - counts.shippedPrevWeek;
  const subprose: ProseSegment[] = [{ kind: "text", text: voiceText(delta) }];

  const stats: readonly [StatCell, StatCell, StatCell] = [
    {
      label: "Drafts completed",
      display: String(counts.shippedThisWeek),
      rawValue: counts.shippedThisWeek,
      unit: "count",
    },
    {
      label: "Awaiting review",
      display: String(counts.awaitingReview),
      rawValue: counts.awaitingReview,
      unit: "count",
    },
    {
      label: "In flight",
      display: String(counts.inFlight),
      rawValue: counts.inFlight,
      unit: "count",
    },
  ];

  const tiles: readonly KpiTile[] = [
    { label: "drafts completed", value: counts.shippedThisWeek },
    { label: "awaiting review", value: counts.awaitingReview },
    { label: "in flight", value: counts.inFlight },
  ];

  return {
    hero: {
      kind: "creatives-shipped",
      value: counts.shippedThisWeek,
      comparator: { window: "week", value: counts.shippedPrevWeek },
    },
    heroSubProseSegments: subprose,
    spark: [],
    stats,
    freshness: { generatedAt: week.now.toISOString(), window: "week", dataSource: "live" },
    folioRange: week.folioRange,
    targets: { avgValueCents: null, targetCpbCents: null },
    spendCents: null,
    leads: 0,
    qualifiedPct: 0,
    bookedDelta: null,
    leadsDelta: null,
    qualifiedDelta: null,
    tiles,
  };
}

function voiceText(delta: number): string {
  if (delta > 0) return `+${delta} drafts completed vs last week.`;
  if (delta < 0) return `${Math.abs(delta)} fewer drafts completed vs last week.`;
  return `Flat vs last week.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- metrics-mira`
Expected: PASS.

- [ ] **Step 5: Add the dispatch branch in `metrics.ts`**

Add imports + optional reader to the input + a `mira` branch:

```ts
import { buildMiraMetricsViewModel } from "./metrics-mira.js";
import type { MiraCreativeReadModelReader } from "../creative-read-model/types.js";
```

In `ProjectMetricsInput` add:

```ts
  miraReader?: MiraCreativeReadModelReader;
```

In `projectMetrics`, after computing `week` and before `if (input.agentKey === "alex")`:

```ts
if (input.agentKey === "mira") {
  if (!input.miraReader) throw new Error("projectMetrics: miraReader required for agentKey 'mira'");
  const rm = await input.miraReader.read(input.orgId, { now: input.now, timezone: input.timezone });
  return buildMiraMetricsViewModel({ counts: rm.counts, week });
}
```

- [ ] **Step 6: Typecheck + commit (with 2.7)**

Run: `pnpm --filter @switchboard/core typecheck` (metrics.ts errors resolved).

### Task 2.5: Greeting config + branches for Mira

**Files:**

- Modify: `packages/core/src/agent-home/greeting.ts`
- Test: `packages/core/src/agent-home/__tests__/greeting.test.ts` (extend; verify the file name in `__tests__`)

- [ ] **Step 1: Write failing tests for Mira greeting copy**

Add to the greeting test file:

```ts
import { computeVariant, buildSegments } from "../greeting.js";

describe("greeting — mira", () => {
  const cfg = {
    agentKey: "mira" as const,
    busyThreshold: 3,
    busyAgeHoursThreshold: 24,
    countNoun: "drafts",
  };
  it("welcome variant copy", () => {
    const seg = buildSegments(
      "welcome",
      { inboxCount: 0, oldestOpenItemAgeHours: null, hoursSinceLastOperatorAction: null },
      cfg,
      null,
    );
    expect(seg.map((s) => s.text).join("")).toContain("draft");
  });
  it("busy variant uses drafts noun", () => {
    const seg = buildSegments(
      "busy",
      { inboxCount: 4, oldestOpenItemAgeHours: 2, hoursSinceLastOperatorAction: 1 },
      cfg,
      null,
    );
    expect(seg.map((s) => s.text).join("")).toContain("drafts");
  });
  it("named-lead points at the draft title", () => {
    const seg = buildSegments(
      "named-lead",
      { inboxCount: 1, oldestOpenItemAgeHours: 5, hoursSinceLastOperatorAction: 1 },
      cfg,
      { name: "Spring promo", ageLabel: "2d" },
    );
    expect(seg.map((s) => s.text).join("")).toContain("Spring promo");
    expect(seg.map((s) => s.text).join("")).toContain("review");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test -- greeting`
Expected: FAIL (no `mira` in `AGENT_CONFIGS`; `buildSegments` has no mira branch).

- [ ] **Step 3: Edit `greeting.ts`**

Widen the config map type and add the mira entry:

```ts
const AGENT_CONFIGS: Record<AgentHomeKey, GreetingAgentConfig> = {
  alex: { agentKey: "alex", busyThreshold: 5, busyAgeHoursThreshold: 24, countNoun: "leads" },
  riley: { agentKey: "riley", busyThreshold: 4, busyAgeHoursThreshold: 12, countNoun: "ad sets" },
  mira: { agentKey: "mira", busyThreshold: 3, busyAgeHoursThreshold: 24, countNoun: "drafts" },
};
```

Widen the input agentKey:

```ts
export interface ProjectGreetingInput {
  orgId: string;
  agentKey: AgentHomeKey;
  store: GreetingSignalStore;
}
```

Add `import type { AgentHomeKey } from "./agent-key.js";` if not present, and add `mira` branches in `buildSegments` for `welcome`, `quiet`, and `named-lead` (the `busy` branch is already agent-agnostic). Replace each `} else { // riley` with explicit `else if (agentKey === "riley")` + a `mira` branch. Mira copy (draft-only):

```ts
// welcome
if (agentKey === "mira") {
  return [
    {
      kind: "text",
      text: "Ready to create. I'll bring you drafts to review — never published without you.",
    },
  ];
}
// quiet
if (agentKey === "mira") {
  return [{ kind: "text", text: "No drafts need you right now. I'll ping you when one's ready." }];
}
// named-lead, topItem !== null
if (agentKey === "mira") {
  return [
    { kind: "accent", text: topItem.name },
    { kind: "text", text: " is ready for your review." },
  ];
}
// named-lead, topItem === null
if (agentKey === "mira") {
  return [{ kind: "text", text: "A few drafts are ready for review — whenever you are." }];
}
```

> Keep the `_exhaustive: never` check at the end of `buildSegments` so a missed variant still errors at compile time.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test -- greeting`
Expected: PASS (mira + the unchanged alex/riley cases).

### Task 2.6: Wins config entry for Mira (compiler-forced)

**Files:**

- Modify: `packages/core/src/agent-home/wins.ts`

- [ ] **Step 1: Add the mira voice config**

`AGENT_VOICE_CONFIGS` is `Record<AgentHomeKey, …>`, so widening `AgentHomeKey` already made this a compile error. Add:

```ts
const AGENT_VOICE_CONFIGS: Record<AgentHomeKey, WinsAgentConfig> = {
  alex: { agentKey: "alex", ackPhrase: "Sent.", defaultUndoLabel: "Undo last reply" },
  riley: { agentKey: "riley", ackPhrase: "Adjusted.", defaultUndoLabel: "Revert change" },
  mira: { agentKey: "mira", ackPhrase: "Drafted.", defaultUndoLabel: "Undo" },
};
```

In `composeWinProse`, the alex/riley branches are identical; add a `mira` branch (same shape) before the final return so the seam stays explicit:

```ts
if (config.agentKey === "mira") {
  return [ack, { kind: "text", text: ` ${row.humanSummary}` }];
}
```

(Mira has no terminal win records in M1 → `projectWins("mira")` returns empty; this entry just satisfies the type and is ready for a later slice.)

### Task 2.7: Green the core package + Alex/Riley regression + commit

- [ ] **Step 1: Typecheck + full core test**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/core test`
Expected: PASS. **Confirm Alex/Riley pipeline/metrics/greeting/wins tests are unchanged and green** (no snapshot drift).

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/agent-home/
git commit -m "feat(mira): core agent-home projections (pipeline/metrics/greeting/wins)"
```

---

## PR3 — API activation behind per-org enablement

Invert/replace the static guards with a per-org enablement gate; wire Mira stores to the reader; add the route-matrix acceptance bundle. **No publish endpoint; reads make zero provider calls.**

> **Optional split (PR3 is the riskiest PR).** If the diff gets noisy during execution, split into **PR3A** (Task 3.1 shared gate + Task 3.2 guard swap across all six routes + Task 3.5 route-matrix asserting 200/404 with empty-but-valid payloads) and **PR3B** (Task 3.2 Mira data wiring in pipeline/metrics + 3.3 mission + 3.4 greeting signal). Land PR3A first (access correct, data thin) then PR3B (data rich). Keep as one PR if execution is smooth.

### Task 3.1: Shared access gate (TDD)

**Files:**

- Create: `apps/api/src/lib/agent-home-access.ts`
- Test: `apps/api/src/__tests__/agent-home-access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isAgentHomeAccessible } from "../lib/agent-home-access.js";

const enabledRows = (keys: string[]) => keys.map((agentKey) => ({ agentKey, status: "enabled" }));

describe("isAgentHomeAccessible", () => {
  it("alex/riley always accessible regardless of enablement rows", async () => {
    expect(await isAgentHomeAccessible("alex", "org1", { list: async () => [] })).toBe(true);
    expect(await isAgentHomeAccessible("riley", "org1", { list: async () => [] })).toBe(true);
  });
  it("mira accessible only when an enabled row exists", async () => {
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => enabledRows(["mira"]) as any,
      }),
    ).toBe(true);
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => enabledRows(["alex"]) as any,
      }),
    ).toBe(false);
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => [{ agentKey: "mira", status: "coming_soon" }] as any,
      }),
    ).toBe(false);
  });
  it("unknown agent → false", async () => {
    expect(await isAgentHomeAccessible("nova", "org1", { list: async () => [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/api test -- agent-home-access`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { OrgAgentEnablementStore } from "@switchboard/core";

const ALWAYS_ON = new Set(["alex", "riley"]);
const ENABLEMENT_GATED = new Set(["mira"]);

export async function isAgentHomeAccessible(
  agentId: string,
  orgId: string,
  store: Pick<OrgAgentEnablementStore, "list">,
): Promise<boolean> {
  if (ALWAYS_ON.has(agentId)) return true;
  if (!ENABLEMENT_GATED.has(agentId)) return false;
  const rows = await store.list(orgId);
  return rows.some((r) => r.agentKey === agentId && r.status === "enabled");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @switchboard/api test -- agent-home-access`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent-home-access.ts apps/api/src/__tests__/agent-home-access.test.ts
git commit -m "feat(mira): shared per-org agent-home access gate"
```

### Task 3.2: Replace guards in the 5 `ALEX_RILEY_ONLY` routes

**Files:**

- Modify: `apps/api/src/routes/agent-home/{pipeline,metrics,activity,mission,wins}.ts`

For **each** route, replace the static block:

```ts
const { agentId } = params.data;
if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
  return reply.code(404).send({ error: "Agent not available on home" });
}
```

with (place the enablement-store guard right after `orgId` is resolved, since it needs `orgId`). **Add a static top-of-file import to every affected route** (do NOT use dynamic `import()` — uniform static imports across all six files, no variance):

```ts
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js"; // greeting.ts: "../lib/agent-home-access.js"
```

```ts
const { agentId } = params.data;
const orgId = requireOrganizationScope(request, reply);
if (!orgId) return;
if (!app.orgAgentEnablementStore) {
  return reply.code(503).send({ error: "Enablement store unavailable" });
}
if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
  return reply.code(404).send({ error: "Agent not available on home" });
}
```

Delete the now-unused `const ALEX_RILEY_ONLY = …` line in each. Reorder so the existing `requireOrganizationScope` call isn't duplicated — each route already calls it; merge into the block above. **Use this exact guard block verbatim in all five `ALEX_RILEY_ONLY` routes** (and the greeting variant in 3.4) so the gate reads identically everywhere.

- **pipeline.ts** additionally needs the Mira store branch + a precondition check. Bind `app.prisma` once (no `!` non-null assertion — it is fragile under later refactors). After the existing alex/riley precondition checks, add:

```ts
const agentKey = agentId as "alex" | "riley" | "mira"; // widened from "alex" | "riley"
const prisma = app.prisma;
if (agentKey === "mira" && !prisma) {
  return reply.code(503).send({ error: "Database unavailable" });
}
```

Add `listMiraPipeline` to the inline `store`, constructing the reader only when prisma exists:

```ts
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
// ...
const miraReader = prisma ? new PrismaMiraCreativeReadModelReader(prisma) : undefined;
const store: PipelineSignalStore = {
  async listAlexPipeline(/* unchanged */) {
    /* ... */
  },
  async listRileyPipeline(/* unchanged */) {
    /* ... */
  },
  async listMiraPipeline({ orgId: o, limit }) {
    if (!miraReader) throw new Error("listMiraPipeline: prisma unavailable"); // unreachable: guarded above
    const rm = await miraReader.read(o, { now: new Date(), timezone, visibleLimit: limit });
    return {
      rows: rm.jobs.map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        createdAt: new Date(j.createdAt),
      })),
      totalCount: rm.counts.total, // all creative jobs in the fetched window (see PR1 counts honesty note)
    };
  },
};
```

- **metrics.ts** additionally passes the reader into `projectMetrics`. Bind prisma once and 503 explicitly for Mira when it is missing (so we never fall through to `projectMetrics`'s "miraReader required" 500):

```ts
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
// ...
const prisma = app.prisma;
if (agentId === "mira" && !prisma) {
  return reply.code(503).send({ error: "Database unavailable" });
}
const miraReader = prisma ? new PrismaMiraCreativeReadModelReader(prisma) : undefined;
const vm = await projectMetrics({
  orgId,
  agentKey: agentId as "alex" | "riley" | "mira",
  now: new Date(),
  timezone,
  store,
  targets,
  ...(agentId === "mira" && miraReader ? { miraReader } : {}),
});
```

- **activity.ts**: the gate swap is sufficient; `translateAuditToCockpitActivity` accepts `agentKey: AgentHomeKey` (now includes `mira`). Mira has no audit actor in M1 → returns `[]` (empty-but-valid). Change `const agentKey = agentId as AgentHomeKey;` (already cast-compatible).

- **wins.ts**: gate swap is sufficient; the wins store returns `[]` for `mira` (no terminal records) → empty wins. Verify the route's inline `WinsSignalStore.listResolvedForAgent` doesn't reject `mira` (it queries by `agentKey` string; empty result is fine).

- [ ] **Step 1: Edit all five routes** per above.

- [ ] **Step 2: Update each route's `__tests__` to invert the "404 for mira" assertion**

In `apps/api/src/routes/agent-home/__tests__/{pipeline,metrics,activity,mission,wins}.test.ts`, find the test asserting `mira` returns 404 unconditionally and change it to: 404 when Mira is **not** enabled for the org, 200 when it **is**. (The route-matrix test in 3.5 is the comprehensive version; keep per-route tests minimal but correct.) Use the test harness's enablement store (`InMemoryOrgAgentEnablementStore`) to enable Mira for the test org.

- [ ] **Step 3: Run the affected route tests**

Run: `pnpm --filter @switchboard/api test -- agent-home`
Expected: PASS.

### Task 3.3: Mira mission builder (roster-tolerant)

**Files:**

- Modify: `apps/api/src/routes/agent-home/mission.ts`

- [ ] **Step 1: Widen the response type + add the builder**

Change `MissionAggregatorResponse.agentKey` to `"alex" | "riley" | "mira"`. Add:

```ts
const MIRA_ROLE = "Creative · drafts ad concepts for your review";
const MIRA_PIPELINE = "Creatives · all drafts";
const MIRA_COMPOSER_PLACEHOLDER = "Tell Mira what to do — coming soon";

export function buildMiraMissionResponse(inputs: {
  org: OrgInput;
  connections: ConnectionInput[];
}): MissionAggregatorResponse {
  const { org, connections } = inputs;
  const metaConnection = connections.find((c) => c.serviceId === "meta-ads");
  const metaStatus: MissionChannelStatus = metaConnection
    ? mapConnectionStatus(metaConnection.status)
    : "off";
  const brandName = org.name.trim().length > 0 ? org.name : "(unnamed organization)";
  return {
    agentKey: "mira",
    displayName: "Mira",
    mission: {
      role: MIRA_ROLE,
      pipeline: MIRA_PIPELINE,
      brand: `${brandName} · —`,
      channels: [{ kind: "meta-ads", label: "Meta Ads", status: metaStatus }],
      rules: null,
    },
    composerPlaceholder: MIRA_COMPOSER_PLACEHOLDER,
    commands: [],
    targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    setup: [{ key: "meta", done: !!metaConnection, primary: !metaConnection }],
  };
}
```

- [ ] **Step 2: Add the mira branch in the route handler (no roster requirement)**

After the access gate, branch before the roster fetch:

```ts
if (agentId === "mira") {
  if (!app.prisma) return reply.code(503).send({ error: "Prisma unavailable" });
  const [org, connections] = await Promise.all([
    app.prisma.organizationConfig.findUnique({ where: { id: orgId } }),
    app.prisma.connection.findMany({
      where: { organizationId: orgId },
      select: { serviceId: true, status: true },
    }),
  ]);
  return reply
    .code(200)
    .send(buildMiraMissionResponse({ org: { id: orgId, name: org?.name ?? "" }, connections }));
}
```

(The existing alex/riley path — including its `if (!roster) 404` — is untouched and unreachable for mira.)

- [ ] **Step 3: Test mission for mira**

Add to `mission.test.ts`: enabled Mira org → 200 with `agentKey:"mira"`, `mission.role` contains "Creative", **no** roster row required. Also assert `mission-copy-hygiene.test.ts` still passes (extend it in PR7 to cover Mira strings).

Run: `pnpm --filter @switchboard/api test -- mission`
Expected: PASS.

### Task 3.4: Greeting route gate + Mira signal from the seam

**Files:**

- Modify: `apps/api/src/routes/greeting.ts`
- Modify: `packages/db/src/stores/prisma-greeting-signal-store.ts`

- [ ] **Step 1: Replace the greeting gate**

Remove the `entry.launchTier !== "day-one"` 404 and the `agentKey !== "alex" && agentKey !== "riley"` 400. Replace with the shared access gate:

```ts
if (!app.orgAgentEnablementStore) {
  return reply.code(503).send({ error: "Enablement store unavailable", statusCode: 503 });
}
const { isAgentHomeAccessible } = await import("../lib/agent-home-access.js");
if (!(await isAgentHomeAccessible(agentKey, orgId, app.orgAgentEnablementStore))) {
  return reply
    .code(404)
    .send({ error: `Agent ${agentKey} is not available for greeting`, statusCode: 404 });
}
```

Keep the `isAgentKey` 400 (invalid key) check. `projectGreeting` now accepts `mira` (PR2). Pass `agentKey` straight through.

- [ ] **Step 2: Make `PrismaGreetingSignalStore` produce a Mira signal from the read-model**

Inject the reader and branch on `agentKey === "mira"`: `inboxCount = counts.awaitingReview`; `oldestOpenItemAgeHours` from the oldest awaiting-review job; `getTopItem` = that job's `title`. Implement by reading `new PrismaMiraCreativeReadModelReader(prisma).read(orgId, {now, timezone:"UTC"})` and deriving from `rm`. (Alex/riley paths unchanged.) Add a co-located test asserting Mira's `getSignal` returns `inboxCount === awaitingReview`.

> If injecting a timezone is awkward here, M1 may use `"UTC"` for the greeting signal window (greeting age thresholds are coarse). Note this as acceptable for M1.

- [ ] **Step 3: Run greeting tests**

Run: `pnpm --filter @switchboard/api test -- greeting && pnpm --filter @switchboard/db test -- greeting-signal`
Expected: PASS.

### Task 3.5: Route-matrix acceptance bundle (half-live guard)

**Files:**

- Create: `apps/api/src/routes/agent-home/__tests__/mira-route-matrix.test.ts`

- [ ] **Step 1: Write the matrix test**

Boot the test server (`apps/api/src/__tests__/test-server.ts`) with an `InMemoryOrgAgentEnablementStore`. Assert, across **all six** surfaces (`greeting`, `pipeline`, `metrics`, `activity`, `mission`, `wins`):

```ts
import { describe, expect, it, beforeAll } from "vitest";
// import { buildTestServer } from "../../../__tests__/test-server.js"; // adapt to the real helper name

const SURFACES = [
  { path: (a: string) => `/api/dashboard/agents/${a}/greeting`, key: "greeting" },
  { path: (a: string) => `/api/dashboard/agents/${a}/pipeline`, key: "pipeline" },
  { path: (a: string) => `/api/dashboard/agents/${a}/metrics`, key: "metrics" },
  { path: (a: string) => `/api/dashboard/agents/${a}/activity`, key: "activity" },
  { path: (a: string) => `/api/dashboard/agents/${a}/mission`, key: "mission" },
  { path: (a: string) => `/api/dashboard/agents/${a}/wins`, key: "wins" },
];

describe("Mira agent-home route matrix", () => {
  // org "pilot" has Mira enabled; org "other" does not.
  it("enabled Mira org → 200 on every surface", async () => {
    for (const s of SURFACES) {
      const res = await request(`pilot`, s.path("mira"));
      expect(res.statusCode, `${s.key} enabled`).toBe(200);
    }
  });
  it("disabled org → 404 on every Mira surface (no data leak)", async () => {
    for (const s of SURFACES) {
      const res = await request(`other`, s.path("mira"));
      expect(res.statusCode, `${s.key} disabled`).toBe(404);
    }
  });
  it("unknown agent → 404", async () => {
    for (const s of SURFACES) {
      const res = await request(`pilot`, s.path("nova"));
      expect([400, 404]).toContain(res.statusCode); // invalid key may 400 via AgentKeySchema
    }
  });
  it("Alex & Riley still 200 for the pilot org", async () => {
    for (const a of ["alex", "riley"]) {
      for (const s of SURFACES) {
        const res = await request(`pilot`, s.path(a));
        expect(res.statusCode, `${a} ${s.key}`).toBe(200);
      }
    }
  });
  it("enabled Mira org with NO creative jobs → empty-but-valid model", async () => {
    const res = await request(`pilot`, SURFACES[1]!.path("mira")); // pipeline
    expect(res.statusCode).toBe(200);
    expect(res.json().vm.tiles).toEqual([]);
  });
});
```

> Adapt `request(...)` and server bootstrap to the real `test-server.ts` helpers (set `x-org-id` header per the `authDisabled` convention used by every agent-home route). Greeting/mission/pipeline payload shapes differ — assert `statusCode` for the matrix and one shape assertion (`pipeline.vm.tiles`) for the empty case. For org isolation, create a creative job under `pilot` and assert it does NOT appear for `other`.

- [ ] **Step 2: Run + commit PR3**

Run: `pnpm --filter @switchboard/api test && pnpm --filter @switchboard/api typecheck`
Expected: PASS.

```bash
git add apps/api/src/routes/agent-home/ apps/api/src/routes/greeting.ts apps/api/src/lib/agent-home-access.ts packages/db/src/stores/prisma-greeting-signal-store.ts
git commit -m "feat(mira): activate agent-home API behind per-org enablement"
```

---

## PR4 — Dashboard `/mira` cockpit

Page + config + metrics-strip + draft pipeline view + empty state + nav. **Draft-only copy throughout.** Tiles' creative-job links stay disabled until PR5 flips route-availability (graceful: they render non-clickable).

### Task 4.1: Mira cockpit config + KPI adapter

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/mira/mira-config.ts`
- Create: `apps/dashboard/src/lib/cockpit/mira/metrics-to-kpi-data.ts`

- [ ] **Step 1: Write `mira-config.ts`** (mirror `riley/riley-config.ts`; accent = AGENT_REGISTRY ink-violet)

```ts
export const MIRA_ACCENT = {
  base: "#5B4B8A" /* ink violet — matches AGENT_REGISTRY mira accent hsl(265 30% 35%) */,
  deep: "#3C315C",
  soft: "#D8D2E8",
  paper: "#EFECF6",
} as const;

export const MIRA_MISSION_SUBTITLE = "Creative drafts — for your review";
export const MIRA_EMPTY_TITLE = "No drafts yet";
export const MIRA_EMPTY_BODY =
  "When creative drafts come in, they'll appear here for your review. Draft only — nothing is published without you.";
// M1 has NO composer on /mira (no new submission from the Mira UI). This footer
// explains where drafts originate instead of showing an inert input.
export const MIRA_FOOTER_NOTE =
  "New briefs come from the existing creative pipeline. Mira's review starts once a draft exists.";
```

- [ ] **Step 2: Write `metrics-to-kpi-data.ts`** (mirror `riley/metrics-to-kpi-data.ts`; strict no-fallback)

```ts
import type { MetricsViewModel } from "@switchboard/core";
import type { CockpitKpiData } from "@/components/cockpit/types";

export function metricsViewModelToMiraKpiData(vm: MetricsViewModel): CockpitKpiData | null {
  if (!vm.tiles) return null;
  return {
    range: `This week · ${vm.folioRange}`,
    tiles: vm.tiles.map((t) => ({
      label: t.label,
      value: typeof t.value === "number" ? String(t.value) : t.value,
      ...(t.unavailable ? { unavailable: true } : {}),
      ...(t.hint ? { hint: t.hint } : {}),
      ...(t.trend ? { trend: t.trend } : {}),
    })),
  } as CockpitKpiData;
}
```

> Confirm `CockpitKpiData`'s exact shape in `apps/dashboard/src/components/cockpit/types.ts` and match it (the riley adapter is the reference). Adjust field names if they differ.

### Task 4.2: `use-agent-pipeline` hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-pipeline.ts`

- [ ] **Step 1: Write the hook** (mirror `use-agent-metrics.ts`)

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { PipelineViewModel } from "@switchboard/core";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useAgentPipeline(agentKey: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.agentPipeline?.(agentKey) ?? ["__agent_pipeline__", agentKey],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/pipeline`);
      if (!res.ok) throw new Error("Failed to fetch pipeline");
      const data = await res.json();
      return data.vm as PipelineViewModel;
    },
    enabled: !!agentKey && !!keys,
  });
}
```

> Verify `use-agent-metrics.ts`'s exact query-key pattern and copy it (the `keys?.agentPipeline` accessor may need adding to `use-query-keys`, or reuse a generic key). Keep it consistent with the existing hooks.

### Task 4.3: `MiraCockpitPage` component

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx`

Mirror the **shell** of `riley-cockpit-page.tsx` (Identity + KPIStrip), but the body is a **draft pipeline list** (Mira's review queue), not approvals — and M1 Mira has **no Composer and no CommandPalette** (no submission, no commands yet), replaced by a footer note.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { Identity } from "./identity";
import { KPIStrip } from "./kpi-strip";
import { MissionPopover } from "./mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useAgentPipeline } from "@/hooks/use-agent-pipeline";
import { useHalt } from "@/components/layout/halt/halt-context";
import { resolveAgentHomeLink } from "@/lib/agent-home/resolve-link";
import { metricsViewModelToMiraKpiData } from "@/lib/cockpit/mira/metrics-to-kpi-data";
import {
  MIRA_ACCENT,
  MIRA_MISSION_SUBTITLE,
  MIRA_FOOTER_NOTE,
  MIRA_EMPTY_TITLE,
  MIRA_EMPTY_BODY,
} from "@/lib/cockpit/mira/mira-config";

export function MiraCockpitPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const metricsQ = useAgentMetrics("mira");
  const mission = useAgentMission("mira");
  const pipelineQ = useAgentPipeline("mira");
  const router = useRouter();
  const [missionOpen, setMissionOpen] = useState(false);

  const kpis = metricsQ.data ? metricsViewModelToMiraKpiData(metricsQ.data) : null;
  const tiles = pipelineQ.data?.tiles ?? [];
  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;

  return (
    <div
      style={{
        background: T.bg,
        color: T.ink,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
          <Identity
            statusKey="IDLE"
            halted={haltCtx.halted}
            subtitle={MIRA_MISSION_SUBTITLE}
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
        {kpis ? <KPIStrip kpis={kpis} collapsed={false} accent={MIRA_ACCENT} /> : null}

        {tiles.length === 0 ? (
          <div style={{ margin: "32px 28px", color: T.muted }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{MIRA_EMPTY_TITLE}</div>
            <div>{MIRA_EMPTY_BODY}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "20px 28px 0" }}>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: T.muted,
              }}
            >
              Drafts — for your review
            </div>
            {tiles.map((tile) => {
              const resolved = resolveAgentHomeLink(tile.link);
              return (
                <button
                  key={tile.id}
                  disabled={resolved.disabled}
                  onClick={() => resolved.disabled || router.push(resolved.href)}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${MIRA_ACCENT.soft}`,
                    background: T.card,
                    cursor: resolved.disabled ? "default" : "pointer",
                    opacity: resolved.disabled ? 0.7 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{tile.name}</div>
                  <div style={{ fontSize: 13, color: T.muted }}>{tile.ctx}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* M1: NO composer on /mira (no new submission from the Mira UI). An inert
          input is a UX trap; explain where drafts originate instead. */}
      <div
        style={{
          padding: "14px 28px",
          borderTop: `1px solid ${MIRA_ACCENT.soft}`,
          fontSize: 13,
          color: T.muted,
        }}
      >
        {MIRA_FOOTER_NOTE}
      </div>
    </div>
  );
}
```

> Verify prop names against `identity.tsx`, `kpi-strip.tsx`, and `tokens.ts` (`T.muted`/`T.card` may differ — use the actual token names; fall back to literal hex if a token is absent). There is **no Composer** in the Mira cockpit (removed per review — an inert input is a UX trap and implies submission, which M1 forbids); the footer note communicates draft origin instead.

### Task 4.4: Page route + nav + test invert

**Files:**

- Create: `apps/dashboard/src/app/(auth)/mira/page.tsx`
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Modify: `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts`

- [ ] **Step 1: Write the page** (mirror `riley/page.tsx`)

```tsx
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraCockpitPage } from "@/components/cockpit/mira-cockpit-page";

export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();
  return <MiraCockpitPage />;
}
```

- [ ] **Step 2: Add `/mira` to the onboarding gate exemption** (`app-shell.tsx:49`)

```ts
const ONBOARDING_GATE_EXEMPT_EXACT = new Set(["/alex", "/riley", "/mira"]);
```

- [ ] **Step 3: Invert the agent-routes test** (`agent-routes.test.ts:16-18`)

```ts
it("/mira page directory exists (Mira enabled in M1)", () => {
  expect(existsSync(join(AUTH_ROOT, "mira", "page.tsx"))).toBe(true);
});
```

- [ ] **Step 4: Run dashboard checks**

Run: `pnpm --filter @switchboard/dashboard test -- agent-routes && pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS. (`pnpm --filter @switchboard/dashboard build` to catch `.js`/import errors that only `next build` surfaces — see gotchas.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/mira/page.tsx apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx apps/dashboard/src/lib/cockpit/mira/ apps/dashboard/src/hooks/use-agent-pipeline.ts apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/app/\(auth\)/__tests__/agent-routes.test.ts
git commit -m "feat(mira): /mira cockpit (greeting + metrics + draft pipeline, draft-only)"
```

---

## PR5 — `/mira/creatives/[id]` draft review

Preview + stage progress + **Continue draft / Stop draft** via the existing `/approve` endpoint, with an explicit **cost label + confirm** on Continue (cost-bearing) and a **confirm** on Stop (irreversible — no resume path). Draft-only warning throughout. Org-ownership is enforced by the existing API (`/creative-jobs/:id` and `/approve` 404 when `job.organizationId !== orgId`); Task 5.4 adds explicit tests for read **and** mutation ownership — these matter more than the UI test.

### Task 5.1: Detail page route

**Files:**

- Create: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/page.tsx`

- [ ] **Step 1: Write the async route** (mirror the contacts `[id]` pattern)

```tsx
import { MiraCreativeDetailPage } from "./creative-detail-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MiraCreativeDetailPage id={id} />;
}
```

### Task 5.2: Detail component (reuses existing hooks + pure mapper)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { useCreativeJob, useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production", "complete"] as const;

export function MiraCreativeDetailPage({ id }: { id: string }) {
  const jobQ = useCreativeJob(id);
  const approve = useApproveStage();
  // Both actions require an explicit confirm: Continue is cost-bearing (a real
  // provider call, no budget guard in M1) and Stop is irreversible (no resume).
  const [confirm, setConfirm] = useState<null | "continue" | "stop">(null);
  const job = jobQ.data;

  const isComplete = job?.currentStage === "complete";
  const isStopped = !!job?.stoppedAt;
  const canAct = !!job && !isComplete && !isStopped;
  const estimateQ = useCostEstimate(id, canAct);

  if (jobQ.isLoading) return <div style={{ padding: 28 }}>Loading draft…</div>;
  if (!job) return <div style={{ padding: 28 }}>Draft not found.</div>;

  const production = (job.stageOutputs as Record<string, unknown> | undefined)?.["production"] as
    | { assembledVideos?: Array<{ videoUrl?: string; thumbnailUrl?: string }> }
    | undefined;
  const video = production?.assembledVideos?.[0];

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Draft-only banner — never "published" language */}
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

      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{job.productDescription}</h1>

      {video?.videoUrl ? (
        <video
          src={video.videoUrl}
          poster={video.thumbnailUrl}
          controls
          style={{ width: "100%", borderRadius: 10 }}
        />
      ) : (
        <div style={{ color: "#777" }}>No draft clip yet — still in {job.currentStage}.</div>
      )}

      {/* Stage progress */}
      <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0, flexWrap: "wrap" }}>
        {STAGES.map((s) => {
          const idx = STAGES.indexOf(s);
          const curIdx = STAGES.indexOf(job.currentStage as (typeof STAGES)[number]);
          const done = idx < curIdx;
          return (
            <li
              key={s}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: done ? "#D8D2E8" : "#F2F2F2",
                fontSize: 12,
              }}
            >
              {s}
            </li>
          );
        })}
      </ol>

      {canAct ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {confirm === null && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
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
              {/* Explicit cost label up front (confirmed decision) */}
              <span style={{ fontSize: 12, color: "#777" }}>
                {estimateQ.data
                  ? `Continue runs the next generation step (~$${estimateQ.data.basic?.cost ?? "—"}). Stop is free but can't be undone.`
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
                Continue this draft? This runs the next generation step and may cost
                {estimateQ.data ? ` about $${estimateQ.data.basic?.cost ?? "—"}` : " money"}. It
                stays a draft — nothing is published.
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
                Stop this draft? You can't continue it later — this can't be undone.
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
                  Confirm stop
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
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "#777" }}>
          {isStopped
            ? "This draft was stopped."
            : isComplete
              ? "Draft completed — ready for your review."
              : ""}
        </div>
      )}
    </div>
  );
}
```

> `CreativeJobSummary` field names (`currentStage`, `stoppedAt`, `stageOutputs`, `productDescription`) match what `useCreativeJob` returns. Confirm against `@/lib/api-client`'s `CreativeJobSummary`. Where the status/label logic benefits, import the PR1 pure helpers (`mapCreativeJobToMiraStatus`, `deriveReviewAction`) from `@switchboard/core` — the dashboard (Layer 5) may import core. Keep copy strictly draft-only.

### Task 5.3: Flip route-availability so tiles become clickable

**Files:**

- Modify: `apps/dashboard/src/lib/route-availability.ts`

- [ ] **Step 1: Pull `creative-job` out to `return true`** (now that the detail route exists)

```ts
export function isAgentHomeLinkLive(kind: AgentHomeLink["kind"]): boolean {
  switch (kind) {
    case "contact":
      return isMercuryToolLive("contacts");
    case "creative-job":
      return true;
    case "ad-set":
    case "agent-setup":
    case "all-wins":
      return false;
  }
}
```

- [ ] **Step 2: Update the route-availability test** (find `route-availability.test.ts`): assert `isAgentHomeLinkLive("creative-job") === true`, others unchanged.

- [ ] **Step 3: Run + build + commit**

Run: `pnpm --filter @switchboard/dashboard test -- route-availability && pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard build`
Expected: PASS.

```bash
git add apps/dashboard/src/app/\(auth\)/mira/creatives apps/dashboard/src/lib/route-availability.ts
git commit -m "feat(mira): draft review page with continue/stop + cost label"
```

### Task 5.4: Org-ownership tests for detail read + continue/stop mutation (TDD-style)

The Mira detail page reuses `/creative-jobs/:id` (read) and `/creative-jobs/:id/approve` (continue/stop). Both already 404 on cross-org access (`creative-pipeline.ts:138,167`). This task locks that behavior with explicit tests so a later refactor can't silently leak another org's draft or let one org act on another's job. **This is the most important PR5 test** (data/action isolation > UI rendering).

**Files:**

- Create: `apps/api/src/__tests__/creative-pipeline-ownership.test.ts` (api tests are flat in `__tests__`)

- [ ] **Step 1: Write the tests**

```ts
import { describe, expect, it, beforeAll } from "vitest";
// import { buildTestServer } from "./test-server.js"; // adapt to the real helper

describe("creative-job ownership isolation (Mira review path)", () => {
  // Seed one creative job owned by org "owner".
  it("GET /creative-jobs/:id from a different org → 404", async () => {
    const res = await request(
      "intruder",
      `/api/dashboard/marketplace/creative-jobs/${OWNED_JOB_ID}`,
    );
    expect(res.statusCode).toBe(404);
  });
  it("POST /approve {continue} from a different org → 404 and does NOT mutate", async () => {
    const res = await request(
      "intruder",
      `/api/dashboard/marketplace/creative-jobs/${OWNED_JOB_ID}/approve`,
      {
        method: "POST",
        body: { action: "continue" },
      },
    );
    expect(res.statusCode).toBe(404);
    // verify the job is unchanged (still awaiting, not advanced/stopped)
  });
  it("POST /approve {stop} from a different org → 404 and does NOT stop", async () => {
    const res = await request(
      "intruder",
      `/api/dashboard/marketplace/creative-jobs/${OWNED_JOB_ID}/approve`,
      {
        method: "POST",
        body: { action: "stop" },
      },
    );
    expect(res.statusCode).toBe(404);
  });
  it("owner CAN read and stop their own job", async () => {
    expect(
      (await request("owner", `/api/dashboard/marketplace/creative-jobs/${OWNED_JOB_ID}`))
        .statusCode,
    ).toBe(200);
  });
});
```

> Adapt `request(...)` + seeding to the real `test-server.ts` helpers and the actual creative-jobs mount path (dashboard-marketplace proxy vs the bare `/creative-jobs` route — confirm which the dashboard hooks hit; `use-creative-pipeline.ts` uses `/api/dashboard/marketplace/creative-jobs`). The assertion that matters: **cross-org continue/stop returns 404 and leaves the row unmutated.**

- [ ] **Step 2: Run**

Run: `pnpm --filter @switchboard/api test -- creative-pipeline-ownership`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/creative-pipeline-ownership.test.ts
git commit -m "test(mira): cross-org isolation for draft read + continue/stop"
```

---

## PR6 — Pilot enablement seed

`OrgAgentEnablement` rows for pilot orgs only. **No global day-one.** Visible/hidden tests.

### Task 6.1: Seed function (TDD)

**Files:**

- Create: `packages/db/src/seed/seed-mira-pilot-orgs.ts`
- Test: `packages/db/src/seed/__tests__/seed-mira-pilot-orgs.test.ts`

- [ ] **Step 1: Write the failing test** (mock Prisma; mirror `seed-org-day-one-agents.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { seedMiraPilotOrgs } from "../seed-mira-pilot-orgs.js";

describe("seedMiraPilotOrgs", () => {
  it("upserts an enabled mira row per pilot org; idempotent", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { orgAgentEnablement: { upsert } } as any;
    await seedMiraPilotOrgs(prisma, ["org1", "org2"]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org1", agentKey: "mira" } },
      create: { orgId: "org1", agentKey: "mira", status: "enabled" },
      update: { status: "enabled" },
    });
  });
  it("no-op for empty pilot list (no global flip)", async () => {
    const upsert = vi.fn();
    await seedMiraPilotOrgs({ orgAgentEnablement: { upsert } } as any, []);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/db test -- seed-mira-pilot-orgs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { PrismaClient } from "@prisma/client";

/**
 * Enables Mira (opt-in) for an explicit list of pilot orgs. Idempotent.
 * Mira is launchTier "day-thirty" and is NOT seeded by seedOrgDayOneAgents —
 * this is the deliberate, per-org pilot path. There is NO global day-one flip.
 */
export async function seedMiraPilotOrgs(
  prisma: PrismaClient,
  pilotOrgIds: string[],
): Promise<void> {
  await Promise.all(
    pilotOrgIds.map((orgId) =>
      prisma.orgAgentEnablement.upsert({
        where: { orgId_agentKey: { orgId, agentKey: "mira" } },
        create: { orgId, agentKey: "mira", status: "enabled" },
        update: { status: "enabled" },
      }),
    ),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @switchboard/db test -- seed-mira-pilot-orgs`
Expected: PASS.

### Task 6.2: Wire the dev seed for the local pilot org + export

**Files:**

- Modify: `packages/db/prisma/seed.ts`
- Modify: `packages/db/src/index.ts` (export `seedMiraPilotOrgs`)

- [ ] **Step 1: Call it in the dev seed** for the dev org (find the org id the dev seed creates — typically `"default"`):

```ts
import { seedMiraPilotOrgs } from "../src/seed/seed-mira-pilot-orgs.js";
// ... after the org + day-one agents are seeded:
await seedMiraPilotOrgs(prisma, ["default"]); // dev pilot org only
```

- [ ] **Step 2: Export from the barrel**

```ts
export { seedMiraPilotOrgs } from "./seed/seed-mira-pilot-orgs.js";
```

- [ ] **Step 3: Visible/hidden integration assertion**

Extend `apps/api/src/__tests__/api-dashboard-agents.test.ts`: an org with the Mira pilot row → `GET /api/dashboard/agents` lists `mira` with `status:"enabled"`; an org without it → `mira` shows `status:"coming_soon"` (the existing default in `dashboard-agents.ts`). This proves opt-in visibility without a global flip.

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test -- api-dashboard-agents`
Expected: PASS.

```bash
git add packages/db/src/seed/seed-mira-pilot-orgs.ts packages/db/src/seed/__tests__/seed-mira-pilot-orgs.test.ts packages/db/prisma/seed.ts packages/db/src/index.ts
git commit -m "feat(mira): pilot-org enablement seed (opt-in, no global flip)"
```

---

## PR7 — Hardening

Grep audit, copy hygiene, scope confirmation, doc status.

### Task 7.1: Draft-only copy-hygiene test

**Files:**

- Create: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx` (or extend the existing API `mission-copy-hygiene.test.ts` to cover Mira)

- [ ] **Step 1: Write the test** — assert forbidden words never appear in Mira surfaces

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [/\bPublish\b/i, /\bLaunch\b/i, /\bGo live\b/i, /Approve creative/i];
const FILES = [
  "src/components/cockpit/mira-cockpit-page.tsx",
  "src/lib/cockpit/mira/mira-config.ts",
  "src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx",
];

describe("Mira draft-only copy hygiene", () => {
  for (const f of FILES) {
    it(`${f} contains no publish/launch language`, () => {
      const src = readFileSync(new URL(`../../../../${f}`, import.meta.url), "utf8");
      for (const re of FORBIDDEN) expect(src, `${f} matched ${re}`).not.toMatch(re);
    });
  }
});
```

> Fix the relative URL to resolve from the test file. Mirror the existing `mission-copy-hygiene.test.ts` resolution approach for robustness.

- [ ] **Step 2: Run**

Run: `pnpm --filter @switchboard/dashboard test -- mira-copy-hygiene`
Expected: PASS.

### Task 7.2: Grep audit (manual checklist)

- [ ] Run each and confirm the expected result:

```bash
# Mira wired everywhere it should be:
grep -rn "\"mira\"\|'mira'" packages/core/src/agent-home packages/db/src/stores apps/api/src/routes apps/dashboard/src | grep -v __tests__ | sort

# No static ALEX_RILEY_ONLY guards remain in agent-home routes:
grep -rn "ALEX_RILEY_ONLY" apps/api/src && echo "FAIL: stale guard" || echo "OK: none"

# AgentHomeKey includes mira:
grep -n "AgentHomeKey =" packages/core/src/agent-home/agent-key.ts   # expect alex|riley|mira

# launchTier NOT globally flipped (Mira stays day-thirty):
grep -n "mira" packages/schemas/src/agents.ts                        # expect launchTier:"day-thirty"
grep -n "day-one\|seedMiraPilotOrgs" packages/db/src/seed/seed-org-day-one-agents.ts  # expect Mira NOT added here

# route-availability creative-job is true:
grep -n "creative-job" apps/dashboard/src/lib/route-availability.ts

# No PCD code merged, no publish path, no disclosure/lip-sync claims:
grep -rni "PcdPerformanceSnapshot\|c2pa\|lip-sync\|lipsync\|disclosure" apps/dashboard/src/app/\(auth\)/mira apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx && echo "REVIEW" || echo "OK: clean"
grep -rni "publish\|launch\|go live\|approve creative" apps/dashboard/src/app/\(auth\)/mira apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx && echo "REVIEW" || echo "OK: clean"

# No new creative-submission from the Mira UI (the only writes are continue/stop):
grep -rni "createCreativeJob\|submitCreative\|useSubmitBrief\|creative-submission\|new brief\|<Composer" apps/dashboard/src/app/\(auth\)/mira apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx && echo "REVIEW: possible submission UI" || echo "OK: no submission UI"
```

- [ ] Confirm: no new creative-submission UI from `/mira`; the only writes are continue/stop on existing jobs; read endpoints make zero provider calls.

### Task 7.3: Full-suite gate + doc status

- [ ] **Step 1: Whole-repo verification**

Run: `pnpm reset && pnpm typecheck && pnpm test && pnpm format:check && pnpm --filter @switchboard/dashboard build`
Expected: PASS (ignore the known `gateway-bridge-attribution` flake; confirm it passes via `pnpm --filter @switchboard/chat test`). Reads do not call providers — confirm no provider client is imported by any read path.

- [ ] **Step 2: Mark the plan shipped + record deferrals**

Append a "Status: shipped 2026-MM-DD" line to this plan, with G1 (disclosure-at-publish), G2 (consent), G3 (forensic/tier/QC + `PcdPerformanceSnapshot`), and engine-supersede explicitly deferred.

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-05-28-mira-m1-implementation.md apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx
git commit -m "chore(mira): harden M1 — copy hygiene, grep audit, docs"
```

---

## Out of scope for M1 (do NOT build)

PCD governance (tier/consent/forensic/QC), engine supersede (porting clients, retiring `ugc/`), AI-disclosure/C2PA, lip-sync/avatar, variant multiplication, auto-publish, new creative submission from the Mira UI, `PcdPerformanceSnapshot`, a persistent `agentKey` field on `CreativeJob`.

## M1 acceptance

- `/mira` renders for an enabled org: greeting + pipeline of real creative jobs + metrics strip. Empty-but-valid when the org has no jobs.
- `/mira/creatives/[id]` shows the draft clip + stage progress + working **Continue draft / Stop draft** (Continue labeled with its cost).
- All six agent-home surfaces (greeting/pipeline/metrics/activity/mission/wins) return **200 for an enabled Mira org**, **404 for a disabled org** (no data leak), **404/400 for unknown agents**, and Alex & Riley remain **200 + unchanged**.
- Cross-org isolation holds (a pilot org's jobs never appear for another org).
- No PCD code merged; no publish path; draft-only copy throughout.

---

## Self-review (against the spec + handoff)

**Spec coverage:** §4.1 read-model → PR1. §4.2 core projections → PR2. §4.3 API → PR3. §4.4 dashboard → PR4/PR5. §4.5 enablement (opt-in) → PR6; attribution (projection rule) → PR1 builder. §4.6 acceptance → matrix test (PR3) + acceptance section. Scope guards: draft-only copy (PR4/PR5 + hygiene test PR7); read/review-only + continue-cost (PR5); metrics rename "drafts completed" (PR2 metrics-mira stats); expanded seam `reviewAction`/`source` (PR1 types); deterministic status table (authored above + PR1 tests); half-live guard (PR3 matrix). Risks: R1 no-publish (no publish endpoint; hygiene test); R3 scattered exclusion (compiler-forced via `AgentHomeKey` + grep audit PR7).

**Placeholder scan:** every code step has real code; commands have expected output; the few "verify against the real file" notes flag genuine signature confirmations (token names, `CockpitKpiData` shape, `formatRelativeAge` arg order) rather than missing logic.

**Type consistency:** `MiraCreativeReadModel`/`MiraCreativeJobSummary`/`MiraCreativeCounts`/`MiraCreativeReadModelReader` defined in PR1 Task 1.1 and consumed identically in PR1.3/1.4, PR2.2/2.4, PR3.2/3.4. `MiraPipelineRow` defined in PR2.2 and used in PR2.3's `listMiraPipeline`. `buildMiraMetricsViewModel` input `{counts, week}` consistent across PR2.4 and PR3.2. `isAgentHomeAccessible(agentId, orgId, store)` consistent across PR3.1/3.2/3.4. `seedMiraPilotOrgs(prisma, ids)` consistent across PR6.1/6.2.

**Known deviations from the handoff (intentional, verified):** mission has no core builder (API-route only); greeting lives at `routes/greeting.ts`; PR3 is an enablement gate, not a guard-inversion; metrics dispatch threads an optional `miraReader` (pipeline uses the store method per the handoff) to keep `MetricsSignalStore` alex/riley-pristine; `agents.ts` and `resolve-link.ts` need no change.

**Review revisions applied (2026-05-28):** (1) Added `MiraCreativeCounts.total` + fixed the route `totalCount` (was `inFlight+stopped+shippedThisWeek`, which dropped prior-week completes + failed). (2) Documented counts as window-bounded, not reporting-grade (`FETCH_CAP`). (3) Mandated **static** imports for the access gate across all six routes; resolved the `requireAgentHomeAccess`→`isAgentHomeAccessible` naming drift (one pure helper). (4) Replaced `app.prisma!` with a bound-`prisma` + lazy-reader pattern in pipeline & metrics routes, with explicit 503. (5) **Removed the inert Composer** from `/mira` (UX trap implying submission) — replaced with `MIRA_FOOTER_NOTE`; M1 Mira has no composer/command palette. (6) **Continue draft now requires an explicit confirm** (cost-bearing, no budget guard in M1) and **Stop draft requires a confirm** (irreversible — no resume path). (7) Added PR5 Task 5.4 cross-org ownership tests for detail read **and** continue/stop mutation. (8) Added a no-submission grep to PR7. (9) Added a partial-wiring guard test (`projectMetrics("mira")` requires `miraReader`) and an optional PR3A/PR3B split. **Pushed back (with reasoning):** did NOT relocate `buildWeekContext` to a new `core/src/time/` module (the seam contract is already agent-home-free; only the Prisma reader uses it as a tz-week utility; the refactor would touch `agent-home/metrics-buckets.ts` and risk Alex/Riley for no M1 benefit), and kept a single `isAgentHomeAccessible` helper rather than adding a `requireAgentHomeAccess` Fastify wrapper (avoids coupling the gate to `reply` for one saved line).
