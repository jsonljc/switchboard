# Riley v3 Slice 4f: Executed-Pause Attribution Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make truthfully-executed Phase-C pauses transition their source `PendingActionRecord` to `acted` (anchored at execution time, attributed to a machine sentinel, carrying the executing work-unit id), so `findAttributableCandidates` finally sees them and the outcome ledger can measure Riley's own actions.

**Architecture:** One conditional, race-safe, audit-logged db transition (`markActedByExecution` on `PrismaRecommendationStore`), called from the pause executor's truthful success leg only (Meta write accepted) via a required injected dep, with the work-unit id threaded `params.__recommendation.executedWorkUnitId -> projectBaseCandidate -> AttributableRecommendation -> RileyOutcomeRow.executableWorkUnitId` (column already exists). Zero migrations, zero new flags, zero new routes, zero UI.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turbo), Prisma (mocked in CI tests), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-06-07-riley-v3-slice4f-executed-pause-attribution-design.md` (decision record + consumer sweep live there; this plan implements it).

**Worktree:** `.claude/worktrees/riley-4f-executed-pause-attribution`, branch `feat/riley-4f-executed-pause-attribution` off `origin/main` at `79b4940a`.

**House rules that bite here:** `.js` extensions on relative imports; no `any`; typed `vi.fn` args (arg-less `vi.fn()` breaks the package BUILD via tsc-over-tests); `pnpm format:check` before push (CI lint runs prettier, local lint does not); commitlint lowercase subject; lint-staged may reformat on commit, re-`git add` if so; eslint max-lines (600, skipBlankLines+skipComments) applies to TEST files, so new test bulk goes in NEW co-located files; run `git branch --show-current` before every commit.

---

### Task 0: Commit spec + plan docs

**Files:**

- Create: `docs/superpowers/specs/2026-06-07-riley-v3-slice4f-executed-pause-attribution-design.md` (already written)
- Create: `docs/superpowers/plans/2026-06-07-riley-v3-slice4f-executed-pause-attribution.md` (this file)

- [ ] **Step 0.1: Verify branch and commit**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/riley-4f-executed-pause-attribution
git branch --show-current   # expect: feat/riley-4f-executed-pause-attribution
git add docs/superpowers/specs/2026-06-07-riley-v3-slice4f-executed-pause-attribution-design.md docs/superpowers/plans/2026-06-07-riley-v3-slice4f-executed-pause-attribution.md
git commit -m "docs: riley v3 slice 4f executed-pause attribution spec + plan"
```

(The check-branch-relevance hook may warn on docs-only commits; the slug matches the branch, so it should stay quiet. Warnings are non-blocking signals.)

---

### Task 1: db `markActedByExecution` (the machine transition)

**Files:**

- Modify: `packages/db/src/recommendation-store.ts` (interface `RecommendationParams` ~line 23; new exported type + method after `applyAct` ~line 278)
- Modify: `packages/db/src/index.ts` (~line 129, export the result type)
- Create: `packages/db/src/__tests__/recommendation-store-executed-transition.test.ts`

- [ ] **Step 1.1: Write the failing tests** (new file; the existing `recommendation-store.test.ts` is at 622 raw lines, do not grow it)

```ts
import { describe, expect, it, vi } from "vitest";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Slice 4f: markActedByExecution, the MACHINE sibling of applyAct.
 * Mocked Prisma per repo doctrine (CI has no Postgres); mirrors
 * recommendation-store.test.ts's interactive-$transaction pattern.
 */

const ROW = {
  id: "rec_1",
  organizationId: "org-1",
  sourceAgent: "riley",
  intent: "recommendation.pause",
  humanSummary: "Pause Campaign A",
  confidence: 0.9,
  dollarsAtRisk: 120,
  riskLevel: "high",
  surface: "queue",
  status: "pending",
  parameters: {
    source: "audit",
    __recommendation: {
      action: "pause",
      note: "operator note that must survive",
      riskContract: { riskLevel: "high", externalEffect: true },
    },
  },
  targetEntities: { campaignId: "camp_1", campaignName: "Campaign A" },
  sourceWorkflow: "audit_run_1",
  resolvedBy: null,
  resolvedAt: null,
  createdAt: new Date("2026-06-06T00:00:00Z"),
  expiresAt: new Date("2026-06-06T08:00:00Z"),
  undoableUntil: null,
};

function mockPrisma(opts?: { row?: typeof ROW | null; updateCount?: number }) {
  const prisma = {
    pendingActionRecord: {
      findFirst: vi.fn(async (_args: { where: Record<string, unknown> }) =>
        opts?.row === undefined ? ROW : opts.row,
      ),
      updateMany: vi.fn(
        async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
          count: opts?.updateCount ?? 1,
        }),
      ),
    },
    auditEntry: {
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma),
  );
  return prisma;
}

const ARGS = {
  id: "rec_1",
  organizationId: "org-1",
  executableWorkUnitId: "wu_99",
  resolvedBy: "riley_self_execution",
  executedAt: new Date("2026-06-07T03:30:00Z"),
};

describe("PrismaRecommendationStore.markActedByExecution", () => {
  it("transitions pending -> acted conditionally and stashes the work-unit id (sibling keys preserved)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: true });

    const update = prisma.pendingActionRecord.updateMany.mock.calls[0]![0];
    // The serialization point: id + org + status pending + recommendation intent only.
    expect(update.where).toEqual({
      id: "rec_1",
      organizationId: "org-1",
      status: "pending",
      intent: { startsWith: "recommendation." },
    });
    expect(update.data).toMatchObject({
      status: "acted",
      resolvedAt: ARGS.executedAt,
      resolvedBy: "riley_self_execution",
    });
    const params = update.data.parameters as {
      source: string;
      __recommendation: Record<string, unknown>;
    };
    // Review-requested pin: TOP-LEVEL parameter siblings survive the merge
    // (exactly the kind of thing future refactors break).
    expect(params.source).toBe("audit");
    expect(params.__recommendation).toEqual({
      action: "pause",
      note: "operator note that must survive",
      riskContract: { riskLevel: "high", externalEffect: true },
      executedWorkUnitId: "wu_99",
    });
  });

  it("cannot touch non-recommendation or cross-org rows: both WHEREs carry org + the intent prefix", async () => {
    // Mocked Prisma cannot evaluate predicates, so the WHERE shapes ARE the
    // pins: PendingActionRecord also hosts workflow approval rows, and a
    // forged id from another org must resolve to nothing. Both the existence
    // read and the conditional write carry organizationId AND the
    // recommendation intent prefix (asserted exactly in the tests above and
    // re-asserted here as the named guarantee).
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await store.markActedByExecution({ ...ARGS, organizationId: "org-OTHER" });
    const read = prisma.pendingActionRecord.findFirst.mock.calls[0]![0];
    expect(read.where).toMatchObject({
      organizationId: "org-OTHER",
      intent: { startsWith: "recommendation." },
    });
    const update = prisma.pendingActionRecord.updateMany.mock.calls[0]![0];
    expect(update.where).toMatchObject({
      organizationId: "org-OTHER",
      status: "pending",
      intent: { startsWith: "recommendation." },
    });
  });

  it("writes one audit entry on success, mirroring applyAct's shape with machine actor", async () => {
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await store.markActedByExecution(ARGS);
    expect(prisma.auditEntry.create).toHaveBeenCalledTimes(1);
    const audit = prisma.auditEntry.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(audit).toMatchObject({
      eventType: "recommendation.act",
      actorType: "system",
      actorId: "riley_self_execution",
      entityType: "recommendation",
      entityId: "rec_1",
      riskCategory: "high",
      summary: "Pause Campaign A",
      organizationId: "org-1",
      snapshot: { from: "pending", to: "acted", note: null, executableWorkUnitId: "wu_99" },
    });
    expect(typeof audit.entryHash).toBe("string");
    expect((audit.entryHash as string).length).toBe(64);
  });

  it("count===0 is a benign first-writer-wins no-op: not_pending, NO audit row, no throw", async () => {
    const prisma = mockPrisma({ updateCount: 0 });
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: false, reason: "not_pending" });
    expect(prisma.auditEntry.create).not.toHaveBeenCalled();
  });

  it("missing row (or cross-org id) is not_found, no update attempted", async () => {
    const prisma = mockPrisma({ row: null });
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: false, reason: "not_found" });
    expect(prisma.pendingActionRecord.updateMany).not.toHaveBeenCalled();
    // The existence read itself must be org-scoped and recommendation-only.
    const read = prisma.pendingActionRecord.findFirst.mock.calls[0]![0];
    expect(read.where).toEqual({
      id: "rec_1",
      organizationId: "org-1",
      intent: { startsWith: "recommendation." },
    });
  });

  it("infra errors propagate (the executor catches them, never this method)", async () => {
    const prisma = mockPrisma();
    prisma.pendingActionRecord.updateMany.mockRejectedValueOnce(new Error("db down"));
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await expect(store.markActedByExecution(ARGS)).rejects.toThrow("db down");
  });
});
```

- [ ] **Step 1.2: Run the tests, verify they fail**

```bash
pnpm --filter @switchboard/db test -- recommendation-store-executed-transition
```

Expected: FAIL with `store.markActedByExecution is not a function`.

- [ ] **Step 1.3: Implement**

In `packages/db/src/recommendation-store.ts`, extend the `__recommendation` interface (~line 24):

```ts
interface RecommendationParams {
  __recommendation?: {
    action?: string;
    note?: string | null;
    presentation?: unknown;
    riskContract?: RecommendationRiskContract;
    /** Slice 4f: WorkUnit.id of the machine execution that acted this rec. */
    executedWorkUnitId?: string;
  };
  [key: string]: unknown;
}
```

Add the exported result type above the class:

```ts
/** Result of the machine-execution transition. "not_pending" and "not_found"
 * are benign first-writer-wins no-ops, never errors. */
export type MarkActedByExecutionResult =
  | { transitioned: true }
  | { transitioned: false; reason: "not_found" | "not_pending" };
```

Add the method to `PrismaRecommendationStore` directly after `applyAct`:

```ts
  /**
   * Machine-execution transition (Riley Phase-C slice 4f): marks a
   * recommendation acted AFTER the platform actually executed it (Meta write
   * accepted). The MACHINE sibling of applyAct above, deliberately mirroring
   * its tx shape with three differences: conditional updateMany instead of
   * update (a lost race returns count 0 and MUST be a benign no-op, never a
   * throw: operator acted/dismissed concurrently, lazy expiry won, or a retry
   * already transitioned); resolvedAt is the caller's execution clock (the
   * outcome-attribution anchor), not new Date(); resolvedBy is the caller's
   * machine sentinel, never a human principal. The status predicate is the
   * serialization point against applyAct, so the parameters merge cannot
   * clobber a concurrent operator write: two writers cannot both pass it.
   * The intent guard keeps this method off workflow approval rows, which
   * share the PendingActionRecord table.
   */
  async markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pendingActionRecord.findFirst({
        where: {
          id: args.id,
          organizationId: args.organizationId,
          intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        },
      });
      if (!existing) return { transitioned: false, reason: "not_found" };

      const params = (existing.parameters ?? {}) as RecommendationParams;
      const updatedMeta = {
        ...(params.__recommendation ?? {}),
        executedWorkUnitId: args.executableWorkUnitId,
      };
      const updated = await tx.pendingActionRecord.updateMany({
        where: {
          id: args.id,
          organizationId: args.organizationId,
          status: "pending",
          intent: { startsWith: RECOMMENDATION_INTENT_PREFIX },
        },
        data: {
          status: "acted",
          resolvedAt: args.executedAt,
          resolvedBy: args.resolvedBy,
          parameters: { ...params, __recommendation: updatedMeta } as object,
        },
      });
      if (updated.count === 0) return { transitioned: false, reason: "not_pending" };

      await tx.auditEntry.create({
        data: {
          eventType: "recommendation.act",
          actorType: "system",
          actorId: args.resolvedBy,
          entityType: "recommendation",
          entityId: args.id,
          riskCategory: existing.riskLevel,
          summary: existing.humanSummary,
          snapshot: {
            from: "pending",
            to: "acted",
            note: null,
            executableWorkUnitId: args.executableWorkUnitId,
          } as object,
          evidencePointers: [] as object,
          // ts = the EXECUTION clock, not Date.now(): this slice anchors truth
          // at execution time and the hash input must not silently depend on a
          // second wall clock (review-requested). Uniqueness is unaffected
          // (buildEntryHash salts with a random UUID), which also makes the ts
          // source non-black-box-testable; this comment is the record.
          // applyAct keeps Date.now() because its event clock IS the wall clock.
          entryHash: buildEntryHash({
            id: args.id,
            fromStatus: "pending",
            toStatus: "acted",
            principalId: args.resolvedBy,
            ts: args.executedAt.getTime(),
          }),
          organizationId: existing.organizationId,
        },
      });
      return { transitioned: true };
    });
  }
```

In `packages/db/src/index.ts` (~line 129):

```ts
export {
  PrismaRecommendationStore,
  type MarkActedByExecutionResult,
} from "./recommendation-store.js";
```

- [ ] **Step 1.4: Run tests, verify pass**

```bash
pnpm --filter @switchboard/db test -- recommendation-store-executed-transition
pnpm --filter @switchboard/db test    # full package: no regressions
pnpm --filter @switchboard/db build
```

Expected: all PASS, build clean.

- [ ] **Step 1.5: Commit**

```bash
git branch --show-current
git add packages/db/src/recommendation-store.ts packages/db/src/index.ts packages/db/src/__tests__/recommendation-store-executed-transition.test.ts
git commit -m "feat(db): markActedByExecution machine transition on recommendation store"
```

---

### Task 2: thread `executableWorkUnitId` (core type + passthrough, db projection)

**Files:**

- Modify: `packages/core/src/recommendations/outcome-attribution-types.ts` (~line 124, `AttributableRecommendation`)
- Modify: `packages/core/src/recommendations/outcome-attribution.ts` (line 178)
- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts` (REC fixture, line ~13)
- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution-corroboration.test.ts` (REC fixture, line ~26)
- Create: `packages/core/src/recommendations/__tests__/outcome-attribution-linkage.test.ts`
- Modify: `packages/db/src/recommendation-outcome-store.ts` (`projectBaseCandidate`, ~line 317)
- Modify: `packages/db/src/__tests__/recommendation-outcome-store.test.ts` (new threading tests in the candidates describe block)

- [ ] **Step 2.1: Write the failing core test** (new small file; `outcome-attribution.test.ts` is at the 600-line ceiling)

```ts
import { describe, expect, it } from "vitest";
import { attributeOneRecommendation } from "../outcome-attribution.js";
import type { AttributableRecommendation, WindowMetrics } from "../outcome-attribution-types.js";

/** Slice 4f: the executing work-unit id flows candidate -> outcome row. */

function w(spendCents: number): WindowMetrics {
  return { spendCents, ctr: 0.04, dailyRowCount: 7 };
}

const BASE: AttributableRecommendation = {
  id: "rec-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
  executableWorkUnitId: null,
};

describe("executableWorkUnitId passthrough", () => {
  it("a machine-acted candidate's work-unit id lands on the outcome row", () => {
    const row = attributeOneRecommendation({
      candidate: { ...BASE, executableWorkUnitId: "wu_99" },
      preWindow: w(50_000),
      postWindow: w(10_000),
      overlaps: [],
    });
    expect(row.executableWorkUnitId).toBe("wu_99");
    expect(row.recommendationId).toBe("rec-1");
  });

  it("an operator-acted candidate (null) stays null, byte-identical to today", () => {
    const row = attributeOneRecommendation({
      candidate: BASE,
      preWindow: w(50_000),
      postWindow: w(10_000),
      overlaps: [],
    });
    expect(row.executableWorkUnitId).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run it, verify it fails**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution-linkage
```

Expected: FAIL. TypeScript first complains `executableWorkUnitId` is not in `AttributableRecommendation`; after the type lands it fails on `row.executableWorkUnitId` being `null` instead of `"wu_99"`.

- [ ] **Step 2.3: Implement core**

`outcome-attribution-types.ts`, `AttributableRecommendation` (~line 124):

```ts
export interface AttributableRecommendation {
  id: string;
  organizationId: string;
  campaignId: string;
  actionKind: AttributableKind;
  resolvedAt: Date;
  /**
   * Slice 4f: WorkUnit.id of the machine execution that acted this
   * recommendation (stashed by markActedByExecution); null for
   * operator-acted rows. Required (not optional) so every constructor
   * site decides explicitly.
   */
  executableWorkUnitId: string | null;
}
```

`outcome-attribution.ts` line 178: replace `executableWorkUnitId: null,` with:

```ts
    executableWorkUnitId: candidate.executableWorkUnitId,
```

Fixture updates (compiler-driven; the two known literals):

`__tests__/outcome-attribution.test.ts` line ~13 and `__tests__/outcome-attribution-corroboration.test.ts` line ~26, both `const REC`, gain:

```ts
  executableWorkUnitId: null,
```

(`{ ...REC, ... }` spreads inherit it; run typecheck to catch any literal the grep missed.)

- [ ] **Step 2.4: Write the failing db projection tests**

In `packages/db/src/__tests__/recommendation-outcome-store.test.ts`, inside the `findAttributableCandidates` describe block (~line 317), add (reusing the file's existing row-builder helpers; check its local naming and mirror it):

```ts
it("threads the executedWorkUnitId stash into the candidate (machine-acted row)", async () => {
  const prisma = mockPrismaForCandidates([
    candidateRow({
      id: "rec_m",
      parameters: {
        __recommendation: { action: "pause", executedWorkUnitId: "wu_42" },
      },
    }),
  ]);
  const store = new PrismaAttributableRecommendationStore(prisma);
  const out = await store.findAttributableCandidates({ organizationId: "org-1", now });
  expect(out[0]).toMatchObject({ id: "rec_m", executableWorkUnitId: "wu_42" });
});

it("operator-acted rows (no stash) project null; a non-string stash projects null", async () => {
  const prisma = mockPrismaForCandidates([
    candidateRow({ id: "rec_o", parameters: { __recommendation: { action: "pause" } } }),
    candidateRow({
      id: "rec_bad",
      parameters: { __recommendation: { action: "pause", executedWorkUnitId: 7 } },
    }),
  ]);
  const store = new PrismaAttributableRecommendationStore(prisma);
  const out = await store.findAttributableCandidates({ organizationId: "org-1", now });
  expect(out[0]).toMatchObject({ id: "rec_o", executableWorkUnitId: null });
  expect(out[1]).toMatchObject({ id: "rec_bad", executableWorkUnitId: null });
});
```

(`mockPrismaForCandidates`/`candidateRow` stand for the file's actual helpers; read the describe block first and reuse its exact builder functions and `now` constant rather than inventing parallel ones.)

- [ ] **Step 2.5: Run, verify the new db tests fail, then implement the projection**

```bash
pnpm --filter @switchboard/db test -- recommendation-outcome-store
```

Expected: the two new tests FAIL (`executableWorkUnitId` undefined on the candidate).

`packages/db/src/recommendation-outcome-store.ts`, `projectBaseCandidate` (~line 317):

```ts
function projectBaseCandidate(row: PrismaCandidateRow): AttributableRecommendation | null {
  if (!row.resolvedAt) return null;

  const params = (row.parameters ?? {}) as {
    __recommendation?: { action?: string; executedWorkUnitId?: unknown };
  };
  const kind = params.__recommendation?.action;
  if (!isAttributableKind(kind)) return null;

  const identity = extractCampaignIdentity(row);
  if (!identity) return null;

  // Slice 4f: machine executions stash their WorkUnit.id; operator-acted
  // rows have no stash. Tolerant read: anything non-string is honest null.
  const stashed = params.__recommendation?.executedWorkUnitId;

  return {
    id: row.id,
    organizationId: row.organizationId,
    campaignId: identity.campaignId,
    actionKind: kind,
    resolvedAt: row.resolvedAt,
    executableWorkUnitId: typeof stashed === "string" ? stashed : null,
  };
}
```

- [ ] **Step 2.6: Run the full chain, verify pass**

```bash
pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core build
pnpm --filter @switchboard/db test && pnpm --filter @switchboard/db build
```

Expected: all PASS (the orchestrator tests in core construct candidates via `{ ...REC }` so they inherit the field).

- [ ] **Step 2.7: Commit**

```bash
git branch --show-current
git add packages/core/src/recommendations/outcome-attribution-types.ts packages/core/src/recommendations/outcome-attribution.ts packages/core/src/recommendations/__tests__/ packages/db/src/recommendation-outcome-store.ts packages/db/src/__tests__/recommendation-outcome-store.test.ts
git commit -m "feat(core,db): thread executableWorkUnitId from acted recommendation to outcome row"
```

---

### Task 3: executor success-leg transition + bootstrap wiring + world wiring

These land together because the dep is REQUIRED: adding it to the executor breaks compile of every `buildRileyPauseExecutionWorkflow` call site (unit harness, bootstrap, lifecycle world) until all are wired. Each gets its truthful implementation in this task; every commit stays green.

**Files:**

- Modify: `apps/api/src/services/workflows/riley-pause-execution-workflow.ts` (deps interface ~line 25; success leg ~line 196; new exported sentinel)
- Modify: `apps/api/src/services/workflows/__tests__/riley-pause-execution-workflow.test.ts` (harness + per-leg pins + new success-leg tests)
- Modify: `apps/api/src/bootstrap/riley-pause-executor.ts` (exported closure builder + wiring)
- Modify: `apps/api/src/bootstrap/__tests__/riley-pause-executor.test.ts` (closure test)
- Modify: `apps/api/src/__tests__/riley-pause-lifecycle-world.ts` (in-memory rec row + dep over the REAL closure builder)

- [ ] **Step 3.1: Write the failing executor tests**

In `__tests__/riley-pause-execution-workflow.test.ts`:

(a) extend `harness()` so every test supplies the new dep (typed `vi.fn` args, the build-breaking trap):

```ts
function harness(overrides?: {
  creds?: { accessToken: string; accountId: string } | null | "org_mismatch";
  campaignStatus?: { status: string; effectiveStatus: string } | null;
  updateCampaignStatus?: ReturnType<typeof vi.fn>;
  markRecommendationActed?: ReturnType<typeof vi.fn>;
}) {
  // ... existing body unchanged, plus:
  const markRecommendationActed =
    overrides?.markRecommendationActed ??
    vi.fn(
      async (_args: {
        organizationId: string;
        recommendationId: string;
        executableWorkUnitId: string;
        executedAt: Date;
      }) => ({ transitioned: true as const }),
    );
  const deps = {
    // ... existing deps unchanged ...
    markRecommendationActed,
    now: () => NOW,
  };
  return { deps, updateCampaignStatus, getCampaignStatus, markRecommendationActed };
}
```

(b) new describe block:

```ts
describe("slice 4f: recommendation transition on the truthful success leg ONLY", () => {
  it("transitions after a real Meta write: exact args, execution-time anchor, outputs truth", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(h.markRecommendationActed).toHaveBeenCalledTimes(1);
    expect(h.markRecommendationActed).toHaveBeenCalledWith({
      organizationId: "org_1",
      recommendationId: "rec_1",
      executableWorkUnitId: "wu_pause_1",
      executedAt: NOW,
    });
    expect(result.outputs).toMatchObject({
      paused: true,
      metaWriteAccepted: true,
      recommendationTransition: "acted",
      executedAt: NOW.toISOString(),
    });
  });

  it("anchors on the execution clock even when requestedAt is ~47h stale (within the cap)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const staleButValid = new Date(NOW.getTime() - 47 * 60 * 60 * 1000).toISOString();
    await handler.execute(workUnit({ requestedAt: staleButValid }), services);
    const call = h.markRecommendationActed.mock.calls[0]![0] as { executedAt: Date };
    expect(call.executedAt).toEqual(NOW); // NOT requestedAt
  });

  it("a benign lost race (not_pending) preserves the success result and records it", async () => {
    const h = harness({
      markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => ({
        transitioned: false as const,
        reason: "not_pending" as const,
      })),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: true,
      metaWriteAccepted: true,
      recommendationTransition: "not_pending",
    });
  });

  it("records not_found DISTINCTLY from not_pending", async () => {
    const h = harness({
      markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => ({
        transitioned: false as const,
        reason: "not_found" as const,
      })),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ recommendationTransition: "not_found" });
  });

  it("a thrown transition error never fails the work unit, and is LOUD (greppable console.error)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const h = harness({
        markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => {
          throw new Error("db down");
        }),
      });
      const handler = buildRileyPauseExecutionWorkflow(h.deps);
      const result = await handler.execute(workUnit(), services);
      expect(result.outcome).toBe("completed");
      expect(result.outputs).toMatchObject({
        paused: true,
        metaWriteAccepted: true,
        recommendationTransition: "error",
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const line = String(errorSpy.mock.calls[0]![0]);
      expect(line).toContain("[riley-pause] failed to mark recommendation acted");
      expect(line).toContain("rec_1");
      expect(line).toContain("wu_pause_1");
      expect(line).toContain("db down");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("already-paused pre-read skip NEVER transitions (no spend change from THIS work unit)", async () => {
    const h = harness({ campaignStatus: { status: "PAUSED", effectiveStatus: "PAUSED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    await handler.execute(workUnit(), services);
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });
});
```

(c) per-leg never-transition pins: add ONE assertion line to EACH existing non-success-leg test, after its existing assertions:

```ts
expect(h.markRecommendationActed).not.toHaveBeenCalled();
```

Legs (the per-leg table from spec decision 3.2): invalid parameters; below execution floor; stale approval; org mismatch; already paused; deleted/archived; no connection; Meta write throws. The two success-path tests that don't already assert the transition (`executes at just under the age cap`, `proceeds with previousStatus unknown`) instead gain:

```ts
expect(h.markRecommendationActed).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3.2: Run, verify failure**

```bash
pnpm --filter api test -- riley-pause-execution-workflow
```

Expected: TypeScript FAIL first (`markRecommendationActed` not in `RileyPauseExecutionDeps`).

- [ ] **Step 3.3: Implement the executor**

In `riley-pause-execution-workflow.ts`:

(a) sentinel, below `RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS`:

```ts
/**
 * resolvedBy sentinel for machine-executed pauses (slice 4f). A distinct
 * machine identifier, never a human principal id: the approver approved, the
 * platform acted. Bare "system" would be ambiguous with the real seeded
 * system principal; workflow rows in the same table already use machine
 * values ("policy_engine", "auto"). Human-approval provenance lives on the
 * lifecycle (respondedBy), the WorkTrace, and the audit snapshot.
 */
export const RILEY_PAUSE_EXECUTION_RESOLVED_BY = "riley_self_execution";
```

(b) deps interface gains (after `createAdsClient`):

```ts
/**
 * Slice 4f: transition the source recommendation to "acted" after a REAL
 * Meta pause write. Called from the truthful success leg ONLY (write
 * accepted); skip/stale/failure legs never call it, and the already-paused
 * pre-read skip is deliberately excluded (no spend change from THIS work
 * unit; attributing a window would measure someone else's action). The
 * implementation is conditional first-writer-wins; benign lost races return
 * transitioned:false, infra errors throw and are caught at the call site.
 */
markRecommendationActed: (args: {
  organizationId: string;
  recommendationId: string;
  executableWorkUnitId: string;
  executedAt: Date;
}) =>
  Promise<{ transitioned: true } | { transitioned: false; reason: "not_found" | "not_pending" }>;
```

(c) success leg: after the `try/catch` around `updateCampaignStatus` and before the `seam` lookup, insert:

```ts
// Slice 4f: the pause REALLY happened (request accepted). Record that
// truth on the source recommendation so outcome attribution can see it;
// resolvedAt = execution time (the attribution windows anchor on it).
// Bookkeeping never fails the work unit: the Meta write is the execution
// truth the operator was promised, so a transition failure is recorded
// in outputs (the WorkTrace is canonical), never converted into a false
// "failed" claim about a pause that succeeded.
const executedAt = now();
let recommendationTransition: "acted" | "not_found" | "not_pending" | "error";
try {
  const transition = await deps.markRecommendationActed({
    organizationId: workUnit.organizationId,
    recommendationId: input.recommendationId,
    executableWorkUnitId: workUnit.id,
    executedAt,
  });
  recommendationTransition = transition.transitioned ? "acted" : transition.reason;
} catch (err) {
  // LOUD: "Meta paused but attribution linkage failed" must be
  // discoverable/alertable, never just trace-archaeology. The benign
  // not_pending/not_found legs above are expected product behavior
  // (first writer won) and are deliberately not error-logged.
  recommendationTransition = "error";
  console.error(
    `[riley-pause] failed to mark recommendation acted org=${workUnit.organizationId} rec=${input.recommendationId} workUnit=${workUnit.id}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

and the success `outputs` object gains two keys:

```ts
          recommendationTransition,
          executedAt: executedAt.toISOString(),
```

- [ ] **Step 3.4: Implement the bootstrap closure**

In `apps/api/src/bootstrap/riley-pause-executor.ts`:

```ts
import type { MarkActedByExecutionResult } from "@switchboard/db";
import {
  buildRileyPauseExecutionWorkflow,
  RILEY_PAUSE_EXECUTION_RESOLVED_BY,
  type RileyPauseCredsResult,
  type RileyPauseExecutionDeps,
} from "../services/workflows/riley-pause-execution-workflow.js";

/**
 * Slice 4f: the executor-facing transition dep over the db store. Extracted
 * and exported so the sentinel + arg mapping are unit-testable without
 * network (the real MetaAdsClient blocks reaching the success leg in
 * bootstrap-level tests).
 */
export function buildMarkRecommendationActed(store: {
  markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult>;
}): RileyPauseExecutionDeps["markRecommendationActed"] {
  return (args) =>
    store.markActedByExecution({
      id: args.recommendationId,
      organizationId: args.organizationId,
      executableWorkUnitId: args.executableWorkUnitId,
      resolvedBy: RILEY_PAUSE_EXECUTION_RESOLVED_BY,
      executedAt: args.executedAt,
    });
}
```

(Note: `MarkActedByExecutionResult` must be imported as a type-only top-level import; the file's other db symbols arrive via the existing dynamic `await import("@switchboard/db")`. A type-only import is erased at build time, so it cannot defeat the lazy-loading intent.)

Inside `buildRileyPauseExecutorHandler`, add `PrismaRecommendationStore` to the dynamic import and wire the dep:

```ts
  const { PrismaDeploymentConnectionStore, PrismaDeploymentStore, PrismaRecommendationStore, decryptCredentials } =
    await import("@switchboard/db");
  // ...
  const recommendationStore = new PrismaRecommendationStore(
    prismaClient as ConstructorParameters<typeof PrismaRecommendationStore>[0],
  );

  const handler = buildRileyPauseExecutionWorkflow({
    getDeploymentCredentials: /* unchanged */,
    createAdsClient: (creds) => new MetaAdsClient(creds),
    markRecommendationActed: buildMarkRecommendationActed(recommendationStore),
  });
```

Add the closure test to `bootstrap/__tests__/riley-pause-executor.test.ts`:

```ts
describe("buildMarkRecommendationActed (slice 4f closure)", () => {
  it("maps recommendationId to the row id and supplies the machine sentinel", async () => {
    const markActedByExecution = vi.fn(
      async (_args: {
        id: string;
        organizationId: string;
        executableWorkUnitId: string;
        resolvedBy: string;
        executedAt: Date;
      }) => ({ transitioned: true as const }),
    );
    const dep = buildMarkRecommendationActed({ markActedByExecution });
    const executedAt = new Date("2026-06-07T03:30:00Z");
    await dep({
      organizationId: "org_1",
      recommendationId: "rec_9",
      executableWorkUnitId: "wu_9",
      executedAt,
    });
    expect(markActedByExecution).toHaveBeenCalledWith({
      id: "rec_9",
      organizationId: "org_1",
      executableWorkUnitId: "wu_9",
      resolvedBy: "riley_self_execution",
      executedAt,
    });
  });
});
```

(import `buildMarkRecommendationActed` beside the existing import; the existing bootstrap tests stay green because their legs fail before the write, and `PrismaRecommendationStore`'s constructor only stores the client reference.)

- [ ] **Step 3.5: Wire the lifecycle world through the REAL closure builder**

In `apps/api/src/__tests__/riley-pause-lifecycle-world.ts`, inside `buildPauseLifecycleWorld` before the executor construction:

```ts
// Slice 4f: an in-memory recommendation row honoring markActedByExecution's
// conditional contract, driven through the REAL bootstrap closure so the
// loop also pins the sentinel + arg mapping. Tests may mutate `status` to
// simulate an operator preempt.
const recommendationRow = {
  id: "rec_1",
  organizationId: ORG,
  intent: "recommendation.pause",
  status: "pending" as string,
  resolvedAt: null as Date | null,
  resolvedBy: null as string | null,
  executedWorkUnitId: null as string | null,
};
const markRecommendationActed = buildMarkRecommendationActed({
  markActedByExecution: async (args) => {
    if (
      args.id !== recommendationRow.id ||
      args.organizationId !== recommendationRow.organizationId
    ) {
      return { transitioned: false, reason: "not_found" };
    }
    if (recommendationRow.status !== "pending") {
      return { transitioned: false, reason: "not_pending" };
    }
    recommendationRow.status = "acted";
    recommendationRow.resolvedAt = args.executedAt;
    recommendationRow.resolvedBy = args.resolvedBy;
    recommendationRow.executedWorkUnitId = args.executableWorkUnitId;
    return { transitioned: true };
  },
});
```

with imports:

```ts
import { buildMarkRecommendationActed } from "../bootstrap/riley-pause-executor.js";
```

pass `markRecommendationActed` into `buildRileyPauseExecutionWorkflow({...})`, and expose the row on the harness return:

```ts
    harness: {
      ingress,
      traceStore,
      metaCalls,
      recommendationRow,
      breakMetaOnce: () => {
        sabotage.failNext = true;
      },
    },
```

- [ ] **Step 3.6: Run the api package, verify green**

```bash
pnpm --filter api test -- riley-pause
pnpm --filter api build
```

Expected: execution-workflow, executor-bootstrap, approval-loop, cron-loop, gate suites all PASS (the world supplies the dep internally so existing loop tests compile unchanged; `riley-pause-approval-loop` line 79's `toMatchObject` tolerates the two new output keys). Build clean (typed vi.fn args).

- [ ] **Step 3.7: Commit**

```bash
git branch --show-current
git add apps/api/src/services/workflows/riley-pause-execution-workflow.ts apps/api/src/services/workflows/__tests__/riley-pause-execution-workflow.test.ts apps/api/src/bootstrap/riley-pause-executor.ts apps/api/src/bootstrap/__tests__/riley-pause-executor.test.ts apps/api/src/__tests__/riley-pause-lifecycle-world.ts
git commit -m "feat(api): riley pause executor transitions the recommendation on the truthful success leg"
```

---

### Task 4: end-to-end loop pins (the #860 lesson)

**Files:**

- Create: `apps/api/src/__tests__/riley-pause-executed-attribution-loop.test.ts` (new file: the existing loop file is the PR-1 keystone at 179 lines; 4f pins are their own keystone and the test-file line ceiling rewards splitting now)

- [ ] **Step 4.1: Write the failing e2e tests**

```ts
/**
 * Slice 4f keystone: the executed pause becomes ATTRIBUTABLE. Traces the full
 * leg the #860 lesson demands (gate-decision tests do not cover post-approval):
 *
 *   submit -> park -> approve -> execute -> recommendation transitioned
 *   (acted, resolvedAt = EXECUTION clock not requestedAt, machine sentinel,
 *   work-unit id stashed) -> the row satisfies the candidates predicate
 *
 * plus the never-transition negatives: reject, recovery-then-retry exactly
 * once, operator preempt (pause still completes; transition no-ops).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { respondToParkedLifecycle } from "@switchboard/core";
import { RILEY_PAUSE_EXECUTION_RESOLVED_BY } from "../services/workflows/riley-pause-execution-workflow.js";
import { buildRileyPauseSubmitRequest } from "../services/workflows/riley-pause-submit-request.js";
import { buildPauseLifecycleWorld } from "./riley-pause-lifecycle-world.js";
import { ORG } from "./recommendation-handoff-harness.js";

const submitInput = {
  organizationId: ORG,
  recommendationId: "rec_1",
  campaignId: "camp_1",
  rationale: "sustained spend with zero booked revenue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};
const dep = { deploymentId: "dep-riley", skillSlug: "ad-optimizer" };

async function park(w: ReturnType<typeof buildPauseLifecycleWorld>) {
  const res = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
  if (!res.ok) throw new Error("submit failed");
  const lifecycleId = (res as { lifecycleId?: string }).lifecycleId!;
  const bindingHash = (res as { bindingHash?: string }).bindingHash!;
  return { lifecycleId, bindingHash };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("riley executed-pause attribution loop (slice 4f)", () => {
  it("park -> approve -> execute: the rec row is acted, anchored on EXECUTION time, candidate-eligible", async () => {
    vi.useFakeTimers();
    const parkAt = new Date("2026-06-06T00:00:00.000Z");
    vi.setSystemTime(parkAt);
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);
    expect(w.harness.recommendationRow.status).toBe("pending");

    // Approve 20h later: inside the platform's 24h park expiry, but far enough
    // from requestedAt that a requestedAt-anchored transition fails loudly.
    const executeAt = new Date("2026-06-06T20:00:00.000Z");
    vi.setSystemTime(executeAt);
    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);

    const row = w.harness.recommendationRow;
    expect(row.status).toBe("acted");
    expect(row.resolvedAt).toEqual(executeAt); // the attribution anchor: execution, not submit
    expect(row.resolvedBy).toBe(RILEY_PAUSE_EXECUTION_RESOLVED_BY);

    // The stash links the rec to the executing work unit (= the parked unit).
    // Review-requested agreement pin: the WorkTrace and the rec row name the
    // SAME work-unit id.
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(row.executedWorkUnitId).toBe(lifecycle!.actionEnvelopeId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.workUnitId).toBe(row.executedWorkUnitId);
    expect(trace.executionOutputs).toMatchObject({
      recommendationTransition: "acted",
      executedAt: executeAt.toISOString(),
    });

    // The candidates predicate (findAttributableCandidates WHERE, pinned in db
    // tests): acted + resolvedAt + recommendation.* intent.
    expect(row.intent.startsWith("recommendation.")).toBe(true);
    expect(row.resolvedAt).not.toBeNull();
  });

  it("reject transitions nothing", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId } = await park(w);
    await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(w.harness.recommendationRow.status).toBe("pending");
    expect(w.harness.recommendationRow.resolvedAt).toBeNull();
  });

  it("a failed Meta write transitions nothing; the recovery retry transitions exactly once", async () => {
    const w = buildPauseLifecycleWorld();
    w.harness.breakMetaOnce();
    const { lifecycleId, bindingHash } = await park(w);

    const first = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(first.executionResult?.success).toBe(false);
    expect(w.harness.recommendationRow.status).toBe("pending"); // META_PAUSE_FAILED leg never transitions

    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.recommendationRow.status).toBe("acted");
  });

  it("operator preempt: the pause still completes; the transition is a recorded benign no-op", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);
    w.harness.recommendationRow.status = "dismissed"; // operator got there first

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);
    expect(w.harness.recommendationRow.status).toBe("dismissed"); // first writer won
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.executionOutputs).toMatchObject({ recommendationTransition: "not_pending" });
  });
});
```

- [ ] **Step 4.2: Run, verify state**

```bash
pnpm --filter api test -- riley-pause-executed-attribution-loop
```

Expected: PASS immediately IF Task 3 was implemented correctly (this task is tests-only; a failure here is a Task 3 bug, debug there). If `recommendationRow` is missing on the harness type, that is a Task 3.5 omission.

- [ ] **Step 4.3: Run the full api suite**

```bash
pnpm --filter api test
```

Expected: PASS (known local flakes that need Postgres: work-trace/ledger/greeting pg_advisory tests; rerun in isolation if hit).

- [ ] **Step 4.4: Commit**

```bash
git branch --show-current
git add apps/api/src/__tests__/riley-pause-executed-attribution-loop.test.ts
git commit -m "test(api): end-to-end executed-pause attribution loop pins"
```

---

### Task 5: full verification gates

- [ ] **Step 5.1: Build + typecheck + tests, whole repo**

```bash
pnpm build && pnpm typecheck && pnpm test
```

Expected: green. (Known flakes to rerun in isolation before investigating: chat gateway-bridge-attribution under parallel turbo load; db pg_advisory suites.)

- [ ] **Step 5.2: Lint + format + arch**

```bash
pnpm lint && pnpm format:check && pnpm arch:check
```

Expected: clean. `recommendation-store.ts` lands ~440 raw lines (limit 600); test files all under their ceilings.

- [ ] **Step 5.3: Eval gates byte-identical**

```bash
pnpm eval:riley && pnpm eval:governance
```

Expected: 12+10+6 golden + arbitration and 26 governance cases pass unchanged (the outcome path has no `evals/` import contact; this proves it).

- [ ] **Step 5.4: Doctrine proofs for the PR body**

```bash
(cd .agent/tools && ./check-routes 2>&1 | tail -3)        # expect: only the pre-existing allowlist suppressions, zero new findings
git diff origin/main...HEAD --stat                         # three-dot (worktrees share refs)
git diff origin/main...HEAD -- packages/ad-optimizer packages/schemas apps/dashboard apps/chat   # expect: EMPTY
grep -rn "adoptimizer\." apps/api/src packages --include="*.ts" -l | grep -v dist | sort > /tmp/intents-after.txt && git stash list >/dev/null  # intent grep: no NEW intent strings vs main
pnpm db:check-drift                                        # no schema change; proves it
CI=1 npx tsx scripts/local-verify-fast.ts                  # the local CI mirror, if time permits
```

- [ ] **Step 5.5: Push and open the PR**

```bash
git push -u origin feat/riley-4f-executed-pause-attribution
gh pr create --title "feat(db,core,api): riley v3 slice 4f executed-pause attribution linkage" --body "<body>"
```

PR body must include: the one-paragraph what/why (spec section 1); the doctrine note (NOT a new mutating surface: post-execution truth record on an already-ingress-governed flow, the operator applyAct precedent, "outcome-linked traces matter" invariant); the consumer-sweep table verdicts INCLUDING the resolvedBy/actedBy grep evidence (no UI consumer renders actedBy; wins never reads it); the race matrix, with `not_pending` documented as "first writer won; the pause still executed"; zero-diff proofs (ad-optimizer/schemas/dashboard/chat empty, no migration, check-routes clean, evals byte-identical); the recorded residue (lazy-expired corner 3.7, manual-preempt approval-card-vs-pending-rec wrinkle 3.2). CLAIM DISCIPLINE: say "makes executed Riley pauses attributable and linkable to the executing work unit"; never claim it proves executed pauses earn corroborated (that stays the 4d predicate's call over the resulting rows).

---

### Task 6: reviews, merge, teardown

- [ ] **Step 6.1:** Dispatch standard code review (superpowers:requesting-code-review) on the diff.
- [ ] **Step 6.2:** Dispatch the ADVERSARIAL reviewer with the explicit truth-violation hunt: transition on any non-success leg, double transition, wrong anchor (requestedAt/approval-time instead of execution), misattributed actor (any surface now claiming a human acted), N+1 missed status consumer, params-merge clobber, the count===0 leg throwing.
- [ ] **Step 6.3:** Fix all findings in-branch (ship clean, no follow-up deferrals); re-run Task 5 gates after fixes.
- [ ] **Step 6.4:** Merge on green CI (squash; lowercase subject), then same-day:

```bash
cd /Users/jasonli/switchboard
git worktree remove .claude/worktrees/riley-4f-executed-pause-attribution && git worktree prune
```

---

## Self-review (done at write time)

- Spec coverage: section 2 contract = Task 1; decision 3.1/3.2/3.3 legs = Task 3; 3.4 anchor = Tasks 3 (unit, 47h) + 4 (e2e, 20h: the platform's 24h park expiry makes a >24h e2e fixture unreachable through respond, which is itself pinned by the existing stale-park test); 3.5 sentinel = Tasks 1/3 + closure test; 3.8 threading = Task 2; 3.9 no-flag = absence everywhere + zero-diff proofs in Task 5; section 4 race matrix = Task 4 (operator preempt, recovery-retry, reject) + Task 1 (count 0) + existing already-paused/duplicate-submit tests; section 5 sweep = no code change required, verdicts restated in the PR body; section 7 test doctrine = Tasks 1-4 one for one.
- Placeholders: none; every step carries the code or the exact command. The two `mockPrismaForCandidates`/`candidateRow` names in Step 2.4 are explicitly flagged as stand-ins for the file's real helpers, with the instruction to reuse them.
- Type consistency: `markActedByExecution(args)` signature identical in Task 1 impl, Task 1 tests, Task 3 closure, world stub; `markRecommendationActed` dep signature identical in executor deps, harness, closure return type, e2e usage; `recommendationTransition` vocabulary `"acted" | "not_found" | "not_pending" | "error"` consistent across executor, tests, e2e.
