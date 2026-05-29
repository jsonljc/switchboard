# Alex Skill-Pack Provisioning Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a missing/empty Alex medspa skill pack a hard precondition for going live, by adding a blocking `alex-skill-pack-seeded` readiness check that reuses the existing `assertAlexSkillPackSeeded` guard — without touching `agents.ts`, `SkillMode`, or the GET `/config` seed.

**Architecture:** `assertAlexSkillPackSeeded` (db) is narrowed to a structural `KnowledgeEntryReader` so the readiness module can call it with its narrow `PrismaLike` prisma. `buildReadinessContext` runs the guard in a `try/catch` → a boolean (`alexSkillPackSeeded`) + an internal diagnostic; `checkReadiness` emits a blocking check. The activate route already returns 400 on `!report.ready`, so enforcement needs no route change.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Prisma, Fastify, Vitest. Monorepo: `pnpm` + Turborepo. CI has **no Postgres** — db/api tests use mocked Prisma.

**Spec:** `docs/superpowers/specs/2026-05-25-alex-skillpack-provisioning-guard-design.md`

---

## File structure

| File                                                | Responsibility             | Change                                                                                                                                                                        |
| --------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed/seed-alex-skill-pack.ts`      | The guard + scopes         | Add `KnowledgeEntryReader` interface; narrow `assertAlexSkillPackSeeded`'s param. Body unchanged.                                                                             |
| `packages/db/src/index.ts`                          | db public barrel           | Re-export `type KnowledgeEntryReader`.                                                                                                                                        |
| `packages/db/src/seed/seed-alex-skill-pack.test.ts` | Guard tests                | Add a structural-reader acceptance test.                                                                                                                                      |
| `apps/api/src/routes/readiness.ts`                  | Readiness context + checks | Extend `PrismaLike`; add `alexSkillPackSeeded` + `alexSkillPackDiagnostic` to `ReadinessContext`; reuse the guard in `buildReadinessContext`; add `checkAlexSkillPackSeeded`. |
| `apps/api/src/routes/__tests__/readiness.test.ts`   | Readiness tests            | Update `makeContext` + headline count; add pure-check tests + the full-chain `buildReadinessContext` IO tests.                                                                |

**Two commits (code-only PR):** (1) `refactor(db)` narrow the guard; (2) `feat(api)` readiness check + tests.

---

## Task 0: Prerequisites (worktree + baseline)

This is a **code-only** implementation PR, separate from the docs PR that carries this plan and the spec. Create a fresh worktree from up-to-date `origin/main`.

- [ ] **Step 1: Confirm a clean worktree on current `origin/main`**

Run:

```bash
git fetch origin main
git rev-parse HEAD            # should equal origin/main
git branch --show-current
```

Expected: HEAD matches `origin/main`; on a dedicated implementation branch (e.g. `feat/alex-skillpack-provisioning-guard`), inside `.claude/worktrees/`.

- [ ] **Step 2: Initialize the worktree**

Run: `pnpm worktree:init`
Expected: env set up, deps installed, (if Postgres reachable) migrate/build/seed complete. If Postgres is unreachable, run `pnpm local:setup` after starting it — but it is **not** required for these mocked-Prisma tests.

- [ ] **Step 3: Baseline — the two target test files pass before changes**

Run:

```bash
pnpm --filter @switchboard/db test -- seed-alex-skill-pack
pnpm --filter @switchboard/api test -- readiness
```

Expected: both PASS (the `readiness` suite asserts `toHaveLength(11)` today). If `@switchboard/db` exports look stale at any point, run `pnpm reset`.

---

## Task 1: Narrow the guard to a structural reader (db)

**Files:**

- Modify: `packages/db/src/seed/seed-alex-skill-pack.ts:93` (signature) + add interface
- Modify: `packages/db/src/index.ts:139-143` (re-export the type)
- Test: `packages/db/src/seed/seed-alex-skill-pack.test.ts`

- [ ] **Step 1: Write the failing test (structural-reader acceptance)**

In `seed-alex-skill-pack.test.ts`, update the import (top of file) to pull the new type, then add a test at the end of the `describe("assertAlexSkillPackSeeded", …)` block.

Change the import block (currently lines 4-8):

```ts
import {
  seedAlexSkillPack,
  assertAlexSkillPackSeeded,
  ALEX_SKILL_PACK_SCOPES,
  type KnowledgeEntryReader,
} from "./seed-alex-skill-pack.js";
```

Add inside `describe("assertAlexSkillPackSeeded", …)` (after the existing `"throws for org_other …"` test, before the closing `});`):

```ts
it("accepts a minimal structural reader (only knowledgeEntry.findFirst)", async () => {
  // Proves the param was narrowed from PrismaClient to KnowledgeEntryReader:
  // a bare object exposing just the one query compiles and runs.
  const reader: KnowledgeEntryReader = {
    knowledgeEntry: {
      findFirst: async () => ({ content: "x".repeat(60) }),
    },
  };
  await expect(assertAlexSkillPackSeeded(reader, "org_demo")).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: FAIL — `Module '"./seed-alex-skill-pack.js"' has no exported member 'KnowledgeEntryReader'`. (The vitest run alone would not fail — types are erased at runtime — so the red signal is the typecheck.)

- [ ] **Step 3: Add the interface and narrow the signature**

In `seed-alex-skill-pack.ts`, add the interface immediately above `assertAlexSkillPackSeeded` (after the `SkillPackScope`/`ALEX_SKILL_PACK_SCOPES` block, ~line 50). `KnowledgeKind` is already imported (line 5).

```ts
/**
 * Minimal structural reader satisfied by PrismaClient (and test mocks). Lets
 * assertAlexSkillPackSeeded run against any object exposing the single query it
 * needs — e.g. the API readiness module's narrow PrismaLike — without importing
 * the full PrismaClient shape into a layer-5 caller.
 */
export interface KnowledgeEntryReader {
  knowledgeEntry: {
    findFirst(args: {
      where: { organizationId: string; kind: KnowledgeKind; scope: string; active: boolean };
    }): Promise<{ content: string | null } | null>;
  };
}
```

Change the signature (line 93) from `prisma: PrismaClient` to `prisma: KnowledgeEntryReader` — **body unchanged**:

```ts
export async function assertAlexSkillPackSeeded(
  prisma: KnowledgeEntryReader,
  orgId: string,
): Promise<void> {
```

> Note: `PrismaClient` is still imported and used by `seedAlexSkillPack` (line 133) — do **not** remove the import.

In `packages/db/src/index.ts`, extend the existing re-export block (lines 139-143):

```ts
export {
  seedAlexSkillPack,
  assertAlexSkillPackSeeded,
  ALEX_SKILL_PACK_SCOPES,
  type KnowledgeEntryReader,
} from "./seed/seed-alex-skill-pack.js";
```

- [ ] **Step 4: Run typecheck + tests to verify they pass**

Run:

```bash
pnpm --filter @switchboard/db typecheck
pnpm --filter @switchboard/db test -- seed-alex-skill-pack
```

Expected: typecheck PASS; all `seed-alex-skill-pack` tests PASS (existing suite green under the narrowed signature — the mock cast to `PrismaClient` still satisfies `KnowledgeEntryReader`, and the new structural-reader test passes).

- [ ] **Step 5: Rebuild db so downstream packages see the new export**

Run: `pnpm --filter @switchboard/db build`
Expected: build succeeds; `@switchboard/db` `dist` now exports `KnowledgeEntryReader` for `apps/api` to consume in Task 2. (If a later api typecheck cannot find `KnowledgeEntryReader`, run `pnpm reset`.)

- [ ] **Step 6: Commit (db)**

```bash
git add packages/db/src/seed/seed-alex-skill-pack.ts packages/db/src/index.ts packages/db/src/seed/seed-alex-skill-pack.test.ts
git commit -m "refactor(db): narrow assertAlexSkillPackSeeded to a structural KnowledgeEntryReader" \
  -m "Lets the API readiness module call the guard with its narrow PrismaLike, without dragging in a full PrismaClient. Behavior + thrown messages unchanged; adds a structural-reader acceptance test." \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Blocking readiness check + reuse the guard (api)

ReadinessContext gains two **required** fields, so the pure check, the context builder, and the tests must land together to typecheck. Tests are written first (red), then the full `readiness.ts` change (green).

**Files:**

- Modify: `apps/api/src/routes/readiness.ts` (`PrismaLike`, `ReadinessContext`, `buildReadinessContext`, `checkReadiness`, new `checkAlexSkillPackSeeded`)
- Test: `apps/api/src/routes/__tests__/readiness.test.ts`

- [ ] **Step 1: Write the failing tests**

In `readiness.test.ts`, update the import (line 2) to add the IO symbols:

```ts
import {
  checkReadiness,
  buildReadinessContext,
  type PrismaLike,
  type ReadinessContext,
} from "../readiness.js";
```

In `makeContext()`, add the two fields just before the `...overrides` spread (after the `calendar: { … }` block):

```ts
    alexSkillPackSeeded: true,
    alexSkillPackDiagnostic: null,
    ...overrides,
```

Bump the headline assertion (currently `expect(report.checks).toHaveLength(11);`):

```ts
expect(report.checks).toHaveLength(12);
```

Add the pure-check tests inside `describe("checkReadiness", …)` (e.g. after the existing `email-verified` block):

```ts
// ── alex-skill-pack-seeded ──────────────────────────────────────────────
it("alex-skill-pack-seeded fails (blocking) when the pack is not seeded", () => {
  const report = checkReadiness(
    makeContext({
      alexSkillPackSeeded: false,
      alexSkillPackDiagnostic:
        'missing active KnowledgeEntry for kind="playbook" scope="objection-handling"',
    }),
  );
  const check = report.checks.find((c) => c.id === "alex-skill-pack-seeded")!;
  expect(check.status).toBe("fail");
  expect(check.blocking).toBe(true);
  expect(report.ready).toBe(false);
});

it("alex-skill-pack-seeded passes when the pack is seeded", () => {
  const report = checkReadiness(makeContext());
  const check = report.checks.find((c) => c.id === "alex-skill-pack-seeded")!;
  expect(check.status).toBe("pass");
});

it("alex-skill-pack-seeded message never leaks the diagnostic", () => {
  const report = checkReadiness(
    makeContext({ alexSkillPackSeeded: false, alexSkillPackDiagnostic: "objection-handling" }),
  );
  const check = report.checks.find((c) => c.id === "alex-skill-pack-seeded")!;
  expect(check.message).not.toContain("objection-handling");
});
```

Add the IO tests as a new top-level `describe` (the full-chain proof). Place a mock builder above it:

```ts
function makePrismaMock(opts: { knowledgeRow?: { content: string } | null } = {}): PrismaLike {
  const row = opts.knowledgeRow === undefined ? { content: "x".repeat(80) } : opts.knowledgeRow;
  return {
    managedChannel: { findMany: async () => [] },
    connection: { findMany: async () => [] },
    agentDeployment: { findFirst: async () => null },
    organizationConfig: { findUnique: async () => null },
    deploymentConnection: { findMany: async () => [] },
    dashboardUser: { findFirst: async () => null },
    knowledgeEntry: { findFirst: async () => row },
  } as unknown as PrismaLike;
}

describe("buildReadinessContext — alex skill pack", () => {
  it("sets alexSkillPackSeeded=true when the pack rows exist", async () => {
    const ctx = await buildReadinessContext(makePrismaMock(), "org_demo");
    expect(ctx.alexSkillPackSeeded).toBe(true);
    expect(ctx.alexSkillPackDiagnostic).toBeNull();
  });

  it("full chain: a missing pack blocks go-live", async () => {
    const ctx = await buildReadinessContext(makePrismaMock({ knowledgeRow: null }), "org_demo");
    // context builder
    expect(ctx.alexSkillPackSeeded).toBe(false);
    expect(ctx.alexSkillPackDiagnostic).not.toBeNull();
    // → pure check → gate
    const report = checkReadiness(ctx);
    expect(report.ready).toBe(false);
    const check = report.checks.find((c) => c.id === "alex-skill-pack-seeded")!;
    expect(check.id).toBe("alex-skill-pack-seeded");
    expect(check.blocking).toBe(true);
    expect(check.status).toBe("fail");
  });
});
```

- [ ] **Step 2: Run the readiness suite to verify it fails**

Run: `pnpm --filter @switchboard/api test -- readiness`
Expected: FAIL — typecheck errors (`ReadinessContext` has no `alexSkillPackSeeded`; `PrismaLike` has no `knowledgeEntry`; `buildReadinessContext` export of these fields missing) and/or runtime failures (`toHaveLength(12)` sees 11; `find(... "alex-skill-pack-seeded")` is `undefined`).

- [ ] **Step 3: Implement the readiness changes**

In `apps/api/src/routes/readiness.ts`:

(a) Add the import (top of file, after the existing imports):

```ts
import { assertAlexSkillPackSeeded, type KnowledgeEntryReader } from "@switchboard/db";
```

(b) Extend `PrismaLike` (add a member inside the interface, alongside `dashboardUser`):

```ts
knowledgeEntry: KnowledgeEntryReader["knowledgeEntry"];
```

If Prisma's generics resist this structural reference at `pnpm --filter @switchboard/api typecheck` (i.e. `app.prisma` stops satisfying `PrismaLike`), inline the explicit signature instead — mirroring the other `PrismaLike` members — rather than a cast or `any`:

```ts
  knowledgeEntry: {
    findFirst(args: {
      where: { organizationId: string; kind: KnowledgeKind; scope: string; active: boolean };
    }): Promise<{ content: string | null } | null>;
  };
```

(then add `import type { KnowledgeKind } from "@prisma/client";`).

(c) Add to `ReadinessContext` (alongside the other fields):

```ts
alexSkillPackSeeded: boolean;
alexSkillPackDiagnostic: string | null;
```

(d) In `buildReadinessContext`, immediately before the final `return {`, reuse the guard:

```ts
// Reuse the db guard against live state. required:false on the live SkillMode
// path keeps lead traffic fail-open; this is the safe-to-fail-loud surface.
let alexSkillPackSeeded = true;
let alexSkillPackDiagnostic: string | null = null;
try {
  await assertAlexSkillPackSeeded(prisma, orgId);
} catch (err) {
  alexSkillPackSeeded = false;
  alexSkillPackDiagnostic = err instanceof Error ? err.message : String(err);
  console.warn(
    `[readiness] alex-skill-pack-seeded failed org=${orgId}: ${alexSkillPackDiagnostic}`,
  );
}
```

and add these two fields to the returned object (e.g. after `emailVerified: verifiedUser !== null,`):

```ts
    alexSkillPackSeeded,
    alexSkillPackDiagnostic,
```

(e) Add the pure check (place it with the other `function check…` definitions, after `checkCalendar`):

```ts
function checkAlexSkillPackSeeded(ctx: ReadinessContext): ReadinessCheck {
  const id = "alex-skill-pack-seeded";
  const label = "Alex knowledge pack ready";
  const blocking = true;

  // Public message uses ONLY these friendly strings — never alexSkillPackDiagnostic
  // (the pack is system-owned; precise scopes go to the console.warn above).
  return {
    id,
    label,
    blocking,
    status: ctx.alexSkillPackSeeded ? "pass" : "fail",
    message: ctx.alexSkillPackSeeded
      ? "Alex's medspa knowledge pack is seeded"
      : "Alex's knowledge pack is still finalizing. Please try again shortly or contact support if this persists.",
  };
}
```

(f) Register it in `checkReadiness` (append after `checks.push(checkCalendar(ctx));`):

```ts
// 11. alex-skill-pack-seeded (blocking)
checks.push(checkAlexSkillPackSeeded(ctx));
```

- [ ] **Step 4: Run the readiness suite + api typecheck to verify they pass**

Run:

```bash
pnpm --filter @switchboard/api test -- readiness
pnpm --filter @switchboard/api typecheck
```

Expected: all `readiness` tests PASS (including the full-chain IO test and `toHaveLength(12)`); typecheck PASS. The `console.warn` from the failure IO test printing once is expected.

- [ ] **Step 5: Commit (api)**

```bash
git add apps/api/src/routes/readiness.ts apps/api/src/routes/__tests__/readiness.test.ts
git commit -m "feat(api): block go-live when Alex skill pack is unseeded" \
  -m "Add a blocking alex-skill-pack-seeded readiness check that reuses assertAlexSkillPackSeeded against live DB state. Activation already gates on report.ready, so a missing/empty pack keeps the org at provisioningStatus=pending. Live SkillMode stays fail-open; GET /config seed unchanged." \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full verification (pre-PR)

- [ ] **Step 1: Whole-repo gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm format:check
```

Expected: all PASS. (`pnpm format:check` is required — CI lint runs Prettier even though local `pnpm lint` does not. If `@switchboard/db` exports look stale, run `pnpm reset` then re-run.)

- [ ] **Step 2: Confirm scope fence held**

Run: `git diff --name-only origin/main`
Expected exactly:

```
apps/api/src/routes/__tests__/readiness.test.ts
apps/api/src/routes/readiness.ts
packages/db/src/index.ts
packages/db/src/seed/seed-alex-skill-pack.ts
packages/db/src/seed/seed-alex-skill-pack.test.ts
```

No changes to `agents.ts`, `organizations.ts`, `SkillMode`, the adapter, the classifier, or any schema/migration file. If anything else appears, revert it.

- [ ] **Step 3: Open the code-only PR**

Push the branch and open a PR to `main` titled `feat(api): block go-live when Alex skill pack is unseeded`. Body should link the spec and note: no `agents.ts` change, no new `provisioningStatus` value, no schema migration, no `/config` behavior change.

---

## Self-review (author checklist — already run)

- **Spec coverage:** §4(a) → Task 1; §4(b) → Task 2 steps 3a–3f; §4(c) "no agents.ts change" → enforced by Task 3 step 2; §8 tests → Task 1 step 1 (structural reader), Task 2 step 1 (pure check + full-chain IO). ✅
- **Placeholders:** none — every code step shows complete code. ✅
- **Type consistency:** `KnowledgeEntryReader` (db) ↔ `PrismaLike.knowledgeEntry` (api) use the same `findFirst` shape; context fields `alexSkillPackSeeded`/`alexSkillPackDiagnostic` and check id `alex-skill-pack-seeded` are used identically across builder, check, and tests. ✅
- **Fail-path proof:** Task 2 step 1's "full chain" IO test asserts `alexSkillPackSeeded===false` → `alexSkillPackDiagnostic` set → `ready===false` → failing check id `alex-skill-pack-seeded`, `blocking===true`. ✅
