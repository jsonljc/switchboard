# Console Option C1 (Tier A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Tier A half of option C — extend `DashboardOverview` so the Console renders real data for revenue / reply-time / leads / appointments / Alex stats / approval-stage progress / structured activity-agent attribution. Tier B fields (spend, Nova, Mira, novaAdSets) ship as schema-shaped placeholders that the Console mutes via `updatedAt = null`.

**Architecture:** Schema-first migration. Each Tier A field follows the same TDD rhythm: schema delta → builder query → mapper consumption. Two existing fields (`stats.newInquiriesToday/Yesterday`, `stats.bookingsToday`) move into the new `today.*` namespace as part of the schema migration. No backwards-compat keys (per CLAUDE.md). Builder stays a pure function over a `DashboardStores` interface; new methods extend that interface.

**Tech Stack:** TypeScript, Zod, Prisma (PostgreSQL), Vitest, Fastify, React Query, Next.js 16 App Router. Same stack as option B.

**Spec:** [`docs/superpowers/specs/2026-05-01-console-option-c-schema-extensions-design.md`](../specs/2026-05-01-console-option-c-schema-extensions-design.md), section "Phasing → C1 — Tier A".

**Hard prerequisite:** PR #328 (option B) must be merged to `main` before this plan starts. The mapper rewrites in tasks 5, 6, 8, 10, 12, 14 build on option-B's `console-mappers.ts`.

---

## File structure

| File | What | Status |
| ---- | ---- | ------ |
| `packages/schemas/src/dashboard.ts` | Adds `AgentKeySchema`, `AdSetRowSchema`, `StageProgressSchema`, `STALE_AFTER_MINUTES` constant. Extends `DashboardOverviewSchema` with new `today`, `agentsToday`, `novaAdSets` blocks; migrates `stats.newInquiriesToday/Yesterday/bookingsToday` into `today.*`; adds optional `stageProgress` on approvals; adds `agent` on activity rows. | Modify |
| `packages/schemas/src/__tests__/dashboard.test.ts` | New: Zod parse round-trip coverage for the full new shape. | Create |
| `packages/db/src/stores/prisma-conversation-state-store.ts` | Adds method `replyTimeStats(orgId, day): Promise<{ medianSeconds: number; sampleSize: number }>`. | Modify |
| `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts` | Adds tests for the new method (or creates the file if it doesn't exist). | Modify or Create |
| `packages/db/src/stores/prisma-conversion-record-store.ts` | Adds method `alexStatsToday(orgId, day): Promise<{ repliedToday: number; qualifiedToday: number; bookedToday: number }>`. | Modify |
| `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Adds tests for the new method. | Modify or Create |
| `packages/db/src/stores/prisma-creative-job-store.ts` | Adds method `stageProgressByApproval(approvalIds): Promise<Map<string, StageProgress>>`. | Modify |
| `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts` | Adds tests for the new method. | Modify or Create |
| `apps/api/src/services/activity-translator.ts` | Adds structured `agent: AgentKey \| null` field on `TranslatedActivity`; new `resolveAgentKey()` helper. The legacy `resolveActor` string remains for the existing `description` field but is no longer the source of truth for agent attribution. | Modify |
| `apps/api/src/services/__tests__/activity-translator.test.ts` | Adds tests for `resolveAgentKey`; rebases existing tests if any. | Modify or Create |
| `apps/api/src/routes/dashboard-overview.ts` | Extends `DashboardStores` interface with new methods (`sumRevenueToday`, `replyTimeStats`, `alexStatsToday`, `stageProgressByApproval`). Updates `buildDashboardOverview` to assemble the new shape. Sets Tier B placeholder values. | Modify |
| `apps/api/src/__tests__/dashboard-overview-builder.test.ts` | New: unit tests for the pure `buildDashboardOverview` function with mock stores. Covers: empty org, partial-data org, full-data org. | Create |
| `apps/dashboard/src/components/console/console-mappers.ts` | Rebases existing mappers to read from new schema paths. Updates `mapNumbersStrip` (Revenue, Reply-time cells), `mapAgents` (Alex cell), `mapApprovalGateCard` (real `stageProgress`), `mapActivity` (read structured `agent` field, remove `agentForAction` synth). Spend cell + Nova/Mira cells stay muted via `placeholder: true`. | Modify |
| `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts` | Rebases existing 18 tests to new paths; adds tests for the new field consumption. | Modify |
| `packages/schemas/src/time-windows.ts` | New: `dayWindow(day, timezone?): { from: Date; to: Date }` — the single source of truth for "today" boundaries. Used by the API builder and DB store queries to avoid timezone/boundary drift. C1 hardcodes UTC; org-timezone awareness is its own future spec. | Create |
| `packages/schemas/src/__tests__/time-windows.test.ts` | Tests for `dayWindow` covering UTC boundary cases. | Create |

**Files NOT touched:** `console-view.tsx`, `console-data.ts`, `use-console-data.ts`, `console.css`, `(auth)/console/page.tsx`. Option B's view + composer + view-model types are stable across C.

## Hook reference (read once before starting)

| Source | Symbol | Purpose |
| ------ | ------ | ------- |
| `packages/schemas/src/dashboard.ts` | current `DashboardOverviewSchema` | Baseline shape to migrate from. |
| `apps/api/src/routes/dashboard-overview.ts:76-89` | `DashboardStores` interface | Stores composition contract. New methods extend this. |
| `apps/api/src/routes/dashboard-overview.ts:95-213` | `buildDashboardOverview` | Pure function we extend. |
| `apps/api/src/services/activity-translator.ts:1-78` | `RawAuditEntry`, `TranslatedActivity`, `resolveActor` | Activity translation source. |
| `packages/db/src/stores/prisma-revenue-store.ts` | `sumByOrg(orgId, range)` | Reused with today's window for `today.revenue`. |
| `packages/db/src/stores/prisma-conversion-record-store.ts:141` | `countByType(orgId, type, from, to)` | Reused for `today.leads` migration; composed for `alexStatsToday`. |
| `packages/db/src/stores/prisma-conversation-state-store.ts` | `PrismaConversationStateStore` (class) | New `replyTimeStats` method goes here. The `firstReplyAt` field exists on `ConversationState` (`schema.prisma:140`). |
| `packages/db/src/stores/prisma-creative-job-store.ts:40` | `PrismaCreativeJobStore` (class) | New `stageProgressByApproval` method goes here. `currentStage` + `STAGE_ORDER = ["trends","hooks","scripts","storyboard","production"]` per `packages/creative-pipeline/src/stages/run-stage.ts:45`. |
| `packages/db/prisma/schema.prisma:232` | `ApprovalRecord` | `expiresAt` is the close time for the gate. |

---

## Task 1: Pre-flight — confirm option B merged, rebase, baseline

**Files:** none modified.

- [ ] **Step 1:** Verify option B has merged.

  ```bash
  gh pr view 328 --json state -q .state
  ```

  Expected: `MERGED`. If `OPEN` or `CLOSED` (without merge), STOP — this plan cannot proceed without option B's mappers in place.

- [ ] **Step 2:** Switch to the C1 branch and rebase onto current main.

  ```bash
  git fetch origin
  git checkout feat/console-option-c
  git rebase origin/main
  ```

  Expected: clean rebase (the only commit on this branch is the option-C spec, which doesn't conflict with option B's mapper file).

- [ ] **Step 3:** Verify baseline typecheck + tests pass.

  ```bash
  cd /Users/jasonli/switchboard
  pnpm reset                                                  # ensures clean dist + Prisma types
  pnpm --filter @switchboard/schemas typecheck && \
  pnpm --filter @switchboard/db typecheck && \
  pnpm --filter @switchboard/api typecheck && \
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS for all four.

  ```bash
  pnpm --filter @switchboard/schemas test && \
  pnpm --filter @switchboard/db test && \
  pnpm --filter @switchboard/api test && \
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: PASS. Take note of the dashboard test count — should be ~316 (option B added 21).

- [ ] **Step 4:** Read these files into context (no edits):
  - `packages/schemas/src/dashboard.ts`
  - `apps/api/src/routes/dashboard-overview.ts`
  - `apps/api/src/services/activity-translator.ts`
  - `apps/dashboard/src/components/console/console-mappers.ts` (now exists post-merge)
  - `apps/dashboard/src/components/console/use-console-data.ts`

---

## Task 2: Add new types + STALE_AFTER_MINUTES to `packages/schemas`

Pure additive change. Defines the building blocks consumed in later tasks. Nothing reads them yet, so this commit ships in isolation.

**Files:**

- Modify: `packages/schemas/src/dashboard.ts`
- Create: `packages/schemas/src/__tests__/dashboard.test.ts`

- [ ] **Step 1:** Add the new exports at the top of `packages/schemas/src/dashboard.ts`, before `DashboardOverviewSchema`.

  ```ts
  // ── Constants ─────────────────────────────────────────────────────────────
  /**
   * Single source of truth for the dashboard's freshness contract.
   * The API builder uses this to decide when to log a stale-rollup warning;
   * the Console uses it to decide when to render the "X min ago" footer.
   * Not a response field — would imply per-org configurability that doesn't exist.
   */
  export const STALE_AFTER_MINUTES = 30;

  // ── Building blocks for option C ──────────────────────────────────────────
  export const AgentKeySchema = z.enum(["alex", "nova", "mira", "system"]);
  export type AgentKey = z.infer<typeof AgentKeySchema>;

  export const AdSetRowSchema = z.object({
    adSetId: z.string(),
    adSetName: z.string(),
    deploymentId: z.string(),
    spend: z.object({ amount: z.number(), currency: z.string() }),
    conversions: z.number(),
    cpa: z.number().nullable(),
    trend: z.enum(["up", "down", "flat"]),
    status: z.enum(["delivering", "learning", "limited", "paused"]),
    /** True when an approval with kind=pause_ad_set is pending against this row. Drives the Nova-panel cross-link pin. */
    pausePending: z.boolean(),
  });
  export type AdSetRow = z.infer<typeof AdSetRowSchema>;

  export const StageProgressSchema = z.object({
    stageIndex: z.number().int().nonnegative(),
    stageTotal: z.number().int().positive(),
    stageLabel: z.string(),
    closesAt: z.string().nullable(),
  });
  export type StageProgress = z.infer<typeof StageProgressSchema>;
  ```

- [ ] **Step 2:** Create the test file with parse round-trips.

  ```ts
  // packages/schemas/src/__tests__/dashboard.test.ts
  import { describe, it, expect } from "vitest";
  import {
    AgentKeySchema,
    AdSetRowSchema,
    StageProgressSchema,
    STALE_AFTER_MINUTES,
  } from "../dashboard.js";

  describe("STALE_AFTER_MINUTES", () => {
    it("is 30", () => {
      expect(STALE_AFTER_MINUTES).toBe(30);
    });
  });

  describe("AgentKeySchema", () => {
    it("accepts alex / nova / mira / system", () => {
      for (const k of ["alex", "nova", "mira", "system"] as const) {
        expect(AgentKeySchema.parse(k)).toBe(k);
      }
    });
    it("rejects unknown agents", () => {
      expect(() => AgentKeySchema.parse("zoe")).toThrow();
    });
  });

  describe("AdSetRowSchema", () => {
    it("parses a complete row", () => {
      const row = AdSetRowSchema.parse({
        adSetId: "ad-1",
        adSetName: "Test Ad Set",
        deploymentId: "dep-1",
        spend: { amount: 42.5, currency: "USD" },
        conversions: 3,
        cpa: 14.17,
        trend: "up",
        status: "delivering",
        pausePending: false,
      });
      expect(row.adSetId).toBe("ad-1");
      expect(row.cpa).toBe(14.17);
    });
    it("accepts null cpa", () => {
      const row = AdSetRowSchema.parse({
        adSetId: "ad-1",
        adSetName: "x",
        deploymentId: "d",
        spend: { amount: 0, currency: "USD" },
        conversions: 0,
        cpa: null,
        trend: "flat",
        status: "learning",
        pausePending: false,
      });
      expect(row.cpa).toBeNull();
    });
    it("rejects unknown trend / status", () => {
      const base = {
        adSetId: "x",
        adSetName: "x",
        deploymentId: "d",
        spend: { amount: 0, currency: "USD" },
        conversions: 0,
        cpa: null,
        pausePending: false,
      };
      expect(() => AdSetRowSchema.parse({ ...base, trend: "sideways", status: "delivering" })).toThrow();
      expect(() => AdSetRowSchema.parse({ ...base, trend: "up", status: "spinning" })).toThrow();
    });
  });

  describe("StageProgressSchema", () => {
    it("parses a row with a closesAt", () => {
      const sp = StageProgressSchema.parse({
        stageIndex: 1,
        stageTotal: 5,
        stageLabel: "hooks",
        closesAt: "2026-05-02T10:00:00Z",
      });
      expect(sp.stageLabel).toBe("hooks");
    });
    it("accepts null closesAt", () => {
      const sp = StageProgressSchema.parse({
        stageIndex: 0,
        stageTotal: 5,
        stageLabel: "trends",
        closesAt: null,
      });
      expect(sp.closesAt).toBeNull();
    });
    it("rejects negative stageIndex", () => {
      expect(() =>
        StageProgressSchema.parse({ stageIndex: -1, stageTotal: 5, stageLabel: "x", closesAt: null }),
      ).toThrow();
    });
    it("rejects zero stageTotal", () => {
      expect(() =>
        StageProgressSchema.parse({ stageIndex: 0, stageTotal: 0, stageLabel: "x", closesAt: null }),
      ).toThrow();
    });
  });
  ```

- [ ] **Step 3:** Run the schema tests.

  ```bash
  pnpm --filter @switchboard/schemas test src/__tests__/dashboard.test.ts
  ```

  Expected: PASS (10 tests).

- [ ] **Step 4:** Run typecheck across all packages — nothing else should break since these are pure additions.

  ```bash
  pnpm --filter @switchboard/schemas typecheck && pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS.

- [ ] **Step 5:** Commit.

  ```bash
  git add packages/schemas/src/dashboard.ts packages/schemas/src/__tests__/dashboard.test.ts
  git commit -m "feat(schemas): add option-C building blocks — AgentKey, AdSetRow, StageProgress, STALE_AFTER_MINUTES"
  ```

---

## Task 2.5: Add central `dayWindow` time helper to `packages/schemas`

Time-window math currently lives in three places (the builder's `todayWindow`, the `replyTimeStats` store method, the `alexStatsToday` store method). One central helper avoids drift.

**Files:**

- Create: `packages/schemas/src/time-windows.ts`
- Create: `packages/schemas/src/__tests__/time-windows.test.ts`

- [ ] **Step 1:** Create the helper.

  ```ts
  // packages/schemas/src/time-windows.ts
  /**
   * Returns a [from, to) half-open window covering the day that contains `at`.
   * `from` is the local-midnight of `at`; `to` is the next day's local-midnight.
   * UTC timezone is assumed for C1; pass an explicit timezone in a future iteration.
   */
  export function dayWindow(at: Date): { from: Date; to: Date } {
    const from = new Date(at);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }

  /** Returns the day-window for the day before `at`. */
  export function previousDayWindow(at: Date): { from: Date; to: Date } {
    const today = dayWindow(at);
    const from = new Date(today.from);
    from.setDate(from.getDate() - 1);
    return { from, to: today.from };
  }
  ```

- [ ] **Step 2:** Create the test file.

  ```ts
  // packages/schemas/src/__tests__/time-windows.test.ts
  import { describe, it, expect } from "vitest";
  import { dayWindow, previousDayWindow } from "../time-windows.js";

  describe("dayWindow", () => {
    it("returns midnight-to-next-midnight for a mid-afternoon timestamp", () => {
      const at = new Date("2026-05-01T14:30:00");
      const { from, to } = dayWindow(at);
      expect(from.getHours()).toBe(0);
      expect(from.getMinutes()).toBe(0);
      expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("returns same window when called twice with timestamps from the same day", () => {
      const a = dayWindow(new Date("2026-05-01T01:00:00"));
      const b = dayWindow(new Date("2026-05-01T23:59:59"));
      expect(a.from.getTime()).toBe(b.from.getTime());
      expect(a.to.getTime()).toBe(b.to.getTime());
    });

    it("does not mutate the input", () => {
      const at = new Date("2026-05-01T14:30:00");
      const original = at.getTime();
      dayWindow(at);
      expect(at.getTime()).toBe(original);
    });
  });

  describe("previousDayWindow", () => {
    it("returns the day-window directly preceding today's", () => {
      const at = new Date("2026-05-01T14:30:00");
      const today = dayWindow(at);
      const yesterday = previousDayWindow(at);
      expect(yesterday.to.getTime()).toBe(today.from.getTime());
      expect(today.from.getTime() - yesterday.from.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });
  ```

- [ ] **Step 3:** Re-export from the package index. Add to `packages/schemas/src/index.ts`:

  ```ts
  export { dayWindow, previousDayWindow } from "./time-windows.js";
  ```

- [ ] **Step 4:** Run tests.

  ```bash
  pnpm --filter @switchboard/schemas test src/__tests__/time-windows.test.ts
  ```

  Expected: PASS (4 tests).

- [ ] **Step 5:** Commit.

  ```bash
  git add packages/schemas/src/time-windows.ts packages/schemas/src/__tests__/time-windows.test.ts packages/schemas/src/index.ts
  git commit -m "feat(schemas): central dayWindow / previousDayWindow helpers (UTC; future timezone-aware)"
  ```

**Subsequent tasks use these helpers:**

- Task 4's `todayWindow(now)` is replaced by `dayWindow(now)` from `@switchboard/schemas`.
- Task 7's `replyTimeStats` uses `dayWindow(day)` instead of inline `setHours/setDate` math.
- Task 9's `alexStatsToday` uses `dayWindow(day)`.
- Task 8's builder change uses `previousDayWindow(now)` instead of `new Date(todayStart); yesterdayStart.setDate(...)`.

---

## Task 3: Migrate `DashboardOverviewSchema` — add `today.*`, `agentsToday.*`, `novaAdSets`; move 3 stats fields; add `stageProgress` + `activity[].agent`

This is the schema-shape change. After this commit, the API builder + the option-B mapper both fail to typecheck. Tasks 4-5 fix them in the same conceptual unit, but each task lands in its own commit so the failure surface stays narrow.

**Files:**

- Modify: `packages/schemas/src/dashboard.ts`
- Modify: `packages/schemas/src/__tests__/dashboard.test.ts`

- [ ] **Step 1:** Replace the existing `DashboardOverviewSchema` definition. Keep the `import { z } from "zod";` at the top and the new types added in Task 2.

  ```ts
  // packages/schemas/src/dashboard.ts (DashboardOverviewSchema replacement)
  export const DashboardOverviewSchema = z.object({
    generatedAt: z.string(),

    greeting: z.object({
      period: z.enum(["morning", "afternoon", "evening"]),
      operatorName: z.string(),
    }),

    // newInquiriesToday/Yesterday + bookingsToday have moved to `today.*`.
    stats: z.object({
      pendingApprovals: z.number(),
      qualifiedLeads: z.number(),
      revenue7d: z.object({ total: z.number(), count: z.number() }),
      openTasks: z.number(),
      overdueTasks: z.number(),
    }),

    // ── NEW ────────────────────────────────────────────────────────────────
    today: z.object({
      revenue: z.object({
        amount: z.number(),
        currency: z.string(),
        deltaPctVsAvg: z.number().nullable(),
      }),
      spend: z.object({
        amount: z.number(),
        currency: z.string(),
        capPct: z.number(),
        updatedAt: z.string().nullable(),
      }),
      replyTime: z
        .object({
          medianSeconds: z.number(),
          previousSeconds: z.number().nullable(),
          sampleSize: z.number().int().nonnegative(),
        })
        .nullable(),
      leads: z.object({
        count: z.number().int().nonnegative(),
        yesterdayCount: z.number().int().nonnegative(),
      }),
      appointments: z.object({
        count: z.number().int().nonnegative(),
        next: z
          .object({ startsAt: z.string(), contactName: z.string(), service: z.string() })
          .nullable(),
      }),
    }),

    agentsToday: z.object({
      alex: z
        .object({
          /**
           * APPROXIMATION: in C1, repliedToday = today's `inquiry`-type ConversionRecord count
           * (each inquiry reaching the system implies Alex's first response). This is wrong if
           * Alex sometimes fails to reply or if the inquiry record predates the reply.
           * A future iteration replaces this with a direct first-reply event count once the
           * conversation pipeline emits one.
           */
          repliedToday: z.number().int().nonnegative(),
          qualifiedToday: z.number().int().nonnegative(),
          bookedToday: z.number().int().nonnegative(),
        })
        .nullable(),
      nova: z
        .object({
          /** Per-agent spend is NOT duplicated here — the Nova cell reads today.spend directly to avoid drift. */
          draftsPending: z.number().int().nonnegative(),
        })
        .nullable(),
      mira: z
        .object({
          inFlight: z.number().int().nonnegative(),
          winningHook: z.string().nullable(),
        })
        .nullable(),
    }),

    novaAdSets: z.array(AdSetRowSchema),

    approvals: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        riskContext: z.string().nullable(),
        createdAt: z.string(),
        envelopeId: z.string(),
        bindingHash: z.string(),
        riskCategory: z.string(),
        /** NEW: present only for creative-pipeline approvals. */
        stageProgress: StageProgressSchema.optional(),
      }),
    ),

    bookings: z.array(
      z.object({
        id: z.string(),
        startsAt: z.string(),
        service: z.string(),
        contactName: z.string(),
        status: z.enum(["confirmed", "pending"]),
        channel: z.string().nullable(),
      }),
    ),

    funnel: z.object({
      inquiry: z.number(),
      qualified: z.number(),
      booked: z.number(),
      purchased: z.number(),
      completed: z.number(),
    }),

    revenue: z.object({
      total: z.number(),
      count: z.number(),
      topSource: z.object({ name: z.string(), amount: z.number() }).nullable(),
      periodDays: z.literal(7),
    }),

    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        dueAt: z.string().nullable(),
        isOverdue: z.boolean(),
        status: z.string(),
      }),
    ),

    activity: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        description: z.string(),
        dotColor: z.enum(["green", "amber", "blue", "gray"]),
        createdAt: z.string(),
        reasoning: z.string().nullable().optional(),
        /** NEW: structured agent attribution. null for system events / unattributable rows. */
        agent: AgentKeySchema.nullable(),
      }),
    ),
  });
  ```

- [ ] **Step 2:** Add a comprehensive parse-round-trip test for the new shape at the bottom of `packages/schemas/src/__tests__/dashboard.test.ts`.

  ```ts
  import { DashboardOverviewSchema } from "../dashboard.js";

  describe("DashboardOverviewSchema (post-C1)", () => {
    const minimalValid = {
      generatedAt: "2026-05-01T10:00:00Z",
      greeting: { period: "morning" as const, operatorName: "Jane" },
      stats: {
        pendingApprovals: 0,
        qualifiedLeads: 0,
        revenue7d: { total: 0, count: 0 },
        openTasks: 0,
        overdueTasks: 0,
      },
      today: {
        revenue: { amount: 0, currency: "USD", deltaPctVsAvg: null },
        spend: { amount: 0, currency: "USD", capPct: 0, updatedAt: null },
        replyTime: null,
        leads: { count: 0, yesterdayCount: 0 },
        appointments: { count: 0, next: null },
      },
      agentsToday: { alex: null, nova: null, mira: null },
      novaAdSets: [],
      approvals: [],
      bookings: [],
      funnel: { inquiry: 0, qualified: 0, booked: 0, purchased: 0, completed: 0 },
      revenue: { total: 0, count: 0, topSource: null, periodDays: 7 as const },
      tasks: [],
      activity: [],
    };

    it("parses a minimal valid shape with all Tier B fields at placeholder values", () => {
      const parsed = DashboardOverviewSchema.parse(minimalValid);
      expect(parsed.today.spend.updatedAt).toBeNull();
      expect(parsed.agentsToday.alex).toBeNull();
      expect(parsed.novaAdSets).toEqual([]);
    });

    it("rejects when stats still carries the migrated fields", () => {
      const withOldField = {
        ...minimalValid,
        stats: { ...minimalValid.stats, newInquiriesToday: 5 },
      };
      // strict mode would throw; default mode strips. Either way the new path is the truth.
      const parsed = DashboardOverviewSchema.parse(withOldField);
      // The migrated key is gone from the parsed object's stats namespace.
      expect((parsed.stats as Record<string, unknown>).newInquiriesToday).toBeUndefined();
    });

    it("parses a full Tier-A populated shape", () => {
      const populated = {
        ...minimalValid,
        today: {
          ...minimalValid.today,
          revenue: { amount: 1240, currency: "USD", deltaPctVsAvg: 0.18 },
          replyTime: { medianSeconds: 12, previousSeconds: 18, sampleSize: 7 },
          leads: { count: 7, yesterdayCount: 5 },
          appointments: {
            count: 3,
            next: { startsAt: "2026-05-01T11:00:00Z", contactName: "Sarah", service: "Consult" },
          },
        },
        agentsToday: {
          ...minimalValid.agentsToday,
          alex: { repliedToday: 14, qualifiedToday: 6, bookedToday: 3 },
        },
        approvals: [
          {
            id: "apr-1",
            summary: "Campaign 01",
            riskContext: "Hooks ready",
            createdAt: "2026-05-01T08:00:00Z",
            envelopeId: "env-1",
            bindingHash: "hash-1",
            riskCategory: "creative",
            stageProgress: {
              stageIndex: 1,
              stageTotal: 5,
              stageLabel: "hooks",
              closesAt: "2026-05-02T08:00:00Z",
            },
          },
        ],
        activity: [
          {
            id: "act-1",
            type: "alex.replied",
            description: "Alex replied",
            dotColor: "green" as const,
            createdAt: "2026-05-01T10:00:00Z",
            agent: "alex" as const,
          },
        ],
      };
      const parsed = DashboardOverviewSchema.parse(populated);
      expect(parsed.today.revenue.amount).toBe(1240);
      expect(parsed.approvals[0].stageProgress?.stageIndex).toBe(1);
      expect(parsed.activity[0].agent).toBe("alex");
    });

    it("approvals[].stageProgress is optional (undefined for non-creative rows)", () => {
      const populated = {
        ...minimalValid,
        approvals: [
          {
            id: "apr-2",
            summary: "Pause ad set",
            riskContext: null,
            createdAt: "2026-05-01T08:00:00Z",
            envelopeId: "env-2",
            bindingHash: "hash-2",
            riskCategory: "high",
          },
        ],
      };
      const parsed = DashboardOverviewSchema.parse(populated);
      expect(parsed.approvals[0].stageProgress).toBeUndefined();
    });

    it("activity[].agent accepts null for system events", () => {
      const populated = {
        ...minimalValid,
        activity: [
          {
            id: "act-2",
            type: "system.tick",
            description: "system",
            dotColor: "gray" as const,
            createdAt: "2026-05-01T10:00:00Z",
            agent: null,
          },
        ],
      };
      const parsed = DashboardOverviewSchema.parse(populated);
      expect(parsed.activity[0].agent).toBeNull();
    });
  });
  ```

- [ ] **Step 3:** Run schema tests.

  ```bash
  pnpm --filter @switchboard/schemas test src/__tests__/dashboard.test.ts
  ```

  Expected: PASS.

- [ ] **Step 4:** Run typecheck across consumers — this WILL fail. Capture the failures.

  ```bash
  pnpm --filter @switchboard/api typecheck 2>&1 | tail -40
  pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -40
  ```

  Expected: API fails with missing properties on the `DashboardOverview` return value (e.g., `Property 'today' is missing`); dashboard fails with `Property 'newInquiriesToday' does not exist` from the option-B mapper. These are the exact failures Tasks 4 + 5 fix.

- [ ] **Step 5:** Commit the schema migration.

  ```bash
  git add packages/schemas/src/dashboard.ts packages/schemas/src/__tests__/dashboard.test.ts
  git commit -m "feat(schemas): migrate DashboardOverview to today.* + agentsToday.* + activity[].agent (option C1)"
  ```

  Note: API + dashboard packages are knowingly broken at this commit. Tasks 4 + 5 land within the same PR.

---

## Task 4: Update `buildDashboardOverview` to assemble the new shape (Tier B placeholders)

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Create: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`

The builder still uses only existing query methods at this task. New stores (`replyTimeStats`, `alexStatsToday`, `stageProgressByApproval`) come in later tasks.

- [ ] **Step 1:** Import the central `dayWindow` + `previousDayWindow` from `@switchboard/schemas` (added in Task 2.5). Replace any inline `setHours/setDate` math in the builder with calls to these helpers.

  ```ts
  import { dayWindow, previousDayWindow, STALE_AFTER_MINUTES } from "@switchboard/schemas";
  ```

  Add a small staleness logger near the top of the file (no-op in C1 because `today.spend.updatedAt` is always `null`; ready for C2):

  ```ts
  /**
   * Logs a one-line warning when a Tier-B rollup is older than the freshness contract.
   * No-op when updatedAt is null (no successful sync yet). Pure side-effect — never throws.
   */
  function checkStaleness(label: string, updatedAt: string | null, now: Date): void {
    if (updatedAt === null) return;
    const ageMin = (now.getTime() - new Date(updatedAt).getTime()) / 60_000;
    if (ageMin > STALE_AFTER_MINUTES) {
      console.warn(
        `[dashboard-overview] ${label} is stale (${Math.round(ageMin)} min old; threshold ${STALE_AFTER_MINUTES} min)`,
      );
    }
  }
  ```

- [ ] **Step 2:** Replace the body of `buildDashboardOverview` (lines ~95-213). Keep the `DashboardStores` interface as-is for this task — it grows in later tasks.

  ```ts
  export async function buildDashboardOverview(
    orgId: string,
    stores: DashboardStores,
    orgCurrency = "USD",
  ): Promise<DashboardOverview> {
    const now = new Date();
    const today = dayWindow(now);
    const yesterday = previousDayWindow(now);

    const todayStart = today.from;
    const yesterdayStart = yesterday.from;

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const revenueRange = { from: sevenDaysAgo, to: now };

    // Run all queries in parallel
    const [
      operatorName,
      pendingApprovals,
      bookingsRaw,
      tasksRaw,
      funnel,
      revenueSummary,
      revenueByCampaign,
      inquiriesToday,
      inquiriesYesterday,
      auditEntries,
    ] = await Promise.all([
      stores.queryOperatorName(orgId),
      stores.queryApprovals(orgId),
      stores.listBookingsByDate(orgId, now, 10),
      stores.listOpenTasks(orgId, 10),
      stores.activePipelineCounts(orgId),
      stores.sumRevenue(orgId, revenueRange),
      stores.sumRevenueByCampaign(orgId, revenueRange),
      stores.countByType(orgId, "inquiry", todayStart, now),
      stores.countByType(orgId, "inquiry", yesterdayStart, todayStart),
      stores.queryAudit({ organizationId: orgId, limit: 8 }),
    ]);

    // Map pending approvals (top 3). stageProgress is added in Task 12.
    const approvals = pendingApprovals
      .filter((a) => a.state.status === "pending")
      .slice(0, 3)
      .map((a) => ({
        id: a.request.id,
        summary: a.request.summary,
        riskContext: null as string | null,
        createdAt:
          a.request.createdAt instanceof Date
            ? a.request.createdAt.toISOString()
            : String(a.request.createdAt),
        envelopeId: a.envelopeId,
        bindingHash: a.request.bindingHash,
        riskCategory: a.request.riskCategory,
      }));

    // Map bookings
    const bookings = bookingsRaw.map((b) => ({
      id: b.id,
      startsAt: b.startsAt instanceof Date ? b.startsAt.toISOString() : String(b.startsAt),
      service: b.service,
      contactName: b.contact.name ?? "Unknown",
      status: (b.status === "confirmed" ? "confirmed" : "pending") as "confirmed" | "pending",
      channel: b.sourceChannel ?? null,
    }));

    // Top revenue source
    const topCampaign =
      revenueByCampaign.length > 0
        ? revenueByCampaign.sort((a, b) => b.totalAmount - a.totalAmount)[0]
        : null;

    // Translate activity. agent field is added in Task 13.
    const activity = translateActivities(auditEntries, 8).map((a) => ({
      ...a,
      agent: null as null,
    }));

    // Tier B fields ship as placeholders in C1; the staleness check is a no-op until C2
    // gives spendUpdatedAt a real value, but the call site stays here so C2 doesn't have to thread it in.
    const spendUpdatedAt: string | null = null;
    checkStaleness("today.spend", spendUpdatedAt, now);

    // today.appointments — derive from today's bookings
    const todayBookings = bookings.filter(
      (b) => new Date(b.startsAt).toDateString() === now.toDateString(),
    );
    const nextAppt = todayBookings.length > 0 ? todayBookings[0] : null;

    return {
      generatedAt: now.toISOString(),
      greeting: { period: greetingPeriod(now.getHours()), operatorName },
      stats: {
        pendingApprovals: pendingApprovals.filter((a) => a.state.status === "pending").length,
        qualifiedLeads: funnel.qualified,
        revenue7d: { total: revenueSummary.totalAmount, count: revenueSummary.count },
        openTasks: tasksRaw.openCount,
        overdueTasks: tasksRaw.overdueCount,
      },

      today: {
        // today.revenue real wiring lands in Task 6.
        revenue: { amount: 0, currency: orgCurrency, deltaPctVsAvg: null },
        // today.spend stays as a Tier-B placeholder. updatedAt=null mutes the cell.
        spend: { amount: 0, currency: orgCurrency, capPct: 0, updatedAt: spendUpdatedAt },
        // today.replyTime real wiring lands in Task 8.
        replyTime: null,
        leads: { count: inquiriesToday, yesterdayCount: inquiriesYesterday },
        appointments: {
          count: todayBookings.length,
          next: nextAppt
            ? { startsAt: nextAppt.startsAt, contactName: nextAppt.contactName, service: nextAppt.service }
            : null,
        },
      },

      agentsToday: {
        // agentsToday.alex real wiring lands in Task 10.
        alex: null,
        // Tier B — stay null until C2.
        nova: null,
        mira: null,
      },

      // Tier B — stays empty until C2.
      novaAdSets: [],

      approvals,
      bookings,
      funnel,
      revenue: {
        total: revenueSummary.totalAmount,
        count: revenueSummary.count,
        topSource: topCampaign
          ? { name: topCampaign.sourceCampaignId, amount: topCampaign.totalAmount }
          : null,
        periodDays: 7,
      },
      tasks: tasksRaw.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt instanceof Date ? t.dueAt.toISOString() : t.dueAt ? String(t.dueAt) : null,
        isOverdue: t.isOverdue,
        status: t.status,
      })),
      activity,
    };
  }
  ```

  Note: the route handler at the bottom of the file still calls `buildDashboardOverview(orgId, stores)` — pass `orgCurrency` once we have it from `OrganizationConfig`. For now the default `"USD"` is fine; passing the real currency is a Step 4 of this task.

- [ ] **Step 3:** Update the Fastify plugin's call site to pass the org currency.

  Inside `dashboardOverviewRoutes`, locate the `try { const overview = await buildDashboardOverview(orgId, stores); ... }` block. Add a currency lookup before the call:

  ```ts
  const orgConfigRow = await prisma.organizationConfig.findUnique({
    where: { organizationId: orgId },
    select: { currency: true },
  });
  const orgCurrency = orgConfigRow?.currency ?? "USD";

  const overview = await buildDashboardOverview(orgId, stores, orgCurrency);
  ```

  If `OrganizationConfig` doesn't have a `currency` column in the current schema, fall back to `"USD"` and add a Step note for the executor: "Skip the orgConfig lookup; pass `'USD'` literal until OrgConfig adds currency."

  Verify by running:

  ```bash
  grep -nE "currency\s*:" packages/db/prisma/schema.prisma | grep -i organizationconfig -A1 -B1 || echo "no currency column on OrganizationConfig"
  ```

  If "no currency column" prints, simplify to `const orgCurrency = "USD";`.

- [ ] **Step 4:** Create the builder unit-test file.

  ```ts
  // apps/api/src/__tests__/dashboard-overview-builder.test.ts
  import { describe, it, expect, vi } from "vitest";
  import { buildDashboardOverview, type DashboardStores } from "../routes/dashboard-overview.js";

  function makeStores(overrides: Partial<DashboardStores> = {}): DashboardStores {
    return {
      listBookingsByDate: vi.fn().mockResolvedValue([]),
      listOpenTasks: vi.fn().mockResolvedValue(Object.assign([], { openCount: 0, overdueCount: 0 })),
      activePipelineCounts: vi.fn().mockResolvedValue({
        inquiry: 0, qualified: 0, booked: 0, purchased: 0, completed: 0,
      }),
      sumRevenue: vi.fn().mockResolvedValue({ totalAmount: 0, count: 0 }),
      sumRevenueByCampaign: vi.fn().mockResolvedValue([]),
      countByType: vi.fn().mockResolvedValue(0),
      queryApprovals: vi.fn().mockResolvedValue([]),
      queryAudit: vi.fn().mockResolvedValue([]),
      queryOperatorName: vi.fn().mockResolvedValue("Jane"),
      ...overrides,
    };
  }

  describe("buildDashboardOverview (option C1 shape)", () => {
    it("returns the new namespaced shape for an empty org", async () => {
      const result = await buildDashboardOverview("org-1", makeStores(), "USD");
      expect(result.today.revenue).toEqual({ amount: 0, currency: "USD", deltaPctVsAvg: null });
      expect(result.today.spend).toEqual({
        amount: 0, currency: "USD", capPct: 0, updatedAt: null,
      });
      expect(result.today.replyTime).toBeNull();
      expect(result.today.leads).toEqual({ count: 0, yesterdayCount: 0 });
      expect(result.today.appointments).toEqual({ count: 0, next: null });
      expect(result.agentsToday).toEqual({ alex: null, nova: null, mira: null });
      expect(result.novaAdSets).toEqual([]);
      expect(result.activity).toEqual([]);
    });

    it("populates today.leads from countByType results", async () => {
      const countByType = vi
        .fn()
        .mockImplementation((_org: string, _type: string, from: Date) => {
          const d = from.getDate();
          // distinguish today (most recent) vs yesterday by day-of-month
          return Promise.resolve(d === new Date().getDate() ? 7 : 5);
        });
      const result = await buildDashboardOverview("org-1", makeStores({ countByType }), "USD");
      expect(result.today.leads.count).toBe(7);
      expect(result.today.leads.yesterdayCount).toBe(5);
    });

    it("derives today.appointments.next from the first today-booking", async () => {
      const today = new Date();
      today.setHours(11, 0, 0, 0);
      const listBookingsByDate = vi.fn().mockResolvedValue([
        {
          id: "b-1",
          startsAt: today,
          service: "Consult",
          status: "confirmed",
          sourceChannel: "web",
          contact: { name: "Sarah" },
        },
      ]);
      const result = await buildDashboardOverview("org-1", makeStores({ listBookingsByDate }), "USD");
      expect(result.today.appointments.count).toBe(1);
      expect(result.today.appointments.next?.contactName).toBe("Sarah");
      expect(result.today.appointments.next?.service).toBe("Consult");
    });

    it("uses the orgCurrency arg for placeholder Tier B blocks", async () => {
      const result = await buildDashboardOverview("org-1", makeStores(), "EUR");
      expect(result.today.revenue.currency).toBe("EUR");
      expect(result.today.spend.currency).toBe("EUR");
    });
  });
  ```

- [ ] **Step 5:** Run the builder tests.

  ```bash
  pnpm --filter @switchboard/api test src/__tests__/dashboard-overview-builder.test.ts
  ```

  Expected: PASS (4 tests).

- [ ] **Step 6:** Run API typecheck.

  ```bash
  pnpm --filter @switchboard/api typecheck
  ```

  Expected: PASS. (Dashboard package will still fail; Task 5 fixes it.)

- [ ] **Step 7:** Commit.

  ```bash
  git add apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts
  git commit -m "feat(api): assemble DashboardOverview in C1 shape (Tier B fields placeholder, Tier A scaffold)"
  ```

---

## Task 5: Rebase option-B's mappers onto the new schema paths

The smallest mapper change that compiles against the new schema. Subsequent tasks (6, 8, 10, 12, 14) light up real data per cell. This task just makes the dashboard package typecheck again.

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Open `console-mappers.ts`. Locate the `MapConsoleInput` type and the body of `mapConsoleData`. Update the `useConsoleData` consumer side first by changing the `MapConsoleInput` shape:

  ```ts
  export type MapConsoleInput = {
    orgName: string;
    now: Date;
    dispatch: "live" | "halted";
    leadsToday: number;            // sourced from overview.today.leads.count
    leadsYesterday: number;        // sourced from overview.today.leads.yesterdayCount
    bookingsToday: Array<{ startsAt: string; contactName: string }>;
    escalations: EscalationApiRow[];
    approvals: ApprovalApiRow[];
    modules: ModuleEnablementMap;
    auditEntries: AuditEntry[];
  };
  ```

  No change here — option B's input is already compatible. The fix is in `use-console-data.ts`.

- [ ] **Step 2:** Open `apps/dashboard/src/components/console/use-console-data.ts`. Locate the block that destructures `overview.data.stats` and `overview.data.bookings`. Replace it.

  ```ts
  // Before (option B):
  // leadsToday: overview.data.stats.newInquiriesToday,
  // leadsYesterday: overview.data.stats.newInquiriesYesterday,
  // bookingsToday: overview.data.bookings.filter(...).map(...),

  // After (option C1):
  const data = mapConsoleData({
    orgName: (org.data as { config?: { name?: string } })?.config?.name ?? "Switchboard",
    now: new Date(),
    dispatch: "live",
    leadsToday: overview.data.today.leads.count,
    leadsYesterday: overview.data.today.leads.yesterdayCount,
    bookingsToday: overview.data.today.appointments.next
      ? [{
          startsAt: overview.data.today.appointments.next.startsAt,
          contactName: overview.data.today.appointments.next.contactName,
        }]
      : [],
    escalations: escalationRows,
    approvals: approvalRows,
    modules: moduleMap,
    auditEntries,
  });
  ```

  Note: the option-B mapper consumed the full `bookings[]` array to derive a "next" booking. C1 does that derivation in the API builder; the mapper now receives a 0-or-1-element array.

- [ ] **Step 3:** Run dashboard typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS.

- [ ] **Step 4:** Run dashboard tests.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: PASS — option B's existing mapper tests use synthetic input fixtures (not real `DashboardOverview` shape), so they're not impacted by the schema migration. Only the live `useConsoleData` hook composer changed.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/use-console-data.ts
  git commit -m "feat(dashboard): rebase useConsoleData onto today.leads + today.appointments paths"
  ```

---

## Task 6: Wire `today.revenue` (Tier A — reuses existing PrismaRevenueStore)

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Modify: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`
- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add a builder test asserting `today.revenue` is populated from `sumRevenue`.

  ```ts
  // append to apps/api/src/__tests__/dashboard-overview-builder.test.ts
  it("populates today.revenue from sumRevenue with today's window + 7-day baseline for delta", async () => {
    const sumRevenue = vi.fn(async (_org: string, range: { from: Date; to: Date }) => {
      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
      // 7-day window → $700; today window (1 day) → $140
      if (days >= 6) return { totalAmount: 700, count: 14 };
      return { totalAmount: 140, count: 2 };
    });
    const result = await buildDashboardOverview("org-1", makeStores({ sumRevenue }), "USD");
    expect(result.today.revenue.amount).toBe(140);
    // 7-day daily avg = 100; today is 140 → +40%
    expect(result.today.revenue.deltaPctVsAvg).toBeCloseTo(0.4, 2);
  });

  it("today.revenue.deltaPctVsAvg is null when 7-day baseline is zero", async () => {
    const sumRevenue = vi.fn(async () => ({ totalAmount: 0, count: 0 }));
    const result = await buildDashboardOverview("org-1", makeStores({ sumRevenue }), "USD");
    expect(result.today.revenue.deltaPctVsAvg).toBeNull();
  });
  ```

- [ ] **Step 2:** Run the test — confirm it fails.

  ```bash
  pnpm --filter @switchboard/api test src/__tests__/dashboard-overview-builder.test.ts
  ```

  Expected: 2 new tests fail (today.revenue.amount === 0).

- [ ] **Step 3:** Update the builder. Add a third `sumRevenue` call inside the `Promise.all`, and replace the `today.revenue` placeholder.

  ```ts
  // Inside the Promise.all, add:
  stores.sumRevenue(orgId, { from: todayStart, to: now }),

  // Destructure it as `revenueToday`:
  const [
    operatorName, pendingApprovals, bookingsRaw, tasksRaw, funnel,
    revenueSummary, revenueByCampaign, inquiriesToday, inquiriesYesterday, auditEntries,
    revenueTodayRaw,
  ] = await Promise.all([...]);

  // Compute the delta after the existing block:
  const sevenDayAvg = revenueSummary.totalAmount / 7;
  const deltaPctVsAvg =
    sevenDayAvg > 0 ? (revenueTodayRaw.totalAmount - sevenDayAvg) / sevenDayAvg : null;

  // Replace the today.revenue placeholder in the return:
  today: {
    revenue: { amount: revenueTodayRaw.totalAmount, currency: orgCurrency, deltaPctVsAvg },
    spend: { amount: 0, currency: orgCurrency, capPct: 0, updatedAt: null },
    // ... rest unchanged
  },
  ```

- [ ] **Step 4:** Run the builder tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/api test src/__tests__/dashboard-overview-builder.test.ts
  ```

  Expected: PASS (all tests, including the 2 new).

- [ ] **Step 5:** Update the dashboard mapper. Open `console-mappers.ts`. Locate `mapNumbersStrip`. Update its input type to accept revenue from the API:

  ```ts
  export type NumbersInput = {
    leadsToday: number;
    leadsYesterday: number;
    bookingsToday: Array<{ startsAt: string; contactName: string }>;
    revenue: { amount: number; currency: string; deltaPctVsAvg: number | null };
  };
  ```

  Replace the Revenue cell's placeholder block:

  ```ts
  // Before:
  // {
  //   label: "Revenue today",
  //   value: "—",
  //   delta: ["pending option C"],
  //   tone: "neutral",
  //   placeholder: true,
  // },

  // After:
  {
    label: "Revenue today",
    value: formatCurrency(input.revenue.amount, input.revenue.currency),
    delta:
      input.revenue.deltaPctVsAvg === null
        ? ["—"]
        : [
            input.revenue.deltaPctVsAvg >= 0 ? "+" : "",
            { bold: `${Math.round(input.revenue.deltaPctVsAvg * 100)}%` },
            " vs avg",
          ],
    tone:
      input.revenue.deltaPctVsAvg === null
        ? "neutral"
        : input.revenue.deltaPctVsAvg >= 0
        ? "good"
        : "coral",
  },
  ```

  Add the helper at the top of the file:

  ```ts
  function formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  ```

- [ ] **Step 6:** Update `mapConsoleData` to pass `revenue` through:

  ```ts
  // In MapConsoleInput, add:
  revenue: { amount: number; currency: string; deltaPctVsAvg: number | null };

  // In mapConsoleData body, change mapNumbersStrip call:
  numbers: mapNumbersStrip({
    leadsToday: input.leadsToday,
    leadsYesterday: input.leadsYesterday,
    bookingsToday: input.bookingsToday,
    revenue: input.revenue,
  }),
  ```

- [ ] **Step 7:** Update `useConsoleData` (the hook composer) to forward `today.revenue`:

  ```ts
  const data = mapConsoleData({
    // ...existing fields,
    revenue: overview.data.today.revenue,
  });
  ```

- [ ] **Step 8:** Add mapper tests for the Revenue cell. Append to `console-mappers.test.ts`:

  ```ts
  describe("mapNumbersStrip — Revenue cell (option C1)", () => {
    const base = {
      leadsToday: 0,
      leadsYesterday: 0,
      bookingsToday: [],
    } as const;

    it("formats amount as currency and shows positive delta", () => {
      const result = mapNumbersStrip({
        ...base,
        revenue: { amount: 1240, currency: "USD", deltaPctVsAvg: 0.18 },
      });
      const cell = result.cells.find((c) => c.label === "Revenue today");
      expect(cell?.value).toBe("$1,240");
      expect(cell?.tone).toBe("good");
      expect(cell?.placeholder).not.toBe(true);
    });

    it("shows muted '—' delta when deltaPctVsAvg is null but value is a real number", () => {
      const result = mapNumbersStrip({
        ...base,
        revenue: { amount: 0, currency: "USD", deltaPctVsAvg: null },
      });
      const cell = result.cells.find((c) => c.label === "Revenue today");
      expect(cell?.value).toBe("$0");
      expect(cell?.delta).toEqual(["—"]);
      expect(cell?.tone).toBe("neutral");
    });
  });
  ```

- [ ] **Step 9:** Update the existing test that asserted "Revenue is placeholder" — that assertion is no longer true. Find the test in `console-mappers.test.ts`:

  ```ts
  // Before (delete):
  it("Revenue / Spend / Reply Time are placeholder cells", () => { ... }

  // After (replace with):
  it("Spend / Reply Time stay as placeholder cells in C1 (Tier B + null replyTime)", () => {
    const result = mapNumbersStrip({
      ...base,
      revenue: { amount: 0, currency: "USD", deltaPctVsAvg: null },
    });
    const spend = result.cells.find((c) => c.label === "Spend today");
    const reply = result.cells.find((c) => c.label === "Reply time");
    for (const cell of [spend, reply]) {
      expect(cell?.placeholder).toBe(true);
      expect(cell?.value).toBe("—");
    }
  });
  ```

- [ ] **Step 10:** Run dashboard tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: PASS.

- [ ] **Step 11:** Commit.

  ```bash
  git add apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/use-console-data.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard,api): wire today.revenue end-to-end (option C1)"
  ```

---

## Task 7: Add `PrismaConversationStateStore.replyTimeStats`

**Files:**

- Modify: `packages/db/src/stores/prisma-conversation-state-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts` (or create)

- [ ] **Step 1:** Locate the test file. Run:

  ```bash
  ls packages/db/src/stores/__tests__/ | grep -i conversation-state
  ```

  If no file exists, create `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts` with the standard Prisma in-memory or SQLite scaffolding used by sibling test files (e.g., copy the imports + `beforeEach`/`afterEach` block from `prisma-conversion-record-store.test.ts`).

- [ ] **Step 2:** Add the failing test for `replyTimeStats`. The test scenario:

  - Insert 4 ConversationState rows for the org:
    - A: `createdAt = today 09:00`, `firstReplyAt = today 09:00:10` → 10s
    - B: `createdAt = today 10:00`, `firstReplyAt = today 10:00:30` → 30s
    - C: `createdAt = today 11:00`, `firstReplyAt = null` → excluded (no reply yet)
    - D: `createdAt = yesterday 14:00`, `firstReplyAt = yesterday 14:00:05` → excluded (not today)
  - Median of [10, 30] = 20.

  ```ts
  it("replyTimeStats returns the median latency for today's replies and the sample size", async () => {
    const orgId = "org-replytime";
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    await prisma.conversationState.createMany({
      data: [
        { id: "cs-A", threadId: "tA", channel: "x", principalId: "p", organizationId: orgId, status: "active", pendingProposalIds: [], pendingApprovalIds: [], messages: "[]", lastActivityAt: now, expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() + 9 * 3600_000),
          firstReplyAt: new Date(today.getTime() + 9 * 3600_000 + 10_000) },
        { id: "cs-B", threadId: "tB", channel: "x", principalId: "p", organizationId: orgId, status: "active", pendingProposalIds: [], pendingApprovalIds: [], messages: "[]", lastActivityAt: now, expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() + 10 * 3600_000),
          firstReplyAt: new Date(today.getTime() + 10 * 3600_000 + 30_000) },
        { id: "cs-C", threadId: "tC", channel: "x", principalId: "p", organizationId: orgId, status: "active", pendingProposalIds: [], pendingApprovalIds: [], messages: "[]", lastActivityAt: now, expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() + 11 * 3600_000),
          firstReplyAt: null },
        { id: "cs-D", threadId: "tD", channel: "x", principalId: "p", organizationId: orgId, status: "active", pendingProposalIds: [], pendingApprovalIds: [], messages: "[]", lastActivityAt: now, expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() - 10 * 3600_000),
          firstReplyAt: new Date(today.getTime() - 10 * 3600_000 + 5_000) },
      ],
    });

    const store = new PrismaConversationStateStore(prisma, /* workTraceStore */ ({} as never));
    const stats = await store.replyTimeStats(orgId, today);
    expect(stats.sampleSize).toBe(2);
    expect(stats.medianSeconds).toBe(20);
  });

  it("replyTimeStats excludes conversations whose firstReplyAt is more than 24h after createdAt (SLA cap)", async () => {
    const orgId = "org-sla";
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    await prisma.conversationState.create({
      data: { id: "cs-Z", threadId: "tZ", channel: "x", principalId: "p", organizationId: orgId, status: "active", pendingProposalIds: [], pendingApprovalIds: [], messages: "[]", lastActivityAt: now, expiresAt: new Date(today.getTime() + 2 * 86_400_000),
        createdAt: new Date(today.getTime() + 1 * 3600_000),
        firstReplyAt: new Date(today.getTime() + 1 * 3600_000 + 25 * 3600_000) },  // 25h later — out of SLA
    });
    const store = new PrismaConversationStateStore(prisma, ({} as never));
    const stats = await store.replyTimeStats(orgId, today);
    expect(stats.sampleSize).toBe(0);
  });

  it("replyTimeStats returns sampleSize=0 (medianSeconds=0) when no eligible rows", async () => {
    const store = new PrismaConversationStateStore(prisma, ({} as never));
    const stats = await store.replyTimeStats("org-empty", new Date());
    expect(stats.sampleSize).toBe(0);
    expect(stats.medianSeconds).toBe(0);
  });
  ```

- [ ] **Step 3:** Run test — confirm fail with "replyTimeStats is not a function".

  ```bash
  pnpm --filter @switchboard/db test src/stores/__tests__/prisma-conversation-state-store.test.ts
  ```

- [ ] **Step 4:** Implement the method on the class. First, add the import at the top of the file:

  ```ts
  import { dayWindow } from "@switchboard/schemas";
  ```

  Then add inside `PrismaConversationStateStore`:

  ```ts
  /**
   * Median first-reply latency (in seconds) for conversations created on `day`,
   * counting only those where firstReplyAt exists AND (firstReplyAt - createdAt) <= 24h.
   * Returns { medianSeconds: 0, sampleSize: 0 } when no eligible rows.
   */
  async replyTimeStats(
    orgId: string,
    day: Date,
  ): Promise<{ medianSeconds: number; sampleSize: number }> {
    const { from: dayStart, to: dayEnd } = dayWindow(day);
    const slaCutoffMs = 24 * 60 * 60 * 1000;

    const rows = await this.prisma.conversationState.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: dayStart, lt: dayEnd },
        firstReplyAt: { not: null },
      },
      select: { createdAt: true, firstReplyAt: true },
    });

    const latencies: number[] = [];
    for (const row of rows) {
      if (!row.firstReplyAt) continue;
      const ms = row.firstReplyAt.getTime() - row.createdAt.getTime();
      if (ms < 0 || ms > slaCutoffMs) continue;
      latencies.push(Math.round(ms / 1000));
    }

    if (latencies.length === 0) return { medianSeconds: 0, sampleSize: 0 };
    latencies.sort((a, b) => a - b);
    const mid = Math.floor(latencies.length / 2);
    const medianSeconds =
      latencies.length % 2 === 0 ? Math.round((latencies[mid - 1] + latencies[mid]) / 2) : latencies[mid];
    return { medianSeconds, sampleSize: latencies.length };
  }
  ```

  Note: `ConversationState` does not have a `createdAt` column in the current schema (per `schema.prisma:128-148`). If the typecheck step below fails with "Property 'createdAt' does not exist on ConversationStateWhereInput", add `createdAt DateTime @default(now())` to the model and create a migration.

- [ ] **Step 5:** Run typecheck. If `createdAt` is missing, add it to the model and migration.

  ```bash
  pnpm --filter @switchboard/db typecheck 2>&1 | tail -20
  ```

  If failing on `createdAt`, add to `packages/db/prisma/schema.prisma`:

  ```prisma
  model ConversationState {
    // ...existing
    createdAt DateTime @default(now())
    // ...rest
  }
  ```

  Then create a migration:

  ```bash
  pnpm --filter @switchboard/db exec prisma migrate dev --name add_conversation_state_created_at --skip-seed
  ```

- [ ] **Step 6:** Run tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/db test src/stores/__tests__/prisma-conversation-state-store.test.ts
  ```

  Expected: 3 tests pass.

- [ ] **Step 7:** Commit.

  ```bash
  git add packages/db/src/stores/prisma-conversation-state-store.ts packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations 2>/dev/null || true
  git commit -m "feat(db): replyTimeStats query on PrismaConversationStateStore (24h SLA cap)"
  ```

---

## Task 8: Wire `today.replyTime` end-to-end

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Modify: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`
- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/use-console-data.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Extend the `DashboardStores` interface in `dashboard-overview.ts`:

  ```ts
  export interface DashboardStores {
    // ...existing
    replyTimeStats: (
      orgId: string,
      day: Date,
    ) => Promise<{ medianSeconds: number; sampleSize: number }>;
  }
  ```

- [ ] **Step 2:** Add a builder test asserting reply-time wiring.

  ```ts
  it("populates today.replyTime from replyTimeStats (today + yesterday for previousSeconds)", async () => {
    const replyTimeStats = vi
      .fn()
      .mockImplementation(async (_org: string, day: Date) => {
        const isToday = day.toDateString() === new Date().toDateString();
        return isToday ? { medianSeconds: 12, sampleSize: 7 } : { medianSeconds: 18, sampleSize: 5 };
      });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toEqual({
      medianSeconds: 12,
      previousSeconds: 18,
      sampleSize: 7,
    });
  });

  it("today.replyTime is null when sampleSize=0 today", async () => {
    const replyTimeStats = vi.fn().mockResolvedValue({ medianSeconds: 0, sampleSize: 0 });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toBeNull();
  });
  ```

  Update `makeStores` to include `replyTimeStats: vi.fn().mockResolvedValue({ medianSeconds: 0, sampleSize: 0 })` by default.

- [ ] **Step 3:** Run test — confirm fail.

- [ ] **Step 4:** Update the builder.

  Inside the `Promise.all`, add two calls:

  ```ts
  stores.replyTimeStats(orgId, todayStart),
  stores.replyTimeStats(orgId, yesterdayStart),
  ```

  Destructure as `replyTimeToday`, `replyTimeYesterday`. Add a small-sample guard at the top of the file (near the other helpers):

  ```ts
  /**
   * Below this sample size, the median is too noisy to surface as a headline metric
   * (one fast reply would read as "12s avg"). Treat the cell as muted instead.
   */
  const MIN_REPLY_SAMPLE = 3;
  ```

  Replace the `today.replyTime: null` placeholder:

  ```ts
  replyTime:
    replyTimeToday.sampleSize < MIN_REPLY_SAMPLE
      ? null
      : {
          medianSeconds: replyTimeToday.medianSeconds,
          previousSeconds:
            replyTimeYesterday.sampleSize < MIN_REPLY_SAMPLE
              ? null
              : replyTimeYesterday.medianSeconds,
          sampleSize: replyTimeToday.sampleSize,
        },
  ```

  Add a builder test asserting the threshold:

  ```ts
  it("today.replyTime is null when sampleSize < MIN_REPLY_SAMPLE (=3) — guards against single-reply skew", async () => {
    const replyTimeStats = vi.fn().mockResolvedValue({ medianSeconds: 5, sampleSize: 2 });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toBeNull();
  });
  ```

- [ ] **Step 5:** Wire the new store method into the Fastify plugin's `stores` object:

  ```ts
  // In dashboardOverviewRoutes plugin body, locate the stores object literal:
  const stores: DashboardStores = {
    // ...existing entries,
    replyTimeStats: (id, day) =>
      new PrismaConversationStateStore(prisma, /* unused for read */ ({} as never)).replyTimeStats(id, day),
  };
  ```

  Also add `PrismaConversationStateStore` to the dynamic import block at the top of the handler.

- [ ] **Step 6:** Run API tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/api test src/__tests__/dashboard-overview-builder.test.ts
  ```

- [ ] **Step 7:** Update `mapNumbersStrip` to consume the new field. Update `NumbersInput`:

  ```ts
  export type NumbersInput = {
    leadsToday: number;
    leadsYesterday: number;
    bookingsToday: Array<{ startsAt: string; contactName: string }>;
    revenue: { amount: number; currency: string; deltaPctVsAvg: number | null };
    replyTime: { medianSeconds: number; previousSeconds: number | null; sampleSize: number } | null;
  };
  ```

  Replace the Reply-time placeholder cell:

  ```ts
  {
    label: "Reply time",
    value: input.replyTime === null ? "—" : formatDuration(input.replyTime.medianSeconds),
    delta:
      input.replyTime === null
        ? ["pending"]
        : input.replyTime.previousSeconds === null
        ? ["new today"]
        : input.replyTime.medianSeconds <= input.replyTime.previousSeconds
        ? ["↓ from ", { bold: formatDuration(input.replyTime.previousSeconds) }]
        : ["↑ from ", { bold: formatDuration(input.replyTime.previousSeconds) }],
    tone:
      input.replyTime === null
        ? "neutral"
        : input.replyTime.previousSeconds !== null && input.replyTime.medianSeconds <= input.replyTime.previousSeconds
        ? "good"
        : "neutral",
    placeholder: input.replyTime === null,
  },
  ```

  Add the helper:

  ```ts
  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  ```

- [ ] **Step 8:** Update `mapConsoleData`'s input + body, and `useConsoleData`'s composer call, to forward `replyTime: overview.data.today.replyTime`.

- [ ] **Step 9:** Add mapper tests. Append to `console-mappers.test.ts`:

  ```ts
  describe("mapNumbersStrip — Reply time cell (option C1)", () => {
    const base = {
      leadsToday: 0,
      leadsYesterday: 0,
      bookingsToday: [],
      revenue: { amount: 0, currency: "USD", deltaPctVsAvg: null },
    } as const;

    it("renders muted '—' when replyTime is null", () => {
      const result = mapNumbersStrip({ ...base, replyTime: null });
      const cell = result.cells.find((c) => c.label === "Reply time");
      expect(cell?.value).toBe("—");
      expect(cell?.placeholder).toBe(true);
    });

    it("formats medianSeconds and shows '↓ from' delta when faster than yesterday", () => {
      const result = mapNumbersStrip({
        ...base,
        replyTime: { medianSeconds: 12, previousSeconds: 18, sampleSize: 7 },
      });
      const cell = result.cells.find((c) => c.label === "Reply time");
      expect(cell?.value).toBe("12s");
      expect(cell?.tone).toBe("good");
      expect(JSON.stringify(cell?.delta)).toContain("↓");
      expect(JSON.stringify(cell?.delta)).toContain("18s");
      expect(cell?.placeholder).not.toBe(true);
    });

    it("shows 'new today' when previousSeconds is null", () => {
      const result = mapNumbersStrip({
        ...base,
        replyTime: { medianSeconds: 12, previousSeconds: null, sampleSize: 1 },
      });
      const cell = result.cells.find((c) => c.label === "Reply time");
      expect(cell?.delta).toEqual(["new today"]);
    });
  });
  ```

- [ ] **Step 10:** Run dashboard tests — confirm pass.

- [ ] **Step 11:** Commit.

  ```bash
  git add apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts apps/dashboard/src/components/console
  git commit -m "feat(dashboard,api): wire today.replyTime end-to-end (option C1)"
  ```

---

## Task 9: Add `PrismaConversionRecordStore.alexStatsToday`

**Files:**

- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

- [ ] **Step 1:** Add the failing test.

  ```ts
  it("alexStatsToday returns counts of replies, qualified leads, and bookings created today", async () => {
    const orgId = "org-alex";
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Insert a mix of records: today inquiries (replied count proxy), today qualified, today booked, plus yesterday entries that should be excluded.
    await prisma.conversionRecord.createMany({
      data: [
        { id: "cr-1", organizationId: orgId, type: "inquiry", occurredAt: new Date(today.getTime() + 1_000_000) },
        { id: "cr-2", organizationId: orgId, type: "inquiry", occurredAt: new Date(today.getTime() + 2_000_000) },
        { id: "cr-3", organizationId: orgId, type: "inquiry", occurredAt: new Date(today.getTime() + 3_000_000) },
        { id: "cr-4", organizationId: orgId, type: "qualified", occurredAt: new Date(today.getTime() + 4_000_000) },
        { id: "cr-5", organizationId: orgId, type: "booked", occurredAt: new Date(today.getTime() + 5_000_000) },
        { id: "cr-6", organizationId: orgId, type: "inquiry", occurredAt: new Date(today.getTime() - 86_400_000) }, // yesterday — excluded
      ],
    });

    const store = new PrismaConversionRecordStore(prisma);
    const stats = await store.alexStatsToday(orgId, today);
    expect(stats).toEqual({ repliedToday: 3, qualifiedToday: 1, bookedToday: 1 });
  });

  it("alexStatsToday returns zeros for an empty org", async () => {
    const store = new PrismaConversionRecordStore(prisma);
    const stats = await store.alexStatsToday("org-empty", new Date());
    expect(stats).toEqual({ repliedToday: 0, qualifiedToday: 0, bookedToday: 0 });
  });
  ```

- [ ] **Step 2:** Run test — confirm fail.

- [ ] **Step 3:** Implement the method. First, add the import at the top of the file (if not already present):

  ```ts
  import { dayWindow } from "@switchboard/schemas";
  ```

  Then add to `PrismaConversionRecordStore`:

  ```ts
  /**
   * Per-agent today-stats for Alex. "Replied" is approximated by the count of
   * inquiry records created today (each inquiry reaching the system implies Alex's first response).
   * Refine with a more direct first-reply event later if needed.
   */
  async alexStatsToday(
    orgId: string,
    day: Date,
  ): Promise<{ repliedToday: number; qualifiedToday: number; bookedToday: number }> {
    const { from: dayStart, to: dayEnd } = dayWindow(day);

    const groups = await this.prisma.conversionRecord.groupBy({
      by: ["type"],
      where: {
        organizationId: orgId,
        type: { in: ["inquiry", "qualified", "booked"] },
        occurredAt: { gte: dayStart, lt: dayEnd },
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const g of groups) counts[g.type] = g._count._all;

    return {
      repliedToday: counts.inquiry ?? 0,
      qualifiedToday: counts.qualified ?? 0,
      bookedToday: counts.booked ?? 0,
    };
  }
  ```

- [ ] **Step 4:** Run test — confirm pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
  git commit -m "feat(db): alexStatsToday query on PrismaConversionRecordStore"
  ```

---

## Task 10: Wire `agentsToday.alex` end-to-end

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Modify: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`
- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/use-console-data.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Extend `DashboardStores`:

  ```ts
  alexStatsToday: (
    orgId: string,
    day: Date,
  ) => Promise<{ repliedToday: number; qualifiedToday: number; bookedToday: number }>;
  ```

  Update `makeStores` default in test harness to return zeros.

- [ ] **Step 2:** Add a builder test.

  ```ts
  it("populates agentsToday.alex from alexStatsToday", async () => {
    const alexStatsToday = vi
      .fn()
      .mockResolvedValue({ repliedToday: 14, qualifiedToday: 6, bookedToday: 3 });
    const result = await buildDashboardOverview("org-1", makeStores({ alexStatsToday }), "USD");
    expect(result.agentsToday.alex).toEqual({
      repliedToday: 14,
      qualifiedToday: 6,
      bookedToday: 3,
    });
  });
  ```

  Note: agentsToday.alex is only populated if Alex's module is enabled. The dashboard-overview endpoint doesn't know about module enablement — that lives in `useModuleStatus` on the client. So the API always populates `agentsToday.alex` (when there's data) and the Console mapper decides whether to render based on its own `useModuleStatus` read. Tier B blocks (nova/mira) stay null at the API for C1 because their data sources don't exist yet.

- [ ] **Step 3:** Update the builder. Inside `Promise.all` add `stores.alexStatsToday(orgId, todayStart)`. Replace `agentsToday.alex: null` with `agentsToday.alex: alexToday` (binding the result).

- [ ] **Step 4:** Wire into the Fastify plugin: `alexStatsToday: (id, day) => conversionStore.alexStatsToday(id, day)`.

- [ ] **Step 5:** Run API tests — confirm pass.

- [ ] **Step 6:** Update the dashboard mapper. Open `console-mappers.ts`, locate `mapAgents`. Update its input to accept the API stats:

  ```ts
  export type AgentsInput = {
    modules: ModuleEnablementMap;
    alex: { repliedToday: number; qualifiedToday: number; bookedToday: number } | null;
    nova: { draftsPending: number } | null;
    mira: { inFlight: number; winningHook: string | null } | null;
    todaySpend: { amount: number; currency: string } | null;
  };

  export function mapAgents(input: AgentsInput): AgentStripEntry[] {
    const activeKey: AgentKey = input.modules.nova ? "nova" : input.modules.alex ? "alex" : "mira";
    return (
      [
        { key: "alex", name: "Alex", href: "/conversations", label: "view conversations →" },
        { key: "nova", name: "Nova", href: "/modules/ad-optimizer", label: "view ad actions →" },
        { key: "mira", name: "Mira", href: "/modules/creative", label: "view creative →" },
      ] as const
    ).map((a) => {
      const enabled = input.modules[a.key];
      let primaryStat = "—";
      let subStat: RichText = ["—"];
      if (a.key === "alex" && enabled && input.alex) {
        primaryStat = `${input.alex.repliedToday} replied`;
        subStat = [
          `${input.alex.qualifiedToday} qualified · `,
          { bold: `${input.alex.bookedToday} booked` },
        ];
      } else if (a.key === "nova" && enabled && input.nova) {
        // Reads today.spend (not a duplicate field on agentsToday.nova) — by design.
        primaryStat = input.todaySpend
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: input.todaySpend.currency, maximumFractionDigits: 0 }).format(input.todaySpend.amount)
          : "—";
        subStat = [`${input.nova.draftsPending} drafts pending`];
      } else if (a.key === "mira" && enabled && input.mira) {
        primaryStat = `${input.mira.inFlight} in flight`;
        subStat = input.mira.winningHook ? [{ bold: input.mira.winningHook }, " hook winning"] : ["—"];
      } else if (!enabled) {
        primaryStat = "Hire " + a.name;
        subStat = ["module disabled"];
      } else {
        primaryStat = "pending option C2";
      }
      return {
        key: a.key,
        name: a.name,
        primaryStat,
        subStat,
        viewLink: enabled ? { label: a.label, href: a.href } : { label: "", href: a.href },
        active: a.key === activeKey && enabled,
      };
    });
  }
  ```

- [ ] **Step 7:** Update `mapConsoleData`'s input to include `alex` / `nova` / `mira` / `todaySpend` and forward them. Update `useConsoleData` to pass:

  ```ts
  const data = mapConsoleData({
    // ...existing,
    alex: overview.data.agentsToday.alex,
    nova: overview.data.agentsToday.nova,
    mira: overview.data.agentsToday.mira,
    todaySpend: overview.data.today.spend.updatedAt === null
      ? null
      : { amount: overview.data.today.spend.amount, currency: overview.data.today.spend.currency },
  });
  ```

- [ ] **Step 8:** Update the existing `mapAgents` tests in `console-mappers.test.ts` to pass the new input shape, and add new tests:

  ```ts
  describe("mapAgents — Alex cell (option C1)", () => {
    const base = {
      modules: { alex: true, nova: true, mira: true },
      nova: null,
      mira: null,
      todaySpend: null,
    } as const;

    it("renders Alex's today-stats from agentsToday.alex when module enabled and data present", () => {
      const result = mapAgents({
        ...base,
        alex: { repliedToday: 14, qualifiedToday: 6, bookedToday: 3 },
      });
      const alex = result.find((a) => a.key === "alex");
      expect(alex?.primaryStat).toBe("14 replied");
      expect(JSON.stringify(alex?.subStat)).toContain("6 qualified");
      expect(JSON.stringify(alex?.subStat)).toContain("3 booked");
    });

    it("renders 'Hire Alex' when module is disabled", () => {
      const result = mapAgents({
        ...base,
        modules: { alex: false, nova: true, mira: true },
        alex: null,
      });
      const alex = result.find((a) => a.key === "alex");
      expect(alex?.primaryStat).toBe("Hire Alex");
      expect(alex?.active).toBe(false);
    });

    it("renders 'pending option C2' for Nova/Mira when module enabled but stats null", () => {
      const result = mapAgents({ ...base, alex: null });
      const nova = result.find((a) => a.key === "nova");
      const mira = result.find((a) => a.key === "mira");
      expect(nova?.primaryStat).toBe("pending option C2");
      expect(mira?.primaryStat).toBe("pending option C2");
    });
  });
  ```

  Update the existing `mapAgents` tests that asserted `primaryStat === "pending option C"` to either pass `alex: null` (preserves the pending case) or assert the new "Hire X" / "X replied" output.

- [ ] **Step 9:** Run dashboard tests — confirm pass.

- [ ] **Step 10:** Commit.

  ```bash
  git add apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts apps/dashboard/src/components/console
  git commit -m "feat(dashboard,api): wire agentsToday.alex end-to-end + minimal Hire-X inactive treatment"
  ```

---

## Task 11: Add `PrismaCreativeJobStore.stageProgressByApproval`

**Pre-investigation:** Before writing any code, verify how creative-pipeline approvals are linked to creative jobs in the current data model.

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts` (or create)

- [ ] **Step 1:** Investigate the join. Run:

  ```bash
  grep -nE "creative|stageOutputs|approvalId" packages/db/src/stores/prisma-creative-job-store.ts | head -20
  grep -rnE "ApprovalRecord|riskCategory.*creative|creative.*approval" packages/creative-pipeline/src --include="*.ts" 2>/dev/null | head -10
  grep -nE "model ApprovalRecord|request\s+Json|envelopeId" packages/db/prisma/schema.prisma | head -10
  ```

  Find the column that links an `ApprovalRecord` to a `CreativeJob`. Likely candidates:
  - `ApprovalRecord.envelopeId` matches some field on the creative job (e.g., `actionEnvelopeId` if creative-pipeline uses platform ingress)
  - The link lives inside the `request: Json` blob (`request.entityId` or `request.jobId`)

  **Decision branch:**
  - If a clean foreign-key column exists: implement `stageProgressByApproval(approvalIds: string[])` that joins.
  - If creative-pipeline never produces `ApprovalRecord` rows (it might use Inngest event waits exclusively): the link doesn't exist. In that case, this task becomes a no-op — `stageProgressByApproval` returns an empty Map, and `approvals[].stageProgress` stays undefined for all rows. Document this in the commit message and move on.

- [ ] **Step 2:** Write the test for whichever path applies.

  **If joinable (Path A):**

  ```ts
  it("stageProgressByApproval returns a Map of approvalId → StageProgress for creative-pipeline approvals", async () => {
    const orgId = "org-cp";
    const job = await prisma.creativeJob.create({
      data: {
        id: "job-1",
        taskId: "task-1",
        organizationId: orgId,
        deploymentId: "dep-1",
        productDescription: "x",
        targetAudience: "y",
        platforms: ["meta"],
        currentStage: "hooks",
      },
    });
    const approval = await prisma.approvalRecord.create({
      data: {
        id: "apr-1",
        envelopeId: "env-1",
        organizationId: orgId,
        request: { jobId: job.id },  // ← whichever join column
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    const store = new PrismaCreativeJobStore(prisma);
    const result = await store.stageProgressByApproval([approval.id]);
    expect(result.size).toBe(1);
    const progress = result.get(approval.id);
    expect(progress?.stageIndex).toBe(1);     // "hooks" is index 1 in STAGE_ORDER
    expect(progress?.stageTotal).toBe(5);
    expect(progress?.stageLabel).toBe("hooks");
    expect(progress?.closesAt).toBe(approval.expiresAt.toISOString());
  });

  it("stageProgressByApproval returns an empty Map when no approvals match", async () => {
    const store = new PrismaCreativeJobStore(prisma);
    const result = await store.stageProgressByApproval(["does-not-exist"]);
    expect(result.size).toBe(0);
  });
  ```

  **If not joinable (Path B):**

  ```ts
  it("stageProgressByApproval returns an empty Map (no link between ApprovalRecord and CreativeJob in current schema)", async () => {
    const store = new PrismaCreativeJobStore(prisma);
    const result = await store.stageProgressByApproval(["any-id"]);
    expect(result.size).toBe(0);
  });
  ```

- [ ] **Step 3:** Run test — confirm fail.

- [ ] **Step 4:** Implement. Add to `PrismaCreativeJobStore`:

  ```ts
  // Mirror packages/creative-pipeline/src/stages/run-stage.ts:45 (cannot import — separate package).
  // Update both if the canonical list changes.
  private static readonly STAGE_ORDER = ["trends", "hooks", "scripts", "storyboard", "production"] as const;

  async stageProgressByApproval(
    approvalIds: string[],
  ): Promise<Map<string, { stageIndex: number; stageTotal: number; stageLabel: string; closesAt: string | null }>> {
    if (approvalIds.length === 0) return new Map();
    // Path A — join via request.jobId. Adapt selector if the actual join column differs.
    const approvals = await this.prisma.approvalRecord.findMany({
      where: { id: { in: approvalIds } },
      select: { id: true, request: true, expiresAt: true },
    });

    const jobIds = approvals
      .map((a) => (a.request as { jobId?: string } | null)?.jobId)
      .filter((j): j is string => typeof j === "string");

    if (jobIds.length === 0) return new Map();

    const jobs = await this.prisma.creativeJob.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, currentStage: true },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const result = new Map<string, { stageIndex: number; stageTotal: number; stageLabel: string; closesAt: string | null }>();
    for (const approval of approvals) {
      const jobId = (approval.request as { jobId?: string } | null)?.jobId;
      if (!jobId) continue;
      const job = jobById.get(jobId);
      if (!job) continue;
      const stages = PrismaCreativeJobStore.STAGE_ORDER as readonly string[];
      const idx = stages.indexOf(job.currentStage);
      if (idx < 0) continue;
      result.set(approval.id, {
        stageIndex: idx,
        stageTotal: stages.length,
        stageLabel: job.currentStage,
        closesAt: approval.expiresAt.toISOString(),
      });
    }
    return result;
  }
  ```

  If Path B (no join column), implement as `return new Map();` and skip the body.

- [ ] **Step 5:** Run test — confirm pass.

- [ ] **Step 6:** Commit.

  ```bash
  git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
  git commit -m "feat(db): stageProgressByApproval query on PrismaCreativeJobStore"
  ```

---

## Task 12: Wire `approvals[].stageProgress` end-to-end

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Modify: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`
- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Extend `DashboardStores`:

  ```ts
  stageProgressByApproval: (
    approvalIds: string[],
  ) => Promise<
    Map<string, { stageIndex: number; stageTotal: number; stageLabel: string; closesAt: string | null }>
  >;
  ```

  Default in `makeStores`: `vi.fn().mockResolvedValue(new Map())`.

- [ ] **Step 2:** Add a builder test.

  ```ts
  it("populates approvals[].stageProgress from stageProgressByApproval map", async () => {
    const stageProgressByApproval = vi.fn(async (ids: string[]) => {
      const m = new Map();
      if (ids.includes("apr-1")) {
        m.set("apr-1", { stageIndex: 1, stageTotal: 5, stageLabel: "hooks", closesAt: "2026-05-02T08:00:00.000Z" });
      }
      return m;
    });
    const queryApprovals = vi.fn().mockResolvedValue([
      {
        request: {
          id: "apr-1",
          summary: "Campaign 01",
          riskCategory: "creative",
          bindingHash: "h1",
          createdAt: new Date(),
        },
        envelopeId: "env-1",
        state: { status: "pending" },
      },
    ]);
    const result = await buildDashboardOverview(
      "org-1",
      makeStores({ stageProgressByApproval, queryApprovals }),
      "USD",
    );
    expect(result.approvals[0].stageProgress).toEqual({
      stageIndex: 1,
      stageTotal: 5,
      stageLabel: "hooks",
      closesAt: "2026-05-02T08:00:00.000Z",
    });
  });

  it("approvals[].stageProgress is undefined when not found in the map", async () => {
    const queryApprovals = vi.fn().mockResolvedValue([
      {
        request: {
          id: "apr-2",
          summary: "Generic",
          riskCategory: "high",
          bindingHash: "h2",
          createdAt: new Date(),
        },
        envelopeId: "env-2",
        state: { status: "pending" },
      },
    ]);
    const result = await buildDashboardOverview("org-1", makeStores({ queryApprovals }), "USD");
    expect(result.approvals[0].stageProgress).toBeUndefined();
  });
  ```

- [ ] **Step 3:** Run test — confirm fail.

- [ ] **Step 4:** Update the builder. After computing `approvals` (from the existing filter+map block), call the new store and merge:

  ```ts
  const approvalIds = approvals.map((a) => a.id);
  const stageMap = await stores.stageProgressByApproval(approvalIds);
  for (const a of approvals) {
    const sp = stageMap.get(a.id);
    if (sp) (a as { stageProgress?: typeof sp }).stageProgress = sp;
  }
  ```

  (Use a typed helper or a separate `.map(a => ({ ...a, stageProgress: stageMap.get(a.id) }))` if you prefer immutability — same effect.)

- [ ] **Step 5:** Wire into the Fastify plugin: `stageProgressByApproval: (ids) => creativeJobStore.stageProgressByApproval(ids)`. Add `PrismaCreativeJobStore` to the dynamic import.

- [ ] **Step 6:** Run API tests — confirm pass.

- [ ] **Step 7:** Update `mapApprovalGateCard` in `console-mappers.ts`:

  ```ts
  export type ApprovalApiRow = {
    id: string;
    summary: string;
    riskContext: string | null;
    riskCategory: string;
    createdAt: string;
    stageProgress?: { stageIndex: number; stageTotal: number; stageLabel: string; closesAt: string | null };
  };

  export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
    const sp = row.stageProgress;
    return {
      kind: "approval_gate",
      id: row.id,
      agent: "mira",
      jobName: row.summary,
      timer: {
        stageLabel: sp?.stageLabel ?? row.riskContext?.trim() ?? "Approval needed",
        ageDisplay: formatAge(row.createdAt, now),
      },
      stageProgress: sp ? `Stage ${sp.stageIndex + 1} of ${sp.stageTotal}` : "—",
      stageDetail: row.riskContext?.trim() ?? sp?.stageLabel ?? "",
      countdown: sp?.closesAt ? formatCountdown(sp.closesAt, now) : "—",
      primary: { label: "Review →" },
      stop: { label: "Stop campaign" },
    };
  }

  function formatCountdown(closesAt: string, now: Date): string {
    const ms = new Date(closesAt).getTime() - now.getTime();
    if (ms <= 0) return "expired";
    const totalMin = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (hours === 0) return `${min}m left`;
    if (hours < 24) return `${hours}h ${min}m left`;
    const days = Math.floor(hours / 24);
    return `${days}d left`;
  }
  ```

- [ ] **Step 8:** Add mapper tests:

  ```ts
  describe("mapApprovalGateCard with stageProgress (option C1)", () => {
    it("renders 'Stage 2 of 5' + countdown when stageProgress is present", () => {
      const now = new Date("2026-05-01T10:00:00Z");
      const card = mapApprovalGateCard(
        {
          id: "apr-1",
          summary: "Campaign 01",
          riskContext: null,
          riskCategory: "creative",
          createdAt: "2026-05-01T08:00:00Z",
          stageProgress: {
            stageIndex: 1,
            stageTotal: 5,
            stageLabel: "hooks",
            closesAt: "2026-05-02T10:00:00Z",
          },
        },
        now,
      );
      expect(card.stageProgress).toBe("Stage 2 of 5");
      expect(card.timer.stageLabel).toBe("hooks");
      expect(card.countdown).toBe("24h 0m left");
    });

    it("falls back to '—' stage + countdown when stageProgress is absent (option-B behavior preserved)", () => {
      const card = mapApprovalGateCard(
        {
          id: "apr-2",
          summary: "Generic",
          riskContext: "Hooks ready",
          riskCategory: "creative",
          createdAt: "2026-05-01T08:00:00Z",
        },
        new Date("2026-05-01T10:00:00Z"),
      );
      expect(card.stageProgress).toBe("—");
      expect(card.countdown).toBe("—");
    });
  });
  ```

- [ ] **Step 9:** Update `useConsoleData` — the approval rows from `overview.data.approvals` already carry `stageProgress`. No mapping change needed in the hook composer; just make sure the type passes through. Verify by reading the existing `approvalRows` cast.

- [ ] **Step 10:** Run dashboard tests — confirm pass.

- [ ] **Step 11:** Commit.

  ```bash
  git add apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts apps/dashboard/src/components/console
  git commit -m "feat(dashboard,api): wire approvals[].stageProgress end-to-end (creative-pipeline approvals only)"
  ```

---

## Task 13: Add structured `agent: AgentKey | null` to `TranslatedActivity` and the builder

**Files:**

- Modify: `apps/api/src/services/activity-translator.ts`
- Modify or Create: `apps/api/src/services/__tests__/activity-translator.test.ts`
- Modify: `apps/api/src/routes/dashboard-overview.ts`
- Modify: `apps/api/src/__tests__/dashboard-overview-builder.test.ts`

- [ ] **Step 1:** Add tests for `resolveAgentKey`. If no test file exists, create one:

  ```ts
  // apps/api/src/services/__tests__/activity-translator.test.ts
  import { describe, it, expect } from "vitest";
  import { resolveAgentKey, translateActivity, type RawAuditEntry } from "../activity-translator.js";

  function entry(overrides: Partial<RawAuditEntry> = {}): RawAuditEntry {
    return {
      id: "a-1",
      eventType: "action.executed",
      timestamp: "2026-05-01T10:00:00Z",
      actorType: "agent",
      actorId: "alex",
      entityType: "x",
      entityId: "y",
      summary: "did a thing",
      snapshot: {},
      ...overrides,
    };
  }

  describe("resolveAgentKey", () => {
    it("returns 'alex' for actorType=agent + actorId starting with alex", () => {
      expect(resolveAgentKey(entry({ actorType: "agent", actorId: "alex" }))).toBe("alex");
      expect(resolveAgentKey(entry({ actorType: "agent", actorId: "alex_456" }))).toBe("alex");
    });
    it("returns 'nova' for actorId nova / nova-anything", () => {
      expect(resolveAgentKey(entry({ actorType: "agent", actorId: "nova" }))).toBe("nova");
    });
    it("returns 'mira' for actorId mira", () => {
      expect(resolveAgentKey(entry({ actorType: "agent", actorId: "mira" }))).toBe("mira");
    });
    it("returns null for system actor", () => {
      expect(resolveAgentKey(entry({ actorType: "system", actorId: "" }))).toBeNull();
    });
    it("returns null for owner / operator (these are the human, not an agent)", () => {
      expect(resolveAgentKey(entry({ actorType: "owner", actorId: "u-1" }))).toBeNull();
      expect(resolveAgentKey(entry({ actorType: "operator", actorId: "u-1" }))).toBeNull();
    });
    it("returns null for an unknown agent actorId (not Alex/Nova/Mira)", () => {
      expect(resolveAgentKey(entry({ actorType: "agent", actorId: "unknown" }))).toBeNull();
    });
  });

  describe("translateActivity carries the structured agent field", () => {
    it("attaches agent='alex' for an Alex-actor entry", () => {
      const t = translateActivity(entry({ actorType: "agent", actorId: "alex" }));
      expect(t.agent).toBe("alex");
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm fail (`resolveAgentKey` doesn't exist).

- [ ] **Step 3:** Implement. Update `apps/api/src/services/activity-translator.ts`:

  ```ts
  import type { AgentKey } from "@switchboard/schemas";

  export interface TranslatedActivity {
    id: string;
    type: string;
    description: string;
    dotColor: "green" | "amber" | "blue" | "gray";
    createdAt: string;
    /** NEW: structured agent attribution. null for non-agent actors and unknown agent ids. */
    agent: AgentKey | null;
  }

  /**
   * Returns the structured agent key for an audit entry, or null when the entry
   * isn't attributable to one of our named agents (Alex/Nova/Mira).
   * Non-agent actors (owner/operator/system) always return null.
   */
  export function resolveAgentKey(entry: RawAuditEntry): AgentKey | null {
    if (entry.actorType !== "agent") return null;
    const id = (entry.actorId ?? "").toLowerCase();
    if (id.startsWith("alex")) return "alex";
    if (id.startsWith("nova")) return "nova";
    if (id.startsWith("mira")) return "mira";
    return null;
  }

  export function translateActivity(entry: RawAuditEntry): TranslatedActivity {
    return {
      id: entry.id,
      type: entry.eventType,
      description: buildDescription(entry),
      dotColor: resolveDotColor(entry.eventType),
      createdAt: entry.timestamp,
      agent: resolveAgentKey(entry),
    };
  }
  ```

- [ ] **Step 4:** Run tests — confirm pass.

- [ ] **Step 5:** Update the builder to drop the `.map((a) => ({ ...a, agent: null }))` shim added in Task 4. The translator now sets `agent` directly:

  ```ts
  const activity = translateActivities(auditEntries, 8);  // no extra map
  ```

- [ ] **Step 6:** Add a builder test asserting `activity[].agent` flows through.

  ```ts
  it("propagates structured agent attribution from translator to activity[]", async () => {
    const queryAudit = vi.fn().mockResolvedValue([
      { id: "1", eventType: "action.executed", timestamp: "2026-05-01T10:00:00Z", actorType: "agent", actorId: "alex", entityType: "x", entityId: "y", summary: "did a thing", snapshot: {} },
      { id: "2", eventType: "action.executed", timestamp: "2026-05-01T10:01:00Z", actorType: "system", actorId: "", entityType: "x", entityId: "y", summary: "tick", snapshot: {} },
    ]);
    const result = await buildDashboardOverview("org-1", makeStores({ queryAudit }), "USD");
    expect(result.activity[0].agent).toBe("alex");
    expect(result.activity[1].agent).toBeNull();
  });
  ```

- [ ] **Step 7:** Run API tests — confirm pass.

- [ ] **Step 8:** Commit.

  ```bash
  git add apps/api/src/services/activity-translator.ts apps/api/src/services/__tests__/activity-translator.test.ts apps/api/src/routes/dashboard-overview.ts apps/api/src/__tests__/dashboard-overview-builder.test.ts
  git commit -m "feat(api): structured AgentKey attribution on activity rows (option C1)"
  ```

---

## Task 14: Update `mapActivity` to read the structured agent field; remove option-B's synth helper

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`
- Modify: `apps/dashboard/src/components/console/use-console-data.ts`

- [ ] **Step 1:** Update the `AuditEntry` mapper-input type in `console-mappers.ts` to carry the API-side agent field:

  ```ts
  export type AuditEntry = {
    id: string;
    action: string;       // existing — comes from `entry.type` on the API side, kept for compatibility
    actorId: string | null;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
    /** NEW: structured agent attribution from the API (option C1). */
    agent: AgentKey | null;
  };
  ```

- [ ] **Step 2:** Replace `mapActivity` body:

  ```ts
  export function mapActivity(entries: AuditEntry[]): { moreToday: number; rows: ActivityRow[] } {
    const now = new Date();
    const todayEntries = entries.filter((e) => isToday(e.createdAt, now));
    const displayed = entries.slice(0, 9);
    const moreToday = Math.max(0, todayEntries.length - displayed.length);
    const rows: ActivityRow[] = displayed.map((e) => ({
      id: e.id,
      time: formatHHMM(e.createdAt),
      // Read the structured field. Fallback to "system" preserves the option-B render shape for null agents.
      agent: e.agent ?? "system",
      message: [e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")],
    }));
    return { moreToday, rows };
  }
  ```

  **Delete** the option-B `agentForAction(action, actorId)` helper from this file. It's now dead code.

- [ ] **Step 3:** Update `useConsoleData` to forward `agent`:

  ```ts
  const auditEntries: AuditEntry[] = (audit.entries ?? []).map((e) => ({
    id: e.id,
    action: e.type,
    actorId: e.actorId ?? null,
    createdAt: e.createdAt,
    agent: e.agent ?? null,
  })) as AuditEntry[];
  ```

  Note: `useAudit().entries` shape needs to expose `e.agent` and `e.type`. If it doesn't, this is the point to widen the audit hook's type — typically a 2-line change in `apps/dashboard/src/hooks/use-audit.ts` to forward the new field.

- [ ] **Step 4:** Update the existing `mapActivity` tests in `console-mappers.test.ts` — pass the new `agent` field on each fixture entry:

  ```ts
  // Before:
  // { id: "1", action: "alex.replied", actorId: "agent:alex", createdAt: "..." }
  // After:
  // { id: "1", action: "alex.replied", actorId: "agent:alex", createdAt: "...", agent: "alex" }
  ```

  Add a new test asserting null-agent fallback:

  ```ts
  it("renders 'system' for entries with agent=null", () => {
    const result = mapActivity([
      { id: "x", action: "tick", actorId: null, createdAt: "2026-05-01T10:00:00Z", agent: null },
    ]);
    expect(result.rows[0].agent).toBe("system");
  });
  ```

- [ ] **Step 5:** Run dashboard tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

- [ ] **Step 6:** Commit.

  ```bash
  git add apps/dashboard/src/components/console
  git commit -m "feat(dashboard): mapActivity reads structured AgentKey from API; drop option-B synth helper"
  ```

---

## Task 15: Manual verification + final sweep

**Files:** none modified.

- [ ] **Step 1:** Reset + build + test the full monorepo.

  ```bash
  cd /Users/jasonli/switchboard
  pnpm reset
  pnpm typecheck && pnpm lint && pnpm test
  ```

  Expected: all green. The dashboard test count should be `316 + ~12` (the new C1 mapper + view tests).

- [ ] **Step 2:** Run the dev stack against a seeded org:

  ```bash
  pnpm --filter @switchboard/api dev   # background, port 3000
  pnpm --filter @switchboard/dashboard dev   # foreground, port 3002
  ```

- [ ] **Step 3:** Visit `http://localhost:3002/console` in a browser. Verify:
  - **Numbers strip:** Revenue cell shows `$X` from real revenue today + `±X% vs avg` delta. Leads cell unchanged from B. Appointments cell unchanged from B. Reply Time shows `Xs` if any conversation has firstReplyAt today, else muted `—`. Spend stays muted `—` italic ("pending").
  - **Queue:** approval-gate cards (creative-risk) show `Stage X of Y` + countdown like `12h 30m left`. Other approvals (non-creative) keep the option-B `—` fallback.
  - **Agents strip:** Alex cell shows `N replied` + `N qualified · N booked` from real data. If the chat-replies module is disabled, Alex cell shows `Hire Alex`. Nova + Mira cells show `pending option C2` (or `Hire X` if their modules are disabled).
  - **Activity:** rows show `ALEX` / `NOVA` / `MIRA` / `SYSTEM` agent labels from the structured field — no synthesized prefix string parsing.

- [ ] **Step 4:** Stop the dev servers. Push.

  ```bash
  git push -u origin feat/console-option-c
  ```

- [ ] **Step 5:** Open a PR to `main`.

  ```bash
  gh pr create --base main --title "feat(dashboard): option C1 — DashboardOverview Tier A schema extensions" --body "$(cat <<'EOF'
  ## Summary

  Implements [option C1](../docs/superpowers/specs/2026-05-01-console-option-c-schema-extensions-design.md#c1--tier-a-data-already-exists) — extends `DashboardOverview` with the namespaced `today.*` + `agentsToday.*` blocks, adds inline `approvals[].stageProgress`, and adds structured `activity[].agent: AgentKey | null`.

  Tier A (this PR) lights up real data for: Revenue cell, Reply Time cell, Alex's today-stats, approval-gate stage progress, structured activity-agent attribution. Tier B fields (`today.spend`, `agentsToday.{nova,mira}`, `novaAdSets`) ship as schema-shaped placeholders that mute via `updatedAt = null`; C2 lights them up.

  ## Schema migration

  - Moved `stats.newInquiriesToday/Yesterday` and `stats.bookingsToday` into `today.{leads, appointments}` (no backwards-compat keys per `CLAUDE.md`).
  - Added `today` block (revenue, spend, replyTime, leads, appointments).
  - Added `agentsToday` block (alex/nova/mira, each nullable ⇔ module disabled).
  - Added `novaAdSets: AdSetRow[]`.
  - Added `approvals[].stageProgress?` (optional, only on creative-pipeline approvals).
  - Added `activity[].agent: AgentKey | null`.
  - Added `STALE_AFTER_MINUTES` constant + `AgentKey`, `AdSetRow`, `StageProgress` types.

  ## Test plan

  - [x] `pnpm typecheck` passes
  - [x] `pnpm test` passes (~328 dashboard, +new schema/api/db tests)
  - [x] `/console` against a seeded org renders Revenue / Reply Time / Alex stats / stage progress / structured agent labels
  - [x] Spend cell + Nova / Mira cells stay muted

  ## Out of scope (option C2)

  Spend rollup tables (`AdSpendDaily`, `AdSetDailyMetrics`), the `syncTodayAdMetrics` Inngest job, Nova-panel ad-set rows, Mira's in-flight stats, Nova's draftsPending count.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

  Expected: PR URL printed.

---

## Self-review checklist (done by plan author 2026-05-01)

- **Spec coverage:** Each spec section maps to a task.
  - Schema additions (today/agentsToday/novaAdSets/stageProgress/activity.agent) → Tasks 2, 3.
  - Migration of stats fields → Task 3.
  - Central time helpers (single source of truth for day boundaries) → Task 2.5.
  - Builder rewrite + staleness scaffold → Task 4.
  - Tier A field wiring (revenue, replyTime, alexStats, stageProgress, activity.agent) → Tasks 6, 7+8, 9+10, 11+12, 13+14.
  - Small-sample guard (`MIN_REPLY_SAMPLE = 3`) → Task 8.
  - Mapper rewires → Tasks 5, 6, 8, 10, 12, 14.
  - Tier B placeholder shape → Task 4 (sets the zero/null values).
  - Manual verification → Task 15.

- **Placeholder scan:** No "TBD" / "TODO". The Path A vs Path B split in Task 11 is conditional logic, not a placeholder — both paths have full code.

- **Type consistency:** `MapConsoleInput`, `NumbersInput`, `AgentsInput`, `AuditEntry` all extended through tasks 5/6/8/10/14 with concrete shapes. `AgentKey` defined in Task 2 and consumed in Tasks 13 + 14. `StageProgress` defined in Task 2 and consumed in Tasks 11 + 12.

- **Risk:** Task 7 may need a `createdAt` column added to `ConversationState` — Step 5 of that task includes the migration recipe. Task 11's join column is conditional on actual data — it includes both Path A (joinable) and Path B (no link) implementations.

- **External dependencies:** PR #328 must merge first (Task 1 Step 1 verifies). Once merged, this plan is fully self-contained against `main`.
