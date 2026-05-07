# Slice B PR-S3 — B3 Recent Wins live (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alex's and Riley's agent-home **Recent Wins** block render live data from `PendingActionRecord`, with per-agent voice in win prose and an Undo affordance that respects `undoableUntil` — replacing the PR-S1 fixture flow.

**Architecture:** One vertical slice + one targeted store extension. Bottom-up: `PrismaRecommendationStore.listResolvedForAgent` → core helpers (`window.ts`, `time-folio.ts`) → core projection (`wins.ts`) → api route → dashboard proxy → live hook → `dispatch-action.ts` undo branch → `useUndoWin` → `WinsBlock` undo UI → fixture cleanup. No schema migrations.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), pnpm + Turborepo monorepo, Vitest, Fastify (api), Next.js App Router (dashboard), TanStack React Query, Prisma, RTL (component tests).

**Spec:** `docs/superpowers/specs/2026-05-07-slice-b-pr-s3-design.md` (PR #377). Locked decisions in spec §2 are not open for re-litigation.

**Branch:** `feat/slice-b-pr-s3` off `origin/main` (worktree at `/Users/jasonli/switchboard-worktrees/feat-slice-b-pr-s3`).

---

## File map (locked)

**Created**

| Path                                                                                 | Responsibility                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `packages/core/src/agent-home/window.ts`                                             | `computeWindowStart(window, now, timezone): Date` (today/week/month, tz-aware) |
| `packages/core/src/agent-home/__tests__/window.test.ts`                              | Tests for window helper                                                        |
| `packages/core/src/agent-home/time-folio.ts`                                         | `formatTimeFolio(occurredAt, now, timezone): string`                           |
| `packages/core/src/agent-home/__tests__/time-folio.test.ts`                          | Tests for formatter                                                            |
| `packages/core/src/agent-home/wins.ts`                                               | `projectWins`, types, `WinsSignalStore`, `AGENT_VOICE_CONFIGS`                 |
| `packages/core/src/agent-home/__tests__/wins.test.ts`                                | Tests for projection                                                           |
| `apps/api/src/routes/agent-home/wins.ts`                                             | `GET /api/dashboard/agents/:agentId/wins?window=…`                             |
| `apps/api/src/routes/agent-home/__tests__/wins.test.ts`                              | Mocked-Prisma route tests                                                      |
| `apps/api/src/__tests__/api-agent-home-wins-isolation.test.ts`                       | Cross-org isolation                                                            |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts`                | Proxy → api                                                                    |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/__tests__/route.test.ts` | Proxy tests                                                                    |
| `apps/dashboard/src/hooks/use-undo-win.ts`                                           | Wrapper that calls `dispatchDecisionAction(..., "undo", …)`                    |
| `apps/dashboard/src/hooks/__tests__/use-undo-win.test.tsx`                           | Hook tests                                                                     |

**Modified**

| Path                                                                          | Change                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/db/src/recommendation-store.ts`                                     | Add `listResolvedForAgent` method                                       |
| `packages/db/src/__tests__/recommendation-store.test.ts` (or equivalent)      | Tests for new method                                                    |
| `packages/core/src/agent-home/index.ts`                                       | Re-export `projectWins`, `formatTimeFolio`, `computeWindowStart`, types |
| `apps/dashboard/src/lib/decisions/dispatch-action.ts`                         | Extend action union with `"undo"`                                       |
| `apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts` (or new) | Add undo-branch test                                                    |
| `apps/dashboard/src/hooks/use-agent-wins.ts`                                  | Fixture form → live form                                                |
| `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx`                  | Replace fixture test with live test                                     |
| `apps/dashboard/src/components/agent-home/wins-block.tsx`                     | Add Undo button + states                                                |
| `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx`      | Cover undo states                                                       |
| `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts`                       | Remove `getFixtureWins` export                                          |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts`         | Remove wins fixture test entry                                          |

---

## Task 0: Worktree setup

**Files:** none yet (env only)

- [ ] **Step 1: Verify origin/main is current and the spec PR has merged or is at least pushed**

```bash
git fetch origin main
git log origin/main --oneline -5
gh pr view 377 --json state,mergedAt -q '.state + " merged=" + (.mergedAt // "no")'
```

Expected: list of recent commits; PR #377 is `OPEN` or `MERGED`. The spec PR doesn't strictly need to be merged before implementation (the spec lives in this implementation worktree only as a reference path), but it should at least exist on origin so future links work.

- [ ] **Step 2: Create worktree off origin/main**

```bash
git worktree add /Users/jasonli/switchboard-worktrees/feat-slice-b-pr-s3 -b feat/slice-b-pr-s3 origin/main
cd /Users/jasonli/switchboard-worktrees/feat-slice-b-pr-s3
```

Expected: new directory at the worktree path; new local branch `feat/slice-b-pr-s3` tracking `origin/main`.

- [ ] **Step 3: Initialize the worktree**

```bash
pnpm worktree:init
```

Expected: `.env` copied from main worktree, `pnpm db:migrate` runs (or skips if Postgres unreachable), no errors. See `scripts/worktree-init.sh`.

- [ ] **Step 4: Confirm baseline build is green**

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
```

Expected: all pass. If typecheck reports stale Prisma types, run `pnpm reset` (CLAUDE.md guidance).

- [ ] **Step 5: Confirm branch and starting state**

```bash
git branch --show-current
git status --short
```

Expected: `feat/slice-b-pr-s3` and clean.

---

## Task 1: `computeWindowStart` helper (core/agent-home/window.ts)

**Files:**

- Create: `packages/core/src/agent-home/window.ts`
- Test: `packages/core/src/agent-home/__tests__/window.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/agent-home/__tests__/window.test.ts
import { describe, expect, it } from "vitest";
import { computeWindowStart } from "../window.js";

describe("computeWindowStart", () => {
  describe("Asia/Singapore (UTC+8)", () => {
    const tz = "Asia/Singapore";
    // 2026-05-07 14:30 SGT = 2026-05-07 06:30 UTC
    const now = new Date("2026-05-07T06:30:00.000Z");

    it("today: returns local midnight", () => {
      const got = computeWindowStart("today", now, tz);
      // 2026-05-07 00:00 SGT = 2026-05-06 16:00 UTC
      expect(got.toISOString()).toBe("2026-05-06T16:00:00.000Z");
    });

    it("week: returns Monday 00:00 local", () => {
      // 2026-05-07 is Thursday; Monday is 2026-05-04
      const got = computeWindowStart("week", now, tz);
      // 2026-05-04 00:00 SGT = 2026-05-03 16:00 UTC
      expect(got.toISOString()).toBe("2026-05-03T16:00:00.000Z");
    });

    it("month: returns first of month 00:00 local", () => {
      const got = computeWindowStart("month", now, tz);
      // 2026-05-01 00:00 SGT = 2026-04-30 16:00 UTC
      expect(got.toISOString()).toBe("2026-04-30T16:00:00.000Z");
    });
  });

  describe("America/New_York (DST-spanning)", () => {
    const tz = "America/New_York";
    // 2026-03-09 10:00 EDT = 2026-03-09 14:00 UTC (day after spring-forward)
    const now = new Date("2026-03-09T14:00:00.000Z");

    it("today after DST spring-forward: midnight is local", () => {
      const got = computeWindowStart("today", now, tz);
      // 2026-03-09 00:00 EDT = 2026-03-09 04:00 UTC
      expect(got.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    });

    it("week spans DST boundary correctly", () => {
      // Monday is 2026-03-09 itself (the spring-forward Sunday is 03-08)
      const got = computeWindowStart("week", now, tz);
      expect(got.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    });
  });

  it("Sunday is treated as part of the prior week (week starts Monday)", () => {
    // 2026-05-10 is Sunday in SGT
    const sunday = new Date("2026-05-10T06:00:00.000Z"); // 14:00 SGT
    const got = computeWindowStart("week", sunday, "Asia/Singapore");
    // Prior Monday = 2026-05-04
    expect(got.toISOString()).toBe("2026-05-03T16:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test -- window.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/agent-home/window.ts

export type WinTimeWindow = "today" | "week" | "month";

/**
 * Returns the absolute timestamp for the start of the requested window in the
 * given IANA timezone. Today = local midnight. Week = Monday 00:00 local.
 * Month = 1st of the month 00:00 local.
 */
export function computeWindowStart(window: WinTimeWindow, now: Date, timezone: string): Date {
  const parts = getDateParts(now, timezone);

  if (window === "today") {
    return localMidnight(parts.year, parts.month, parts.day, timezone);
  }

  if (window === "month") {
    return localMidnight(parts.year, parts.month, 1, timezone);
  }

  // week: walk back to Monday
  const dow = parts.weekday; // 1=Mon..7=Sun
  const daysBack = dow === 7 ? 6 : dow - 1;
  const mondayUTC = Date.UTC(parts.year, parts.month - 1, parts.day) - daysBack * 86_400_000;
  const monday = new Date(mondayUTC);
  const mondayParts = getDateParts(monday, timezone);
  return localMidnight(mondayParts.year, mondayParts.month, mondayParts.day, timezone);
}

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 1=Mon..7=Sun
}

function getDateParts(d: Date, timezone: string): DateParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string],
  };
}

/**
 * Returns the UTC instant corresponding to local midnight on (year, month, day)
 * in the given timezone. Iterative two-pass: convert UTC midnight as a starting
 * guess, then adjust by the offset.
 */
function localMidnight(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = utcGuess.getTime() - parseAsUTC(formatLocalIso(utcGuess, timezone));
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + offsetMs);
}

function formatLocalIso(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
}

function parseAsUTC(iso: string): number {
  return Date.parse(iso);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test -- window.test.ts
```

Expected: all pass. If a DST-edge test fails, the iterative offset calc may need a second-pass correction — re-test by adjusting `localMidnight` to do two passes (compute, recompute with corrected offset). If the test still fails, log `formatLocalIso(utcGuess, timezone)` and the computed offset to diagnose.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/window.ts packages/core/src/agent-home/__tests__/window.test.ts
git commit -m "feat(core): add agent-home computeWindowStart helper

Timezone-aware (today/week/month) start-of-window helper for the wins
projection and (later) metrics projection. Required \`timezone\` argument;
no hidden default."
```

---

## Task 2: `formatTimeFolio` helper

**Files:**

- Create: `packages/core/src/agent-home/time-folio.ts`
- Test: `packages/core/src/agent-home/__tests__/time-folio.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/agent-home/__tests__/time-folio.test.ts
import { describe, expect, it } from "vitest";
import { formatTimeFolio } from "../time-folio.js";

describe("formatTimeFolio (Asia/Singapore)", () => {
  const tz = "Asia/Singapore";
  // Reference: 2026-05-07 (Thu) 14:30 SGT = 2026-05-07T06:30:00Z
  const now = new Date("2026-05-07T06:30:00.000Z");

  it("renders same-day as 12-hour with AM/PM", () => {
    // 2026-05-07 11:42 SGT = 2026-05-07T03:42:00Z
    const t = new Date("2026-05-07T03:42:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("11:42 AM");
  });

  it('renders "Yesterday · h:mm AM/PM" for prior day', () => {
    // 2026-05-06 18:14 SGT = 2026-05-06T10:14:00Z
    const t = new Date("2026-05-06T10:14:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("Yesterday · 6:14 PM");
  });

  it('renders "Wkd · h:mm AM/PM" earlier in the same week (Mon-Sun)', () => {
    // 2026-05-04 (Mon) 09:00 SGT = 2026-05-04T01:00:00Z
    const t = new Date("2026-05-04T01:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("Mon · 9:00 AM");
  });

  it('renders "Mon DD · h:mm AM/PM" for older than this week', () => {
    // 2026-05-03 (Sun, prior week) 11:42 SGT = 2026-05-03T03:42:00Z
    const t = new Date("2026-05-03T03:42:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("May 3 · 11:42 AM");
  });

  it("midnight prints as 12:00 AM", () => {
    // 2026-05-07 00:00 SGT = 2026-05-06T16:00:00Z
    const t = new Date("2026-05-06T16:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("12:00 AM");
  });

  it("noon prints as 12:00 PM", () => {
    // 2026-05-07 12:00 SGT = 2026-05-07T04:00:00Z
    const t = new Date("2026-05-07T04:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("12:00 PM");
  });

  it("respects America/New_York", () => {
    // now: 2026-05-07 02:30 EDT = 2026-05-07T06:30:00Z
    // t:   2026-05-07 01:42 EDT = 2026-05-07T05:42:00Z
    const t = new Date("2026-05-07T05:42:00.000Z");
    expect(formatTimeFolio(t, now, "America/New_York")).toBe("1:42 AM");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test -- time-folio.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/agent-home/time-folio.ts
import { computeWindowStart } from "./window.js";

const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // JS Date.getDay() in tz
const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatTimeFolio(occurredAt: Date, now: Date, timezone: string): string {
  const time = formatHM(occurredAt, timezone);
  const todayStart = computeWindowStart("today", now, timezone);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = computeWindowStart("week", now, timezone);

  if (occurredAt.getTime() >= todayStart.getTime()) return time;
  if (occurredAt.getTime() >= yesterdayStart.getTime()) return `Yesterday · ${time}`;
  if (occurredAt.getTime() >= weekStart.getTime()) {
    const wd = shortWeekday(occurredAt, timezone);
    return `${wd} · ${time}`;
  }
  return `${shortMonthDay(occurredAt, timezone)} · ${time}`;
}

function formatHM(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Intl emits "11:42 AM" with a non-breaking thin space between time and AM/PM
  // on some node versions. Normalize to a regular space.
  return fmt.format(d).replace(/ | /g, " ");
}

function shortWeekday(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  return fmt.format(d); // "Mon"
}

function shortMonthDay(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  return fmt.format(d); // "May 3"
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test -- time-folio.test.ts
```

Expected: all pass. If "11:42 AM" comes back as "11:42 AM" with a non-breaking space, the `.replace` in `formatHM` should normalize — adjust the unicode class if needed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/time-folio.ts packages/core/src/agent-home/__tests__/time-folio.test.ts
git commit -m "feat(core): add formatTimeFolio for agent-home wins

Timezone-aware time-folio renderer per spec §2 Q3:
\"11:42 AM\" / \"Yesterday · 6:14 PM\" / \"Mon · 9:00 AM\" / \"May 3 · 11:42 AM\"."
```

---

## Task 3: `PrismaRecommendationStore.listResolvedForAgent`

**Files:**

- Modify: `packages/db/src/recommendation-store.ts` — add new method
- Modify: `packages/db/src/__tests__/recommendation-store.test.ts` (or create if not present)

- [ ] **Step 1: Locate the existing test file pattern**

```bash
find packages/db/src/__tests__ -name "recommendation*" -o -name "prisma-workflow*"
```

Expected: at least `prisma-workflow-store.test.ts` (mocked-Prisma reference per `feedback_api_test_mocked_prisma.md`). If no `recommendation-store.test.ts` exists, create it; if it exists, append the new tests.

- [ ] **Step 1.5: Confirm DB field names**

```bash
grep -n "sourceAgent\|resolvedAt" packages/db/prisma/schema.prisma | grep -A0 "PendingActionRecord\|model" | head -10
```

The `PendingActionRecord` model should have both `sourceAgent: String` and `resolvedAt: DateTime?`. If the field is named differently in your repo state (e.g. `agentKey`, `source_agent`), substitute everywhere `sourceAgent` appears in this task — including the `where` clause in Step 4.

- [ ] **Step 2: Write failing tests for `listResolvedForAgent`**

Add to `packages/db/src/__tests__/recommendation-store.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaRecommendationStore } from "../recommendation-store.js";

function makePrisma() {
  return {
    pendingActionRecord: {
      findMany: vi.fn(),
    },
  } as unknown as Parameters<(typeof PrismaRecommendationStore)["prototype"]["constructor"]>[0];
}

describe("PrismaRecommendationStore.listResolvedForAgent", () => {
  const prisma = makePrisma() as { pendingActionRecord: { findMany: ReturnType<typeof vi.fn> } };
  const store = new PrismaRecommendationStore(prisma as never);

  beforeEach(() => {
    prisma.pendingActionRecord.findMany.mockReset();
  });

  it("filters by org, sourceAgent, status set, and non-null resolvedAt >= resolvedSince", async () => {
    prisma.pendingActionRecord.findMany.mockResolvedValue([]);
    await store.listResolvedForAgent({
      orgId: "org-1",
      agentKey: "alex",
      statuses: ["acted", "confirmed"],
      resolvedSince: new Date("2026-05-07T00:00:00.000Z"),
      limit: 6,
    });
    expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        sourceAgent: "alex",
        status: { in: ["acted", "confirmed"] },
        resolvedAt: { not: null, gte: new Date("2026-05-07T00:00:00.000Z") },
        intent: { startsWith: "recommendation." },
      }),
      orderBy: { resolvedAt: "desc" },
      take: 6,
    });
  });

  it("caps limit at 200", async () => {
    prisma.pendingActionRecord.findMany.mockResolvedValue([]);
    await store.listResolvedForAgent({
      orgId: "org-1",
      agentKey: "riley",
      statuses: ["acted"],
      resolvedSince: new Date(),
      limit: 9999,
    });
    expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it("returns mapped Recommendation rows", async () => {
    prisma.pendingActionRecord.findMany.mockResolvedValue([
      {
        id: "r1",
        idempotencyKey: "k1",
        intent: "recommendation.send_tour_invite",
        status: "confirmed",
        sourceAgent: "alex",
        organizationId: "org-1",
        humanSummary: "Sent tour invite to Maya",
        confidence: 0.7,
        riskLevel: "low",
        dollarsAtRisk: 0,
        targetEntities: {},
        parameters: {},
        approvalRequired: "operator",
        surface: "queue",
        undoableUntil: new Date("2026-05-07T07:00:00.000Z"),
        resolvedAt: new Date("2026-05-07T06:55:00.000Z"),
        resolvedBy: "user-1",
        createdAt: new Date("2026-05-06T12:00:00.000Z"),
        expiresAt: null,
        sourceWorkflow: null,
        workflowId: null,
        stepIndex: null,
        requiredCapabilities: [],
        dryRunSupported: false,
        fallback: null,
      },
    ]);
    const rows = await store.listResolvedForAgent({
      orgId: "org-1",
      agentKey: "alex",
      statuses: ["acted", "confirmed"],
      resolvedSince: new Date(0),
      limit: 5,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("r1");
    expect(rows[0].agentKey).toBe("alex");
    expect(rows[0].status).toBe("confirmed");
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter @switchboard/db test -- recommendation-store.test.ts
```

Expected: FAIL — `listResolvedForAgent is not a function`.

- [ ] **Step 4: Implement the method**

Edit `packages/db/src/recommendation-store.ts`. Locate `listBySurface` (~line 133) and add immediately after:

```ts
/**
 * Generic store method: filters terminal recommendations by org + agent +
 * any subset of statuses + resolvedAt window. The wins projection narrows
 * `statuses` to ["acted", "confirmed"] at its single call site; do not pass
 * arbitrary statuses from new external callers without thinking about
 * what "win" means in their context.
 */
async listResolvedForAgent(args: {
  orgId: string;
  agentKey: AgentKey;
  statuses: readonly RecommendationStatus[];
  resolvedSince: Date;
  limit: number;
}): Promise<Recommendation[]> {
  // Semantically "resolved wins": rows must have a non-null resolvedAt.
  // We assert `not: null` explicitly even though `gte: <Date>` already
  // excludes nulls in Prisma — explicit beats implicit.
  const rows = await this.prisma.pendingActionRecord.findMany({
    where: {
      organizationId: args.orgId,
      sourceAgent: args.agentKey,
      status: { in: [...args.statuses] },
      resolvedAt: { not: null, gte: args.resolvedSince },
      intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
    },
    orderBy: { resolvedAt: "desc" },
    take: Math.min(args.limit, 200),
  });
  return rows.map(rowToRecommendation);
}
```

Make sure `AgentKey` is imported at the top of the file:

```ts
import type { AgentKey, RecommendationStatus } from "@switchboard/schemas";
```

(If only one is already imported, add the other.)

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter @switchboard/db test -- recommendation-store.test.ts
```

Expected: all pass. If TypeScript complains about `Recommendation` return type mismatch, check `rowToRecommendation`'s signature — it should already accept the same row shape as `listBySurface` returns.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/recommendation-store.ts packages/db/src/__tests__/recommendation-store.test.ts
git commit -m "feat(db): PrismaRecommendationStore.listResolvedForAgent

Push-down filter for agent-home wins block: filters on org +
sourceAgent + status set + resolvedAt, ordered by resolvedAt desc,
capped at 200. Lets the wins endpoint honour limit:5 against the
correct rows without client-side post-filtering."
```

---

## Task 4: Core projection — `wins.ts` types + `projectWins` skeleton

**Files:**

- Create: `packages/core/src/agent-home/wins.ts`
- Test: `packages/core/src/agent-home/__tests__/wins.test.ts`

This task lays down the types, store interface, voice configs, and a minimal `projectWins` that returns an empty list — proving the wiring before adding prose composition (Task 5) and undo logic (Task 6).

- [ ] **Step 1: Write the empty-list passing test**

```ts
// packages/core/src/agent-home/__tests__/wins.test.ts
import { describe, expect, it } from "vitest";
import { projectWins, type WinsSignalStore, type WinTerminalRecord } from "../wins.js";

function inMemoryStore(rows: WinTerminalRecord[]): WinsSignalStore {
  return {
    async listResolvedForAgent({ statuses, limit }) {
      return rows.filter((r) => statuses.includes(r.status)).slice(0, limit);
    },
  };
}

describe("projectWins — skeleton", () => {
  it("returns empty wins list with hasMore=false when no rows", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([]),
    });
    expect(vm.wins).toEqual([]);
    expect(vm.hasMore).toBe(false);
    expect(vm.freshness.dataSource).toBe("live");
    expect(vm.freshness.window).toBe("today");
    expect(vm.freshness.generatedAt).toBe("2026-05-07T06:30:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton with types and minimal projection**

```ts
// packages/core/src/agent-home/wins.ts
import { computeWindowStart, type WinTimeWindow } from "./window.js";
import { formatTimeFolio } from "./time-folio.js";

export type WinSource = "recommendation" | "booking" | "conversion";
export type WinStatus = "acted" | "confirmed";

export interface ProseSegment {
  kind: "text" | "accent";
  text: string;
}

export interface WinTerminalRecord {
  id: string;
  agentKey: "alex" | "riley";
  status: WinStatus;
  intent: string;
  humanSummary: string;
  occurredAt: Date;
  undoableUntil: Date | null;
  targetEntities: unknown;
}

export interface WinsSignalStore {
  listResolvedForAgent(input: {
    orgId: string;
    agentKey: "alex" | "riley";
    statuses: readonly WinStatus[];
    resolvedSince: Date;
    limit: number;
  }): Promise<WinTerminalRecord[]>;
}

export interface WinViewModel {
  id: string;
  agentKey: "alex" | "riley";
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

export interface DataFreshness {
  generatedAt: string;
  window: WinTimeWindow;
  dataSource: "live" | "fixture";
  isPartial?: boolean;
  unavailableSources?: readonly string[];
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

export interface WinsAgentConfig {
  agentKey: "alex" | "riley";
  ackPhrase: string;
}

const AGENT_VOICE_CONFIGS: Record<"alex" | "riley", WinsAgentConfig> = {
  alex: { agentKey: "alex", ackPhrase: "Sent." },
  riley: { agentKey: "riley", ackPhrase: "Adjusted." },
};

export interface ProjectWinsInput {
  orgId: string;
  agentKey: "alex" | "riley";
  window: WinTimeWindow;
  now: Date;
  timezone: string;
  store: WinsSignalStore;
}

const VISIBLE_LIMIT = 5;

export async function projectWins(input: ProjectWinsInput): Promise<WinsViewModel> {
  const { orgId, agentKey, window, now, timezone, store } = input;
  const resolvedSince = computeWindowStart(window, now, timezone);
  const rows = await store.listResolvedForAgent({
    orgId,
    agentKey,
    statuses: ["acted", "confirmed"],
    resolvedSince,
    limit: VISIBLE_LIMIT + 1,
  });

  const visible = rows.slice(0, VISIBLE_LIMIT);
  const config = AGENT_VOICE_CONFIGS[agentKey];

  return {
    wins: visible.map((row) => buildWinViewModel(row, config, now, timezone)),
    hasMore: rows.length > VISIBLE_LIMIT,
    freshness: {
      generatedAt: now.toISOString(),
      window,
      dataSource: "live",
    },
  };
}

function buildWinViewModel(
  row: WinTerminalRecord,
  _config: WinsAgentConfig,
  now: Date,
  timezone: string,
): WinViewModel {
  return {
    id: row.id,
    agentKey: row.agentKey,
    source: "recommendation",
    occurredAt: row.occurredAt.toISOString(),
    timeFolio: formatTimeFolio(row.occurredAt, now, timezone),
    proseSegments: [{ kind: "text", text: row.humanSummary }], // placeholder; Task 5 replaces
    undo: { available: false, until: null, unavailableReason: "not-reversible" }, // Task 6 replaces
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/wins.ts packages/core/src/agent-home/__tests__/wins.test.ts
git commit -m "feat(core): wins projection skeleton — types + empty-list path

Lays the WinsSignalStore + WinViewModel + projectWins shape with
placeholder prose and undo. Task 5 fills voice/prose; Task 6 fills
undo computation."
```

---

## Task 5: Per-agent voice + prose composition

**Files:**

- Modify: `packages/core/src/agent-home/wins.ts`
- Modify: `packages/core/src/agent-home/__tests__/wins.test.ts`

- [ ] **Step 1: Write failing tests for prose**

Append to `wins.test.ts`:

```ts
describe("projectWins — voice & prose", () => {
  const baseRow = {
    id: "r1",
    intent: "recommendation.send_tour_invite",
    humanSummary: "Sent tour invite to Maya",
    occurredAt: new Date("2026-05-07T03:42:00.000Z"),
    undoableUntil: null,
    targetEntities: {},
  };

  it("alex prose leads with the alex ack phrase", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "alex", status: "acted" }]),
    });
    expect(vm.wins[0].proseSegments[0]).toEqual({ kind: "accent", text: "Sent." });
    expect(vm.wins[0].proseSegments.map((s) => s.text).join("")).toContain("Maya");
  });

  it("riley prose leads with the riley ack phrase", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "riley",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([
        { ...baseRow, agentKey: "riley", status: "acted", humanSummary: "Adjusted ad-set bid" },
      ]),
    });
    expect(vm.wins[0].proseSegments[0]).toEqual({ kind: "accent", text: "Adjusted." });
    expect(vm.wins[0].proseSegments.map((s) => s.text).join("")).toContain("ad-set bid");
  });

  it("prose for alex differs from prose for riley (verifiable voice divergence)", async () => {
    const alex = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "alex", status: "acted" }]),
    });
    const riley = await projectWins({
      orgId: "org-1",
      agentKey: "riley",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "riley", status: "acted" }]),
    });
    expect(alex.wins[0].proseSegments[0].text).not.toBe(riley.wins[0].proseSegments[0].text);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: FAIL — current `proseSegments` is just `[{ kind: "text", text: humanSummary }]`.

- [ ] **Step 3: Implement `composeWinProse`**

Replace the placeholder line in `buildWinViewModel`:

```ts
proseSegments: composeWinProse(row, _config),
```

(Drop the leading underscore on `_config` since it's now used.)

Add the function:

```ts
function composeWinProse(row: WinTerminalRecord, config: WinsAgentConfig): readonly ProseSegment[] {
  const ack: ProseSegment = { kind: "accent", text: config.ackPhrase };
  if (config.agentKey === "alex") {
    return [ack, { kind: "text", text: ` ${row.humanSummary}` }];
  }
  // riley
  return [ack, { kind: "text", text: ` ${row.humanSummary}` }];
}
```

(Both branches are intentionally identical in body — the divergence is in `config.ackPhrase`. The inline branch structure is kept so future per-agent prose tweaks slot in without reshaping the function.)

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/wins.ts packages/core/src/agent-home/__tests__/wins.test.ts
git commit -m "feat(core): wins prose with per-agent voice (alex/riley)

AGENT_VOICE_CONFIGS supplies the ack phrase; composeWinProse is the
seam where future per-agent divergence lands. Verifies alex and riley
emit different leading segments."
```

---

## Task 6: Undo computation

**Files:**

- Modify: `packages/core/src/agent-home/wins.ts`
- Modify: `packages/core/src/agent-home/__tests__/wins.test.ts`

- [ ] **Step 1: Write failing tests for undo**

Append to `wins.test.ts`:

```ts
describe("projectWins — undo", () => {
  const baseRow = {
    id: "r1",
    agentKey: "alex" as const,
    intent: "recommendation.send_tour_invite",
    humanSummary: "Sent tour invite",
    occurredAt: new Date("2026-05-07T03:42:00.000Z"),
    targetEntities: {},
  };
  const now = new Date("2026-05-07T06:30:00.000Z");

  it("acted: not reversible (no button), until null", async () => {
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "acted", undoableUntil: null }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: null,
      unavailableReason: "not-reversible",
    });
  });

  it("confirmed + future undoableUntil: available", async () => {
    const future = new Date(now.getTime() + 60_000); // 1 min ahead
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: future }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: true,
      until: future.toISOString(),
    });
  });

  it("confirmed + past undoableUntil: expired", async () => {
    const past = new Date(now.getTime() - 60_000);
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: past }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: past.toISOString(),
      unavailableReason: "expired",
    });
  });

  it("confirmed without undoableUntil: not-reversible (defensive)", async () => {
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: null }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: null,
      unavailableReason: "not-reversible",
    });
  });
});

describe("projectWins — pagination", () => {
  it("caps wins at 5 and sets hasMore when more rows exist", async () => {
    const rows: WinTerminalRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      agentKey: "alex",
      status: "acted",
      intent: "recommendation.x",
      humanSummary: `summary ${i}`,
      occurredAt: new Date(),
      undoableUntil: null,
      targetEntities: {},
    }));
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now: new Date(),
      timezone: "Asia/Singapore",
      store: inMemoryStore(rows),
    });
    expect(vm.wins).toHaveLength(5);
    expect(vm.hasMore).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: FAIL — current undo always returns `not-reversible`.

- [ ] **Step 3: Implement `computeUndo`**

Replace the placeholder undo line in `buildWinViewModel`:

```ts
undo: computeUndo(row, now),
```

Add the function:

```ts
function computeUndo(row: WinTerminalRecord, now: Date): WinViewModel["undo"] {
  if (row.status === "acted") {
    return { available: false, until: null, unavailableReason: "not-reversible" };
  }
  // confirmed
  if (row.undoableUntil === null) {
    return { available: false, until: null, unavailableReason: "not-reversible" };
  }
  if (row.undoableUntil.getTime() <= now.getTime()) {
    return {
      available: false,
      until: row.undoableUntil.toISOString(),
      unavailableReason: "expired",
    };
  }
  return { available: true, until: row.undoableUntil.toISOString() };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test -- wins.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/wins.ts packages/core/src/agent-home/__tests__/wins.test.ts
git commit -m "feat(core): wins undo computation + pagination cap

acted -> not-reversible. confirmed + future undoableUntil -> available.
confirmed + past or null -> not available with the right reason. Cap
visible wins at 5 with hasMore flag."
```

---

## Task 7: Re-export from `packages/core/src/agent-home/index.ts`

**Files:**

- Modify: `packages/core/src/agent-home/index.ts`

- [ ] **Step 1: Read current barrel**

```bash
cat packages/core/src/agent-home/index.ts
```

Expected: current re-exports for greeting (if PR-S2 has merged) plus possibly types.

- [ ] **Step 2: Add re-exports**

Append (or merge into the existing structure):

```ts
export {
  projectWins,
  type WinTimeWindow,
  type WinSource,
  type WinStatus,
  type WinTerminalRecord,
  type WinsSignalStore,
  type WinViewModel,
  type WinsViewModel,
  type ProseSegment,
  type DataFreshness,
} from "./wins.js";
export { computeWindowStart } from "./window.js";
export { formatTimeFolio } from "./time-folio.js";
```

If the file imports `type WinTimeWindow` from `./window.js` for its own use, dedupe — `WinTimeWindow` is also re-exported from `wins.ts`; pick one source for the public surface and remove the duplicate.

- [ ] **Step 3: Run typecheck and core tests**

```bash
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core test
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-home/index.ts
git commit -m "chore(core): re-export agent-home wins surface"
```

---

## Task 8: API route — `apps/api/src/routes/agent-home/wins.ts`

**Files:**

- Create: `apps/api/src/routes/agent-home/wins.ts`
- Create: `apps/api/src/routes/agent-home/__tests__/wins.test.ts`
- Modify: wherever route plugins are registered (likely `apps/api/src/routes/index.ts` or `apps/api/src/server.ts`) to mount the new route.

- [ ] **Step 1: Find the route-registration site**

```bash
grep -rn "decisions" apps/api/src/server.ts apps/api/src/routes/index.ts apps/api/src/app.ts 2>/dev/null
```

Find where the `/api/dashboard/agents/:agentId/decisions` route is registered. The wins route mounts in the same place.

- [ ] **Step 2: Write failing route test**

```ts
// apps/api/src/routes/agent-home/__tests__/wins.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";

describe("GET /api/dashboard/agents/:agentId/wins", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns 200 with WinsViewModel when wins exist", async () => {
    vi.spyOn(ctx.app.recommendationStore!, "listResolvedForAgent").mockResolvedValue([
      {
        id: "r1",
        idempotencyKey: "k1",
        intent: "recommendation.send_tour_invite",
        status: "confirmed",
        agentKey: "alex",
        orgId: "org-A",
        humanSummary: "Sent invite to Maya",
        confidence: 0.7,
        riskLevel: "low",
        dollarsAtRisk: 0,
        targetEntities: {},
        parameters: {},
        approvalRequired: "operator",
        surface: "queue",
        undoableUntil: new Date(Date.now() + 60_000),
        resolvedAt: new Date(),
        resolvedBy: "u1",
        createdAt: new Date(),
        expiresAt: null,
        sourceWorkflow: null,
      } as never,
    ]);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=today",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: { wins: unknown[]; hasMore: boolean; freshness: { dataSource: string } };
    };
    expect(body.vm.wins).toHaveLength(1);
    expect(body.vm.hasMore).toBe(false);
    expect(body.vm.freshness.dataSource).toBe("live");
  });

  it("returns 404 for mira", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for unknown agent key", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/zoe/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it("defaults window to today when omitted", async () => {
    const spy = vi
      .spyOn(ctx.app.recommendationStore!, "listResolvedForAgent")
      .mockResolvedValue([]);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown window values", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=year",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter @switchboard/api test -- agent-home/wins.test.ts
```

Expected: FAIL — module not found / route not mounted.

- [ ] **Step 4: Implement the route**

```ts
// apps/api/src/routes/agent-home/wins.ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projectWins, type WinsSignalStore } from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../lib/org-scope.js"; // adjust path to match repo

const ParamsSchema = z.object({
  agentId: AgentKeySchema,
});
const QuerySchema = z.object({
  window: z.enum(["today", "week", "month"]).default("today"),
});

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

export const winsRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/dashboard/agents/:agentId/wins", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
    const query = QuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid window" });

    const { agentId } = params.data;
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    if (!app.recommendationStore) {
      return reply.code(503).send({ error: "Recommendations store unavailable" });
    }

    const timezone =
      (await app.organizationConfigStore?.getByOrgId?.(orgId))?.timezone ?? "Asia/Singapore";

    const store: WinsSignalStore = {
      async listResolvedForAgent({ orgId: o, agentKey, statuses, resolvedSince, limit }) {
        const rows = await app.recommendationStore!.listResolvedForAgent({
          orgId: o,
          agentKey,
          statuses,
          resolvedSince,
          limit,
        });
        // Defensive: the store's `where` filters on `resolvedAt: { not: null, gte }`,
        // so a null resolvedAt here would be a data invariant violation. Drop the
        // row instead of fabricating "occurred now" — fake recency is worse than
        // dropping a bad row in a "Recent Wins" feed.
        return rows.flatMap((r) => {
          if (!r.resolvedAt) {
            app.log.warn(
              { recommendationId: r.id, orgId: o },
              "wins: dropped row with null resolvedAt despite store filter",
            );
            return [];
          }
          return [
            {
              id: r.id,
              agentKey: r.agentKey as "alex" | "riley",
              status: r.status as "acted" | "confirmed",
              intent: r.intent,
              humanSummary: r.humanSummary,
              occurredAt: r.resolvedAt,
              undoableUntil: r.undoableUntil,
              targetEntities: r.targetEntities,
            },
          ];
        });
      },
    };

    try {
      const vm = await projectWins({
        orgId,
        agentKey: agentId as "alex" | "riley",
        window: query.data.window,
        now: new Date(),
        timezone,
        store,
      });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err }, "wins projection failed");
      return reply.code(500).send({ error: "Wins projection failed" });
    }
  });
};
```

Then mount it. If routes are registered as plugins in `apps/api/src/server.ts` (or wherever decisions is registered), add:

```ts
import { winsRoute } from "./routes/agent-home/wins.js";
// ...
await app.register(winsRoute);
```

If `requireOrganizationScope` lives at a different path, search:

```bash
grep -rn "requireOrganizationScope" apps/api/src --include="*.ts" | head -3
```

Adjust the import path accordingly.

If `OrganizationConfigStore.getByOrgId` doesn't exist or the timezone field isn't on the config row, the `?.` chain falls through to the fallback — that's intentional per spec §2 Q3.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter @switchboard/api test -- agent-home/wins.test.ts
```

Expected: all pass. If tests fail because `app.recommendationStore.listResolvedForAgent` is undefined in the test server, ensure the test server's recommendationStore is the real `PrismaRecommendationStore` (not a stub) so the mock from `vi.spyOn` attaches to the existing prototype method.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/agent-home/wins.ts apps/api/src/routes/agent-home/__tests__/wins.test.ts apps/api/src/server.ts
git commit -m "feat(api): GET /api/dashboard/agents/:agentId/wins

Live endpoint backing the agent-home Recent Wins block. Auth via
requireOrganizationScope; mira returns 404; window defaults to today;
delegates to projectWins + listResolvedForAgent."
```

---

## Task 9: Cross-org isolation test for wins endpoint

**Files:**

- Create: `apps/api/src/__tests__/api-agent-home-wins-isolation.test.ts`

- [ ] **Step 1: Write the isolation test**

```ts
// apps/api/src/__tests__/api-agent-home-wins-isolation.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/agents/:agentId/wins — cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak wins from another org", async () => {
    // Emit and resolve a rec for org-A
    const rec = await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-A",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "approve",
      humanSummary: "secret-A-win",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: { primaryLabel: "p", secondaryLabel: "s", dismissLabel: "d", dataLines: [] },
    });
    await ctx.app.recommendationStore!.applyAct({
      id: rec.row.id,
      actor: { principalId: "u-A", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: undefined,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=today",
      headers: { "x-org-id": "org-B" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: { wins: Array<{ proseSegments: Array<{ text: string }> }> };
    };
    const allText = body.vm.wins.flatMap((w) => w.proseSegments.map((s) => s.text)).join(" ");
    expect(allText).not.toContain("secret-A-win");
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @switchboard/api test -- api-agent-home-wins-isolation.test.ts
```

Expected: PASS — the route already filters by `orgId`, but this test makes the guarantee explicit and regression-protected.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/api-agent-home-wins-isolation.test.ts
git commit -m "test(api): cross-tenant isolation for wins endpoint"
```

---

## Task 10: Dashboard proxy route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/__tests__/route.test.ts`

Use the existing `decisions/route.ts` as the precedent.

- [ ] **Step 1: Read the precedent**

```bash
cat apps/dashboard/src/app/api/dashboard/agents/[agentId]/decisions/route.ts
```

- [ ] **Step 2: Write failing proxy test**

```ts
// apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "../route.js";

vi.mock("@/lib/auth-helpers", () => ({
  requireDashboardSession: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  getApiClient: vi.fn(),
}));

import { requireDashboardSession } from "@/lib/auth-helpers";
import { getApiClient } from "@/lib/api-client";

describe("GET /api/dashboard/agents/[agentId]/wins (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session", async () => {
    (requireDashboardSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://test/api/dashboard/agents/alex/wins");
    const res = await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when agentId not in AGENT_KEYS", async () => {
    (requireDashboardSession as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: "org-A" });
    const req = new Request("http://test/api/dashboard/agents/zoe/wins");
    const res = await GET(req, { params: Promise.resolve({ agentId: "zoe" }) });
    expect(res.status).toBe(400);
  });

  it("forwards to api with window query", async () => {
    (requireDashboardSession as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: "org-A" });
    const fetched = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ vm: { wins: [], hasMore: false, freshness: {} } }),
    });
    (getApiClient as ReturnType<typeof vi.fn>).mockReturnValue({ get: fetched });
    const req = new Request("http://test/api/dashboard/agents/alex/wins?window=week");
    const res = await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(fetched).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/agents/alex/wins?window=week"),
    );
  });

  it("defaults window to today when query absent", async () => {
    (requireDashboardSession as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: "org-A" });
    const fetched = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ vm: { wins: [] } }),
    });
    (getApiClient as ReturnType<typeof vi.fn>).mockReturnValue({ get: fetched });
    const req = new Request("http://test/api/dashboard/agents/alex/wins");
    await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(fetched).toHaveBeenCalledWith(expect.stringContaining("window=today"));
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter dashboard test -- agents/\[agentId\]/wins
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the proxy**

Match the decisions proxy pattern. Adjust auth/api-client imports to match the actual paths used in `decisions/route.ts`:

```ts
// apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts
import { NextResponse } from "next/server";
import { AGENT_KEYS } from "@switchboard/schemas";
import { requireDashboardSession } from "@/lib/auth-helpers";
import { getApiClient } from "@/lib/api-client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const session = await requireDashboardSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { agentId } = await params;
  if (!AGENT_KEYS.includes(agentId)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const url = new URL(req.url);
  const window = url.searchParams.get("window") ?? "today";

  const client = getApiClient();
  const upstream = await client.get(
    `/api/dashboard/agents/${agentId}/wins?window=${encodeURIComponent(window)}`,
  );
  if (!upstream.ok) {
    return NextResponse.json({ error: "Upstream wins fetch failed" }, { status: upstream.status });
  }
  const body = await upstream.json();
  return NextResponse.json(body, { status: 200 });
}
```

If the actual auth helper is `getServerSession()` or named differently, mirror exactly what `decisions/route.ts` does. The test's `vi.mock` paths must match the real import paths — adjust both together.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter dashboard test -- agents/\[agentId\]/wins
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/wins/route.ts apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/wins/__tests__/route.test.ts
git commit -m "feat(dashboard): wins proxy → /api/dashboard/agents/:id/wins

NextAuth → orgId; rejects unknown agentId; defaults window to today;
forwards to api server preserving query."
```

---

## Task 11: `use-agent-wins.ts` — fixture form → live form

**Files:**

- Modify: `apps/dashboard/src/hooks/use-agent-wins.ts`
- Modify: `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx`

- [ ] **Step 1: Read existing hook + test**

```bash
cat apps/dashboard/src/hooks/use-agent-wins.ts
cat apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx
```

Note the current fixture-form contract.

- [ ] **Step 2: Write failing live test (replacing fixture test)**

Replace the contents of `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentWins } from "../use-agent-wins";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    wins: {
      feed: (agentKey: string, window: string) => ["org-A", "wins", "feed", agentKey, window],
    },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAgentWins (live)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns vm on 200 happy path", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          vm: { wins: [{ id: "r1" }], hasMore: false, freshness: { dataSource: "live" } },
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper });
    await waitFor(() => expect(result.current.data?.wins).toHaveLength(1));
    expect(result.current.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/agents/alex/wins?window=today"),
    );
  });

  it("surfaces isError on non-200", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter dashboard test -- use-agent-wins
```

Expected: FAIL — current implementation is the fixture form.

- [ ] **Step 4: Replace the hook implementation**

```ts
// apps/dashboard/src/hooks/use-agent-wins.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { WinsViewModel } from "@/lib/agent-home/types";
import type { AgentBlockQuery } from "@/lib/agent-home/types";
import { useScopedQueryKeys } from "./use-query-keys";

export function useAgentWins(
  agentKey: AgentKey,
  window: "today" | "week" | "month" = "today",
): AgentBlockQuery<WinsViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys ? keys.wins.feed(agentKey, window) : ["wins-disabled"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/wins?window=${window}`);
      if (!res.ok) throw new Error(`Wins fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: WinsViewModel };
      return json.vm;
    },
    enabled: keys !== null,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
```

If `WinsViewModel` lives at a different path (the spec assumed `@/lib/agent-home/types`), adjust the import. Confirm with:

```bash
grep -rn "WinsViewModel" apps/dashboard/src/lib/agent-home/ | head
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter dashboard test -- use-agent-wins
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/hooks/use-agent-wins.ts apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx
git commit -m "feat(dashboard): use-agent-wins live (replaces fixture)

Same AgentBlockQuery<WinsViewModel> interface; default window=today;
React Query key uses scoped keys.wins.feed(agentKey, window)."
```

---

## Task 12: Extend `dispatch-action.ts` to accept `"undo"`

**Files:**

- Modify: `apps/dashboard/src/lib/decisions/dispatch-action.ts`
- Modify or create: `apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts`

- [ ] **Step 1: Check whether a test file exists**

```bash
find apps/dashboard/src/lib/decisions/__tests__ -type f 2>/dev/null
```

- [ ] **Step 2: Write a failing undo test**

If a test file exists, append; otherwise create:

```ts
// apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchDecisionAction } from "../dispatch-action";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("dispatchDecisionAction — undo branch", () => {
  beforeEach(() => fetchMock.mockReset());

  it("POSTs action: undo on approval kind", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const invalidate = vi.fn();
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "undo", undefined, {
      queryClient: { invalidateQueries: invalidate },
      orgId: "org-A",
      agentKey: "alex",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/recommendations",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"undo"'),
      }),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("propagates !ok responses", async () => {
    fetchMock.mockResolvedValue(new Response("undo_window_closed", { status: 409 }));
    await expect(
      dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "undo", undefined, {
        queryClient: { invalidateQueries: vi.fn() },
        orgId: "org-A",
        agentKey: "alex",
      }),
    ).rejects.toThrow(/HTTP 409/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter dashboard test -- dispatch-action
```

Expected: FAIL — TypeScript rejects `"undo"` as not part of the action union.

- [ ] **Step 4: Extend the action union**

In `apps/dashboard/src/lib/decisions/dispatch-action.ts`, change the `action` parameter type:

```ts
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss" | "undo",
  payload?: { message?: string; resolutionNote?: string; note?: string },
  context?: DispatchContext,
): Promise<void> {
```

The `"approval"` case body already spreads `action` into the request body — no body change needed.

If TypeScript flags any caller now (existing callers should still type-check since `"undo"` is additive), fix those at the same time. Don't touch the `"handoff"` branch — undo is approval-only.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter dashboard test -- dispatch-action
pnpm --filter dashboard typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/decisions/dispatch-action.ts apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts
git commit -m "feat(dashboard): dispatch-action accepts \"undo\" on approval kind

Type-only union extension; the approval branch already POSTs action
verbatim. Adds a regression test for undo + the 409 error path."
```

---

## Task 13: `useUndoWin` hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-undo-win.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-undo-win.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-undo-win.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUndoWin } from "../use-undo-win";

const dispatchMock = vi.fn();
vi.mock("@/lib/decisions/dispatch-action", () => ({
  dispatchDecisionAction: (...args: unknown[]) => dispatchMock(...args),
}));

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    wins: { feed: (k: string, w: string) => ["org-A", "wins", "feed", k, w] },
  }),
}));

vi.mock("../use-session", () => ({
  useSession: () => ({ data: { user: { orgId: "org-A" } } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useUndoWin", () => {
  beforeEach(() => dispatchMock.mockReset());

  it("calls dispatchDecisionAction with kind: approval, action: undo", async () => {
    dispatchMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUndoWin(), { wrapper });
    result.current.mutate({ winId: "rec-1", agentKey: "alex" });
    await waitFor(() => expect(dispatchMock).toHaveBeenCalled());
    expect(dispatchMock).toHaveBeenCalledWith(
      { kind: "approval", sourceId: "rec-1" },
      "undo",
      undefined,
      expect.objectContaining({ orgId: "org-A", agentKey: "alex" }),
    );
  });

  it("invalidates wins query on 409 error so the tile reflects expired state", async () => {
    // Render with a real-ish QueryClient so we can spy on invalidate calls.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    function localWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    dispatchMock.mockRejectedValue(new Error("Recommendation action failed (HTTP 409)"));

    const { result } = renderHook(() => useUndoWin(), { wrapper: localWrapper });
    result.current.mutate({ winId: "rec-1", agentKey: "alex" });

    // Mutation settles in error; onSettled still runs.
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The hook's `isError` is not user-visible — what matters is that
    // wins were invalidated so the VM refreshes to the expired state.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["org-A", "wins", "feed", "alex"] }),
    );
  });
});
```

If your codebase doesn't have a `useSession` hook in that exact path, replace the mock with whatever wraps NextAuth's session for client components in this repo (search `grep -rn "useSession" apps/dashboard/src/hooks | head`).

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter dashboard test -- use-undo-win
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// apps/dashboard/src/hooks/use-undo-win.ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import { scopedKeys } from "@/lib/query-keys";
import { useSession } from "./use-session"; // adjust to actual session hook path

export function useUndoWin() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  return useMutation({
    mutationFn: async ({ winId, agentKey }: { winId: string; agentKey: AgentKey }) => {
      const orgId = session?.user?.orgId;
      if (!orgId) throw new Error("No active org");
      await dispatchDecisionAction({ kind: "approval", sourceId: winId }, "undo", undefined, {
        queryClient,
        orgId,
        agentKey,
      });
    },
    // Always refetch wins after the mutation settles. On success,
    // dispatchDecisionAction already invalidates; this is the safety net for
    // the error path (notably 409 undo_window_closed) so the tile re-renders
    // with the server's authoritative undo state — `unavailableReason: "expired"`
    // — instead of relying on a hook-level error overlay.
    onSettled: (_data, _error, variables) => {
      const orgId = session?.user?.orgId;
      if (!orgId) return;
      const keys = scopedKeys(orgId);
      void queryClient.invalidateQueries({ queryKey: keys.wins.byAgent(variables.agentKey) });
    },
  });
}
```

If `session.user.orgId` lives at a different path or is fetched via `useScopedQueryKeys` (which already returns `null` when there's no org), use that pattern instead. The key invariant is: pull `orgId` from the same source the rest of the dashboard uses.

**Single source of truth on undo error display**: The "Undo window closed" message is rendered by `WinsBlock` when the **VM** says `unavailableReason: "expired"`. The hook's `isError`/`error` state is _not_ surfaced visually in PR-S3 (no toast). The `onSettled` invalidation above guarantees that after a 409 the VM refresh reflects the expired state, which is what the tile renders.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter dashboard test -- use-undo-win
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-undo-win.ts apps/dashboard/src/hooks/__tests__/use-undo-win.test.tsx
git commit -m "feat(dashboard): useUndoWin — wraps dispatchDecisionAction

Mutation hook for the WinTile Undo button. onSettled invalidates the
wins query on both success and error so a 409 (undo_window_closed)
refreshes the tile to the server's authoritative \"expired\" state.
No global toast; the inline message is driven by the VM only."
```

---

## Task 14: `WinsBlock` — add Undo button + states

**Files:**

- Modify: `apps/dashboard/src/components/agent-home/wins-block.tsx`
- Modify: `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx`

- [ ] **Step 1: Read the current component + test**

```bash
cat apps/dashboard/src/components/agent-home/wins-block.tsx
cat apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx
```

The PR-S1 component already renders the `WinsViewModel` shape. We're adding undo affordance per spec §9.

- [ ] **Step 2: Write failing tests for undo states**

Append to `wins-block.test.tsx` (or replace the existing tests if the structure is one-test-file-rewrite):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WinsBlock } from "../wins-block";
import type { WinsViewModel } from "@/lib/agent-home/types";

vi.mock("@/hooks/use-undo-win", () => ({
  useUndoWin: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

function makeVm(overrides?: Partial<WinsViewModel>): WinsViewModel {
  return {
    wins: [],
    hasMore: false,
    freshness: { generatedAt: "2026-05-07T06:30:00Z", window: "today", dataSource: "live" },
    ...overrides,
  };
}

describe("WinsBlock — undo states", () => {
  it("renders Undo button when win.undo.available is true", () => {
    const vm = makeVm({
      wins: [
        {
          id: "r1",
          agentKey: "alex",
          source: "recommendation",
          occurredAt: "2026-05-07T03:42:00.000Z",
          timeFolio: "11:42 AM",
          proseSegments: [{ kind: "text", text: "Sent invite" }],
          undo: { available: true, until: "2026-05-07T07:00:00.000Z" },
        },
      ],
    });
    render(<WinsBlock vm={vm} agentKey="alex" />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it('renders "Undo window closed" inline when undo is expired', () => {
    const vm = makeVm({
      wins: [
        {
          id: "r1",
          agentKey: "alex",
          source: "recommendation",
          occurredAt: "2026-05-07T03:42:00.000Z",
          timeFolio: "11:42 AM",
          proseSegments: [{ kind: "text", text: "Sent invite" }],
          undo: {
            available: false,
            until: "2026-05-07T05:00:00.000Z",
            unavailableReason: "expired",
          },
        },
      ],
    });
    render(<WinsBlock vm={vm} agentKey="alex" />);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.getByText(/undo window closed/i)).toBeInTheDocument();
  });

  it("renders no undo controls when not-reversible", () => {
    const vm = makeVm({
      wins: [
        {
          id: "r1",
          agentKey: "alex",
          source: "recommendation",
          occurredAt: "2026-05-07T03:42:00.000Z",
          timeFolio: "11:42 AM",
          proseSegments: [{ kind: "text", text: "Sent invite" }],
          undo: { available: false, until: null, unavailableReason: "not-reversible" },
        },
      ],
    });
    render(<WinsBlock vm={vm} agentKey="alex" />);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/undo window closed/i)).not.toBeInTheDocument();
  });

  it("renders the new empty-state copy when wins is empty", () => {
    render(<WinsBlock vm={makeVm()} agentKey="alex" />);
    expect(screen.getByText(/no recent wins yet/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the next approved action/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter dashboard test -- wins-block
```

Expected: FAIL — current component doesn't render undo controls or the new empty copy.

- [ ] **Step 4: Update the component**

Edit `wins-block.tsx`. The exact existing structure determines the diff — keep the existing layout, add a per-tile undo region. Skeleton:

```tsx
import { useUndoWin } from "@/hooks/use-undo-win";
import type { AgentKey } from "@switchboard/schemas";
import type { WinsViewModel, WinViewModel } from "@/lib/agent-home/types";

const AGENT_DISPLAY: Record<AgentKey, string> = { alex: "Alex", riley: "Riley", mira: "Mira" };

export function WinsBlock({ vm, agentKey }: { vm: WinsViewModel; agentKey: AgentKey }) {
  if (vm.wins.length === 0) {
    return (
      <section>
        {/* existing folio header */}
        <p className="dc-resolved-line">
          <em>
            No recent wins yet. {AGENT_DISPLAY[agentKey]} is waiting for the next approved action.
          </em>
        </p>
      </section>
    );
  }
  return (
    <section>
      {/* existing folio header */}
      <ul>
        {vm.wins.map((win) => (
          <WinTile key={win.id} win={win} agentKey={agentKey} />
        ))}
      </ul>
    </section>
  );
}

function WinTile({ win, agentKey }: { win: WinViewModel; agentKey: AgentKey }) {
  const { mutate, isPending } = useUndoWin();
  return (
    <li>
      <header>{win.timeFolio}</header>
      <p>
        {win.proseSegments.map((s, i) =>
          s.kind === "accent" ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
        )}
      </p>
      {win.undo.available && (
        <button
          type="button"
          onClick={() => mutate({ winId: win.id, agentKey })}
          disabled={isPending}
        >
          Undo
        </button>
      )}
      {!win.undo.available && win.undo.unavailableReason === "expired" && (
        <span className="dc-resolved-line">
          <em>Undo window closed</em>
        </span>
      )}
    </li>
  );
}
```

Preserve any existing class names, fixture-folio badge, freshness chip, etc. The diff should be additive — the empty-state copy is the only behaviour change to existing branches.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter dashboard test -- wins-block
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/agent-home/wins-block.tsx apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx
git commit -m "feat(dashboard): WinsBlock — Undo button + empty-state copy

Per-tile Undo when win.undo.available; \"Undo window closed\" inline
on expired; no controls when not-reversible. Empty-state copy
updated per spec §11 acceptance #9."
```

---

## Task 15: Remove the wins fixture

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts`
- Modify: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts`

- [ ] **Step 1: Read both files**

```bash
cat apps/dashboard/src/app/\(auth\)/\[agentKey\]/_fixtures.ts
cat apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/fixtures.test.ts
```

- [ ] **Step 2: Remove `getFixtureWins` and the wins fixture data**

In `_fixtures.ts`, delete the wins fixture data and the `getFixtureWins` export (and any types only used by it). Leave greeting, metrics, pipeline fixtures untouched.

In `fixtures.test.ts`, remove the `describe`/`it` block(s) covering wins. Leave the rest.

- [ ] **Step 3: Confirm nothing imports `getFixtureWins`**

```bash
grep -rn "getFixtureWins" apps/dashboard/src
```

Expected: no remaining references. (Task 11 already removed the only consumer in `use-agent-wins.ts`.)

- [ ] **Step 4: Run dashboard tests + typecheck**

```bash
pnpm --filter dashboard test
pnpm --filter dashboard typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\[agentKey\]/_fixtures.ts apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/fixtures.test.ts
git commit -m "chore(dashboard): remove wins fixture (live in PR-S3)"
```

---

## Task 16: Final verification + open PR

**Files:** none modified

- [ ] **Step 1: Reset + full build**

```bash
pnpm reset
pnpm build
```

Expected: clean rebuild, all packages compile.

- [ ] **Step 2: Full typecheck + lint + test**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green. If a coverage threshold is breached on either core (65/65/70/65) or dashboard (55/50/52/55), inspect which file fell below and add the missing test.

- [ ] **Step 3: Smoke-check the dev stack manually (optional but recommended)**

```bash
pnpm dev
# In another terminal: open http://localhost:3002/alex (only if production gate is off in dev)
```

Expected: agent-home loads; Recent Wins block shows live data (if any wins exist in your local DB) or the new empty-state copy. If production gate blocks `/alex` in dev, skip this step.

- [ ] **Step 4: Confirm worktree state, then push**

```bash
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
git push -u origin feat/slice-b-pr-s3
```

Expected: branch is `feat/slice-b-pr-s3`, working tree clean, ~13 commits ahead of `origin/main`.

- [ ] **Step 5: Open the PR (ask user to confirm before this step in auto mode)**

```bash
gh pr create --base main --head feat/slice-b-pr-s3 \
  --title "feat(redesign): PR-S3 — B3 Recent Wins live (Alex + Riley)" \
  --body "$(cat <<'EOF'
## Summary

Implements PR-S3 of Slice B per `docs/superpowers/specs/2026-05-07-slice-b-pr-s3-design.md`.

Recent Wins block on `/alex` and `/riley` now reads live `PendingActionRecord` data with per-agent voice and an Undo affordance that respects `undoableUntil`. Recommendations-only in v1; bookings + conversions deferred to PR-S3.1.

### What changed
- **Core**: new `agent-home/{wins,window,time-folio}.ts` projections + helpers
- **DB**: `PrismaRecommendationStore.listResolvedForAgent` (push-down filter)
- **API**: `GET /api/dashboard/agents/:agentId/wins?window=…`
- **Dashboard**: live `useAgentWins` + `useUndoWin` + `WinsBlock` undo affordance
- **Dispatch**: `dispatchDecisionAction` accepts `"undo"` on `approval` kind

### Test plan
- [ ] CI typecheck/lint/test green
- [ ] Cross-org isolation verified by `api-agent-home-wins-isolation.test.ts`
- [ ] Per-agent voice divergence verified by `wins.test.ts` (alex vs riley)
- [ ] Undo states (available / expired / not-reversible) covered in `wins.test.ts` + `wins-block.test.tsx`
- [ ] DST-spanning timezone case in `window.test.ts` (America/New_York)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened, returns the PR URL.

- [ ] **Step 6: Update parent spec §7.3 empty-state copy in tandem**

Spec PR #377 acceptance #9 notes the parent spec §7.3 needs the same empty-state copy update. If PR #376 (parent spec onto main) is still open, push a one-line patch to that PR to align. If it has merged, open a tiny follow-up PR. This is **not** required to ship PR-S3 but should not be forgotten.

---

## Self-review checklist (run before merging)

- [ ] Spec §11 acceptance criteria 1–10 each map to at least one passing test.
- [ ] Spec §13 "Out of scope" items are not accidentally implemented.
- [ ] No `console.log` in any new file (use `console.warn`/`console.error` per CLAUDE.md).
- [ ] No `any` types — use `unknown` or proper types.
- [ ] All new files have co-located tests under `__tests__/`.
- [ ] No file exceeds 600 lines (warn at 400). Split if it does.
- [ ] No new circular dependencies between layers (schemas → cartridge-sdk/sdk/creative-pipeline/ad-optimizer → core → db → apps).
- [ ] `pnpm db:check-drift` passes (no schema migrations were intended; if it complains, undo any accidental schema edits).
