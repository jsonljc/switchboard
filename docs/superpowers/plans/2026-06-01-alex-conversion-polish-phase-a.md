# Alex Conversion Polish — Phase A Implementation Plan (metric + closing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alex's success metric honest (booked→operator-confirmed-showed) and sharpen compliant objection-closing — the zero-external-dependency half of the [delta spec](../specs/2026-06-01-alex-conversion-polish-delta-design.md). Phase B (cadence + reminders) is a separate plan.

**Architecture:** Four independent PRs, each shippable alone. PR-1a/1b/1c touch the agent-home metric pipeline (`packages/core` builder + `packages/db` stores + `apps/dashboard` render). PR-2 is doc/prompt edits to Alex's playbook plus an eval-harness sync. No schema migrations, no new crons, no Meta dependency.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest (db-layer tests mock Prisma — CI has no Postgres), Prisma, Next.js (dashboard). Prettier (semi, double quotes, 2-space, 100 width). Commitlint (lowercase subject). Run `pnpm typecheck` + `pnpm test` before each commit; `pnpm --filter @switchboard/core test` for a single package.

**Worktree note:** this plan executes in `.claude/worktrees/alex-conversion-polish`. Before running any test/typecheck, the worktree needs deps — run `pnpm install` from the worktree root (full `pnpm worktree:init` needs Postgres and is not required for these tests, which mock Prisma). Husky hooks need that install too; until then, commits use `--no-verify` and a `pnpm format:check` is run before opening the PR.

---

## Task 1 (PR-1a): Metric correctness — exclude `failed`, rename `tours-booked`→`appointments-booked`

**Files:**
- Modify: `packages/core/src/agent-home/metrics-alex.ts:17` (EXCLUDE_STATUSES), `:97` (hero kind)
- Modify: `packages/core/src/agent-home/metrics-types.ts:14` (HeroMetric union member)
- Modify: `apps/dashboard/src/lib/agent-home/types.ts` (mirror union), `apps/dashboard/src/components/agent-panel/lib/agent-display.ts:27` (label switch)
- Test: `packages/core/src/agent-home/__tests__/metrics-alex.test.ts:56-86` (two existing tests)

- [ ] **Step 1: Update the two failing assertions to the new contract.**

In `metrics-alex.test.ts`, change the hero-kind test (`:56-76`) — replace both `"tours-booked"` literals with `"appointments-booked"`:

```ts
    expect(vm.hero.kind).toBe("appointments-booked");
    if (vm.hero.kind !== "appointments-booked") throw new Error();
```

And change the exclude test (`:78-86`) to assert the new exclusion set, and rename its title:

```ts
  it("excludes 'cancelled' and 'failed' statuses when counting bookings", async () => {
    const store = makeStore();
    const week = buildWeekContext(WED_NOW, TZ);
    await buildAlexMetricsViewModel({ orgId: "org-1", week, store, targets: DEFAULT_TARGETS });
    const calls = (store.countBookingsCreated as ReturnType<typeof vi.fn>).mock.calls;
    for (const [arg] of calls) {
      expect(arg.excludeStatuses).toEqual(["cancelled", "failed"]);
    }
  });
```

- [ ] **Step 2: Run the tests; verify they FAIL.**

Run: `pnpm --filter @switchboard/core test -- metrics-alex`
Expected: FAIL — hero.kind is still `"tours-booked"`; excludeStatuses is still `["cancelled"]`.

- [ ] **Step 3: Make the source changes.**

`metrics-alex.ts:17`:
```ts
const EXCLUDE_STATUSES = ["cancelled", "failed"] as const;
```
`metrics-alex.ts:97` (hero block):
```ts
      kind: "appointments-booked",
```
`metrics-types.ts:14` (HeroMetric union):
```ts
  | { kind: "appointments-booked"; value: number; comparator: MetricComparator }
```

- [ ] **Step 4: Rename every remaining consumer.** Run a scoped find of all sites, then replace `"tours-booked"` → `"appointments-booked"` across core + dashboard (mirror union in `apps/dashboard/src/lib/agent-home/types.ts`, the `agent-display.ts:27` switch case, and all test fixtures that hard-code the literal):

Run: `grep -rn '"tours-booked"' packages apps --include='*.ts' --include='*.tsx'`
Then replace each occurrence with `"appointments-booked"`. In `agent-display.ts:28`, also update the human label return to `"appointments booked"`.

- [ ] **Step 5: Run the full affected suites; verify PASS + typecheck.**

Run: `pnpm --filter @switchboard/core test -- metrics-alex && pnpm typecheck`
Expected: PASS, no type errors. If the dashboard has its own test run: `pnpm --filter @switchboard/dashboard test -- agent-panel` should be green (the renamed literals match).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/agent-home apps/dashboard/src/lib/agent-home apps/dashboard/src/components/agent-panel
git commit -m "fix(agent-home): exclude failed bookings; rename tours-booked hero to appointments-booked"
```

---

## Task 2 (PR-1b): Operator-confirmed Showed stat + coverage

**Files:**
- Modify: `packages/core/src/agent-home/metrics-types.ts` (`MetricsSignalStore` +2 methods; `StatCell` +`hint?`)
- Modify: `packages/core/src/agent-home/metrics-alex.ts` (fan-out + replace stats[1] Conversion → Showed)
- Modify: `packages/db/src/stores/prisma-opportunity-store.ts` (+2 methods) — and the `MetricsSignalStore` adapter that wires the opportunity store in
- Test: `packages/core/src/agent-home/__tests__/metrics-alex.test.ts`, `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`
- Modify: `apps/dashboard/src/components/agent-panel/lib/key-result.tsx` (render the Showed cell hint)

- [ ] **Step 1: Extend the store interface + StatCell (types first).**

`metrics-types.ts` — add `hint?: string;` to `StatCell` (precedent: `KpiTile.hint`), and add to `MetricsSignalStore`:
```ts
  countCurrentlyAtStageUpdatedInWindow(input: {
    orgId: string;
    stage: string;
    from: Date;
    to: Date;
  }): Promise<number>;

  latestOpportunityStageUpdatedAt(input: { orgId: string; stage: string }): Promise<Date | null>;
```

- [ ] **Step 2: Write the failing metric test for the Showed cell.**

In `metrics-alex.test.ts`: (a) extend `makeStore` to provide the two new methods (add to `overrides` a `showedByRange?` + `boardLastUpdated?: Date | null`, default `0`/`null`):

```ts
    countCurrentlyAtStageUpdatedInWindow: vi.fn(async ({ from, to }) =>
      overrides?.showedByRange ? overrides.showedByRange(from, to) : 0,
    ),
    latestOpportunityStageUpdatedAt: vi.fn(async () => overrides?.boardLastUpdated ?? null),
```

(b) Replace the two `stats[1] Conversion` tests (`:203-249`) with Showed-cell tests:

```ts
  it("stats[1] Showed = operator-confirmed showed count + coverage% of booked", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: (from, to) =>
        from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime() ? 10 : 0,
      showedByRange: () => 7,
      boardLastUpdated: new Date("2026-05-06T00:00:00.000Z"),
    });
    const vm = await buildAlexMetricsViewModel({ orgId: "org-1", week, store, targets: DEFAULT_TARGETS });
    expect(vm.stats[1].label).toBe("Showed");
    expect(vm.stats[1].display).toBe("7 (70%)");
    expect(vm.stats[1].rawValue).toBe(0.7);
    expect(vm.stats[1].unavailable).toBe(false);
  });

  it("stats[1] Showed is unavailable when the board was never updated", async () => {
    const store = makeStore({ bookingsByRange: () => 10, showedByRange: () => 0, boardLastUpdated: null });
    const vm = await buildAlexMetricsViewModel(makeInput(store));
    expect(vm.stats[1].display).toBe("—");
    expect(vm.stats[1].unavailable).toBe(true);
    expect(vm.stats[1].rawValue).toBeNull();
  });
```

- [ ] **Step 3: Run; verify FAIL.**

Run: `pnpm --filter @switchboard/core test -- metrics-alex`
Expected: FAIL — `stats[1].label` is still `"Conversion"`; new store methods undefined on the live builder.

- [ ] **Step 4: Implement the builder change in `metrics-alex.ts`.**

Add to the parallel fan-out (alongside `leadsP` etc.):
```ts
  const showedP = store.countCurrentlyAtStageUpdatedInWindow({
    orgId, stage: "showed", from: week.weekStart, to: week.weekEnd,
  });
  const boardLastUpdatedP = store.latestOpportunityStageUpdatedAt({ orgId, stage: "showed" });
```
Add both to the `Promise.all([...])` destructure (`showed`, `boardLastUpdated`).

Replace the `stats[1]` Conversion cell with a Showed cell (keep the 3-tuple; `qualifiedPct`/`conversion` stay computed for the top-level echoes):
```ts
  const showCoverage = heroValue > 0 ? showed / heroValue : 0;
  const showedUnavailable = boardLastUpdated === null;
  const showedCell: StatCell = showedUnavailable
    ? { label: "Showed", display: "—", rawValue: null, unit: "percent", unavailable: true }
    : {
        label: "Showed",
        display: `${showed} (${Math.round(showCoverage * 100)}%)`,
        rawValue: showCoverage,
        unit: "percent",
        unavailable: false,
        hint: `Operator-confirmed · board updated ${boardLastUpdated.toISOString().slice(0, 10)}`,
      };

  const stats: readonly [StatCell, StatCell, StatCell] = [
    { label: "Leads", display: String(leads), rawValue: leads, unit: "count" },
    showedCell,
    spendCell,
  ];
```
Echo `showed`/`showCoverage` as top-level `MetricsViewModel` fields (add `showed: number; showCoverage: number;` to the interface + the return object), mirroring the existing `leads`/`qualifiedPct` echoes.

- [ ] **Step 5: Run; verify metric tests PASS.**

Run: `pnpm --filter @switchboard/core test -- metrics-alex`
Expected: PASS.

- [ ] **Step 6: Write the failing db-store test for the two new opportunity methods.**

In `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts` (mock Prisma — mirror the file's existing pattern):

```ts
  it("countCurrentlyAtStageUpdatedInWindow filters by stage + updatedAt window", async () => {
    const count = vi.fn(async () => 4);
    const store = new PrismaOpportunityStore({ opportunity: { count } } as never);
    const from = new Date("2026-05-04T00:00:00Z");
    const to = new Date("2026-05-11T00:00:00Z");
    const n = await store.countCurrentlyAtStageUpdatedInWindow({ orgId: "org-1", stage: "showed", from, to });
    expect(n).toBe(4);
    expect(count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", stage: "showed", updatedAt: { gte: from, lt: to } },
    });
  });

  it("latestOpportunityStageUpdatedAt returns newest updatedAt or null", async () => {
    const findFirst = vi.fn(async () => ({ updatedAt: new Date("2026-05-06T00:00:00Z") }));
    const store = new PrismaOpportunityStore({ opportunity: { findFirst } } as never);
    const d = await store.latestOpportunityStageUpdatedAt({ orgId: "org-1", stage: "showed" });
    expect(d).toEqual(new Date("2026-05-06T00:00:00Z"));
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", stage: "showed" },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
  });
```

- [ ] **Step 7: Run; verify FAIL.** `pnpm --filter @switchboard/db test -- prisma-opportunity-store` → FAIL (methods not defined).

- [ ] **Step 8: Implement the two methods in `PrismaOpportunityStore`** (after `countByStage`):

```ts
  async countCurrentlyAtStageUpdatedInWindow(input: {
    orgId: string;
    stage: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.opportunity.count({
      where: {
        organizationId: input.orgId,
        stage: input.stage,
        updatedAt: { gte: input.from, lt: input.to },
      },
    });
  }

  async latestOpportunityStageUpdatedAt(input: { orgId: string; stage: string }): Promise<Date | null> {
    const row = await this.prisma.opportunity.findFirst({
      where: { organizationId: input.orgId, stage: input.stage },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }
```
Then wire these through whatever adapter satisfies `MetricsSignalStore` from the opportunity store (the signal store that the agent-home route constructs). If the metric signal store is a composite delegating to `PrismaOpportunityStore`, add the two pass-throughs there.

- [ ] **Step 9: Run db + core tests + typecheck; verify PASS.**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store && pnpm --filter @switchboard/core test -- metrics-alex && pnpm typecheck`

- [ ] **Step 10: Render the hint in the dashboard Showed cell.**

In `apps/dashboard/src/components/agent-panel/lib/key-result.tsx`, where a `StatCell` is rendered, surface `cell.hint` as a `title`/tooltip when present (non-breaking — `hint` is optional). Update the relevant `key-result.test.tsx` expectation if it snapshots the stats row.

- [ ] **Step 11: Commit.**

```bash
git add packages/core/src/agent-home packages/db/src/stores apps/dashboard/src/components/agent-panel
git commit -m "feat(agent-home): add operator-confirmed showed stat with coverage to Alex metrics"
```

---

## Task 3 (PR-1c): Governance verdict-count query (observe-mode review)

**Files:**
- Modify: `packages/core/src/governance/governance-verdict-store/types.ts` (interface +1 method)
- Modify: `packages/db/src/prisma-governance-verdict-store.ts` (impl)
- Test: `packages/db/src/__tests__/prisma-governance-verdict-store.test.ts` (or co-located test)

- [ ] **Step 1: Write the failing test.**

```ts
  it("countByDeploymentAndClaim counts verdicts by sourceGuard + window", async () => {
    const count = vi.fn(async () => 12);
    const store = new PrismaGovernanceVerdictStore({ governanceVerdict: { count } } as never);
    const from = new Date("2026-05-25T00:00:00Z");
    const to = new Date("2026-06-01T00:00:00Z");
    const n = await store.countByDeploymentAndClaim({
      deploymentId: "dep-1", claimType: "safety-claim", from, to,
    });
    expect(n).toBe(12);
    expect(count).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1", sourceGuard: "safety-claim", decidedAt: { gte: from, lt: to } },
    });
  });
```

- [ ] **Step 2: Run; verify FAIL.** `pnpm --filter @switchboard/db test -- governance-verdict-store` → FAIL.

- [ ] **Step 3: Add to the interface** (`governance-verdict-store/types.ts`):
```ts
  countByDeploymentAndClaim(input: {
    deploymentId: string;
    claimType: string;
    action?: string;
    from: Date;
    to: Date;
  }): Promise<number>;
```

- [ ] **Step 4: Implement** (`prisma-governance-verdict-store.ts`) — the existing `(deploymentId, sourceGuard, decidedAt)` composite index covers this; no migration:
```ts
  async countByDeploymentAndClaim(input: {
    deploymentId: string;
    claimType: string;
    action?: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.governanceVerdict.count({
      where: {
        deploymentId: input.deploymentId,
        sourceGuard: input.claimType,
        ...(input.action ? { action: input.action } : {}),
        decidedAt: { gte: input.from, lt: input.to },
      },
    });
  }
```

- [ ] **Step 5: Run + typecheck; verify PASS.** `pnpm --filter @switchboard/db test -- governance-verdict-store && pnpm typecheck`

- [ ] **Step 6: Commit.**
```bash
git add packages/core/src/governance packages/db/src
git commit -m "feat(governance): add verdict-count query for claim-classifier observe review"
```

---

## Task 4 (PR-2): Compliant closing playbook + eval-harness sync

**Files:**
- Modify: `skills/alex/references/medspa/objection-handling.md` (5 edits), `skills/alex/SKILL.md:195`
- Modify: `evals/alex-conversation/grade.ts:7` (allowlist), `evals/alex-conversation/mock-tools.ts` (followUp mock), `evals/alex-conversation/judge.ts` (rubric + version), `evals/alex-conversation/__tests__/grade.test.ts:365` (assertion)
- Create/append: `evals/alex-conversation/fixtures/gen-objection-time-trust.jsonl` (3 scenarios)

> Order matters: do the **allowlist + mock first** so the new fixtures load (a fixture referencing `follow-up` throws at load until the enum includes it).

- [ ] **Step 1: Write the failing harness test (allowlist).**

In `evals/alex-conversation/__tests__/grade.test.ts`, update the exact-tools assertion (`:365`) to expect the six declared tools:
```ts
    expect(ALEX_ALLOWED_TOOL_IDS).toEqual([
      "crm-query", "crm-write", "calendar-book", "escalate", "follow-up", "delegate",
    ]);
```

- [ ] **Step 2: Run; verify FAIL.** `pnpm --filter @switchboard/alex-conversation test -- grade` (or the eval package's test command) → FAIL (allowlist has 4).

- [ ] **Step 3: Sync the allowlist + mock.**

`grade.ts:7`:
```ts
export const ALEX_ALLOWED_TOOL_IDS = [
  "crm-query",
  "crm-write",
  "calendar-book",
  "escalate",
  "follow-up",
  "delegate",
] as const;
```
In `mock-tools.ts`, add a `followUp` mock exposing op `followup.schedule` returning `{ followUpId: "fu_mock", status: "scheduled" }` (mirror the existing `calendar-book`/`escalate` mock shape), and a `delegate` mock if one isn't present.

- [ ] **Step 4: Run; verify PASS.** `pnpm --filter @switchboard/alex-conversation test -- grade` → PASS.

- [ ] **Step 5: Edit the playbook — the two false slot-hold fixes + objection resolution.**

In `skills/alex/references/medspa/objection-handling.md`:
- `:43` replace `Happy to hold a slot while you look around.` → `Happy to help you shortlist a time when you're ready.`
- `:85` replace `"I can keep a consultation slot tentatively for you — just let me know if you'd like it."` → `"No worries. I'll check in with you in a couple of days in case things settle."` and add the instruction: *if the lead is qualified-but-hesitant, call `follow-up.followup.schedule` with a `reason` capturing what they were weighing — do not promise a specific slot or reservation.*
- "Maybe later" section: after accepting the timing, add *call `follow-up.followup.schedule` with a note capturing their stated interest; avoid any "limited slots"/time-pressure language.*
- Price "too expensive": prepend a one-line emotional acknowledgment (`"Totally fair — pricing here can vary and it's not always clear what you're paying for."`) before the existing consult-clarifies-cost reframe.
- Add a new section **"Urgency: lead has a stated personal deadline"** — reflect the lead's own deadline honestly ("3 months is a comfortable window — the first step is a consult"); never assert clinic-side scarcity.

`skills/alex/SKILL.md:195` — replace the bare "suggest a specific next step with a timeline" with: *surface the concern with one open question; on a genuine deferral, call `follow-up.followup.schedule` and say you'll check in in a couple of days; do not promise a specific slot or reservation.*

- [ ] **Step 6: Update the judge rubric.**

In `evals/alex-conversation/judge.ts`: add a tier-2 hard rule `"Claims to hold, reserve, or tentatively secure a calendar slot"`; add tier-3 criterion #6 `"On a genuine deferral, schedules a governed follow-up rather than going dark or falsely promising a slot hold"`; bump `JUDGE_RUBRIC_VERSION` → `"judge-medspa@1.1.0"`.

- [ ] **Step 7: Add the three fixtures** to `evals/alex-conversation/fixtures/gen-objection-time-trust.jsonl` (append; one JSON object per line):

(1) "let me think → surface + schedule follow-up" (SG), (2) "maybe later → light follow-up" (MY), (3) "stated deadline → honest urgency" (SG). Each oracle: `{"expectedTools":["follow-up"],"forbiddenTools":["calendar-book"],"expectsBooking":false}` (scenario 3 omits `expectedTools`). Grade blocks: `mustNot:["pressure_booking","hold_slot","guarantee_results","manufactured_urgency"]`, `mustDo:["acknowledge","schedule a governed follow-up"]`. (Full JSONL bodies in delta spec §Delta C / mapping appendix.)

- [ ] **Step 8: Run the structural eval suite + the matrix test; verify fixtures load + bounds hold.**

Run: `pnpm --filter @switchboard/alex-conversation test`
Expected: PASS — `loadConversationFixtures` accepts the new `follow-up` oracles; `matrix.test.ts` bounds (≤95 fixtures, objection stage ≥3) still hold.

- [ ] **Step 9: Commit.**
```bash
git add skills/alex evals/alex-conversation
git commit -m "feat(alex): compliant objection-closing playbook + follow-up tool wiring + eval sync"
```

---

## Self-Review

- **Spec coverage:** PR-1a = Delta D (exclude failed + rename). PR-1b = Delta D (operator-confirmed Showed + coverage + last-updated). PR-1c = Delta D verdict-count (review point #8). PR-2 = Delta C (closing edits + the two "hold a slot" fixes + follow-up wiring + eval-harness sync). Phase-A ops flips (router on, classifier observe) are operator actions, tracked in spec §6 — not code tasks here. Phase B (cadence A, reminders B) = separate plan. ✅ all Phase-A spec items covered.
- **Placeholders:** the only deferral is the full JSONL fixture bodies (Step 7), which are fully specified in the spec's Delta C section + mapping appendix — not invented here. All code steps contain real code.
- **Type consistency:** `countCurrentlyAtStageUpdatedInWindow` + `latestOpportunityStageUpdatedAt` are used identically in the metric builder (Task 2 Step 4), the store impl (Step 8), and the test (Step 6/2). `StatCell.hint?` defined in Task 2 Step 1, used Step 4, rendered Step 10. `appointments-booked` is the single renamed literal across Task 1.

---

## Execution Handoff

Pick an execution mode (after this, Phase B plan covers cadence + reminders):
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch with checkpoints.
