# `fix/launch-conversation-state-store` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate direct `prisma.conversationState` mutation from API routes by introducing `ConversationStateStore` as the persistence boundary for the three operator mutations, with each mutation recorded transactionally as an honest "operator mutation" `WorkTrace` row distinguished by a new `ingressPath` discriminator.

**Architecture:** Mutations gain a Store boundary in `packages/core/src/platform` (interface) + `packages/db/src/stores` (Prisma impl). Each store method runs the state mutation and the initial `WorkTrace` insert in one Prisma `$transaction` via a new tx-aware `PrismaWorkTraceStore.recordOperatorMutation` method. `WorkTrace` gains `ingressPath` (queryable, hash-covered) and `hashInputVersion` (so pre-existing locked rows still verify against their original `contentHash`). Channel-delivery enrichment lives on `WorkTraceStore.update`, not on `ConversationStateStore`. Routes call `app.conversationStateStore` only.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo). Prisma + PostgreSQL. Fastify v4. Vitest. Existing `WorkTrace` integrity machinery from PR #308 (`contentHash`, `traceVersion`, `WORK_TRACE_HASH_VERSION`).

**Spec:** `docs/superpowers/specs/2026-04-29-fix-launch-conversation-state-store-design.md` — read it before starting.

**Branch / worktree:** Implementation lands on `fix/launch-conversation-state-store`. Create the worktree off latest `origin/main` only after the spec/plan PR (which carries this file) merges:

```bash
cd /Users/jasonli/switchboard
git fetch origin
git worktree add .worktrees/fix-launch-conversation-state-store -b fix/launch-conversation-state-store origin/main
```

---

## File map (locked decisions)

**Create**

- `packages/core/src/platform/conversation-state-store.ts` — `ConversationStateStore` interface + DTOs.
- `packages/db/src/stores/prisma-conversation-state-store.ts` — `PrismaConversationStateStore` class.
- `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts` — unit tests.
- `apps/api/src/__tests__/conversation-state-store.integration.test.ts` — integration test (skipIf no `DATABASE_URL`).
- `packages/db/prisma/migrations/20260429120000_add_worktrace_ingress_path/migration.sql` — schema migration.

**Modify**

- `packages/db/prisma/schema.prisma` — add `ingressPath` + `hashInputVersion` columns to `WorkTrace` model.
- `packages/core/src/platform/work-trace.ts` — add `ingressPath` + `hashInputVersion` fields.
- `packages/core/src/platform/types.ts` — add `"operator_mutation"` to `ExecutionModeName`.
- `packages/core/src/platform/work-trace-hash.ts` — versioned hash input.
- `packages/core/src/platform/work-trace-recorder.ts` — `buildWorkTrace` accepts `ingressPath` (default `"platform_ingress"`).
- `packages/core/src/platform/index.ts` — re-export `ConversationStateStore` types.
- `packages/db/src/stores/prisma-work-trace-store.ts` — persist sets `hashInputVersion = 2` and `ingressPath`; add `recordOperatorMutation(trace, { tx })`.
- `apps/api/src/app.ts` — decorate `app.conversationStateStore` + Fastify type augmentation.
- `apps/api/src/routes/conversations.ts` — PATCH override + POST send call store; remove direct mutation; trim `PrismaLike` to read-only.
- `apps/api/src/routes/escalations.ts` — POST reply calls store.
- `apps/api/src/routes/__tests__/conversations-send.test.ts` — mock `conversationStateStore` instead of `mockPrisma.conversationState`.
- `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts` — same.
- `packages/core/src/platform/__tests__/work-trace-hash.test.ts` — coverage for v1/v2 input shapes.
- `packages/core/src/platform/__tests__/work-trace-recorder.test.ts` — coverage for `ingressPath` defaulting.
- `.audit/08-launch-blocker-sequence.md` — mark Risk #1 shipped (final task).

**Read-only references (do NOT modify in this slice)**

- `packages/core/src/platform/work-trace-integrity.ts` — verify it still passes pre-existing locked rows after the change.
- `packages/db/src/integrity-cutoff.ts` — `WORK_TRACE_INTEGRITY_CUTOFF_AT`. Used by tests.

---

## Conventions followed throughout

- **TDD**: test first, watch it fail, implement, watch it pass, commit. No exceptions.
- **Conventional Commits**. Each task ends in one or more commits with prefixes `feat`, `fix`, `test`, `chore`, `refactor`.
- **ESM only**, `.js` extensions in relative imports for non-Next.js packages.
- **No `any`**, no `console.log`. Unused vars prefixed `_`.
- **No mutating bypass paths**: routes never call `prisma.conversationState.update` after this plan completes.
- **Co-located tests**: `*.test.ts` next to the file, or under `__tests__/` per existing package convention.
- **File size**: error at 600 lines; if any new file would cross 400, split.

---

## Task 1: Schema migration — add `ingressPath` and `hashInputVersion` columns to `WorkTrace`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260429120000_add_worktrace_ingress_path/migration.sql`

- [ ] **Step 1: Edit the Prisma `WorkTrace` model** — add two fields after `traceVersion`:

```prisma
// existing tail of WorkTrace model:
//   contentHash           String?
//   traceVersion          Int       @default(0)
ingressPath      String @default("platform_ingress") @map("ingress_path")
hashInputVersion Int    @default(1) @map("hash_input_version")
```

Place both fields in the model body (above the `@@index` block). Keep the file otherwise unchanged.

- [ ] **Step 2: Write the migration SQL**

```sql
-- AlterTable
ALTER TABLE "WorkTrace"
  ADD COLUMN "ingress_path" TEXT NOT NULL DEFAULT 'platform_ingress',
  ADD COLUMN "hash_input_version" INTEGER NOT NULL DEFAULT 1;
```

The defaults are explicit so backfill happens at column-creation time. Existing rows acquire `ingress_path = 'platform_ingress'` and `hash_input_version = 1`.

- [ ] **Step 3: Regenerate Prisma client**

Run: `pnpm db:generate`
Expected: succeeds with no errors. The generated client now exposes `ingressPath` and `hashInputVersion` on `WorkTrace`.

- [ ] **Step 4: Verify the schema diff matches the migration**

Run (only if you have a local Postgres): `pnpm db:check-drift`
Expected: no drift reported.

If you do not have a local Postgres, skip this step and add `pnpm db:check-drift` to the PR test plan as a merger pre-flight (per `CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260429120000_add_worktrace_ingress_path/migration.sql
git commit -m "feat(db): add ingressPath and hashInputVersion to WorkTrace"
```

---

## Task 2: Extend the `WorkTrace` TypeScript type

**Files:**

- Modify: `packages/core/src/platform/work-trace.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/platform/__tests__/work-trace.test.ts` (create the file if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../work-trace.js";

describe("WorkTrace type", () => {
  it("accepts ingressPath = 'platform_ingress'", () => {
    const t: Partial<WorkTrace> = { ingressPath: "platform_ingress" };
    expect(t.ingressPath).toBe("platform_ingress");
  });

  it("accepts ingressPath = 'store_recorded_operator_mutation'", () => {
    const t: Partial<WorkTrace> = { ingressPath: "store_recorded_operator_mutation" };
    expect(t.ingressPath).toBe("store_recorded_operator_mutation");
  });

  it("accepts hashInputVersion as a number", () => {
    const t: Partial<WorkTrace> = { hashInputVersion: 2 };
    expect(t.hashInputVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, expect compile failure**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace.test.ts`
Expected: FAIL with TypeScript errors — `Property 'ingressPath' does not exist on type 'WorkTrace'`.

- [ ] **Step 3: Add the fields to `WorkTrace`** — append below `traceVersion?` in `packages/core/src/platform/work-trace.ts`:

```ts
/**
 * Discriminator: how the row entered persistence.
 * - "platform_ingress": persisted by PlatformIngress.submit() after governance evaluation.
 * - "store_recorded_operator_mutation": persisted by a Store as an operator mutation;
 *   the row did NOT pass through PlatformIngress and matches none of the standard
 *   governance modes. See ConversationStateStore (packages/core/src/platform/
 *   conversation-state-store.ts) for the only current writer of this kind.
 * Defaults to "platform_ingress" on existing rows via the DB column default.
 */
ingressPath: "platform_ingress" | "store_recorded_operator_mutation";
/**
 * Hash-input shape version. v1 = pre-ingressPath (rows persisted before this column
 * existed); v2 = includes ingressPath in canonical hash input. Pre-migration backfill
 * sets 1 so original contentHash values continue to verify; new persists set 2.
 */
hashInputVersion: number;
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/work-trace.ts packages/core/src/platform/__tests__/work-trace.test.ts
git commit -m "feat(core): add ingressPath and hashInputVersion to WorkTrace type"
```

---

## Task 3: Add `"operator_mutation"` to `ExecutionModeName`

**Files:**

- Modify: `packages/core/src/platform/types.ts`

- [ ] **Step 1: Locate exhaustive switches that need updating** — run:

```bash
grep -rn "ExecutionModeName\b\|ModeName\b" packages/core/src packages/db/src --include='*.ts' | grep -v ".test.ts"
```

Expected: a small handful of references. Note any `switch (mode)` blocks that exhaust the union — they will need a new branch.

- [ ] **Step 2: Edit the union**

```ts
// before
export type ExecutionModeName = "skill" | "pipeline" | "cartridge" | "workflow";

// after
export type ExecutionModeName =
  | "skill"
  | "pipeline"
  | "cartridge"
  | "workflow"
  | "operator_mutation";
```

- [ ] **Step 3: Update any exhaustive switches identified in Step 1** — for each, add a `case "operator_mutation":` branch that returns the same neutral path used by the most generic existing branch (or returns early with a `// operator-mutation rows do not participate in this dispatch` comment if the switch is for runtime dispatch). Keep the comment short and concrete.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/types.ts
# plus any files touched in Step 3
git commit -m "feat(core): add operator_mutation to ExecutionModeName"
```

---

## Task 4: Versioned hash input for `WorkTrace`

**Files:**

- Modify: `packages/core/src/platform/work-trace-hash.ts`
- Modify: `packages/core/src/platform/__tests__/work-trace-hash.test.ts` (create if absent)

The contract: pre-existing rows (`hashInputVersion = 1`) hash with the v1 field set (excludes `ingressPath` and `hashInputVersion`). New rows (`hashInputVersion = 2`) hash with v2 (includes `ingressPath`, still excludes `hashInputVersion` to avoid self-referential hashing).

- [ ] **Step 1: Write the failing tests** — replace or extend `__tests__/work-trace-hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../work-trace.js";
import { buildWorkTraceHashInput, computeWorkTraceContentHash } from "../work-trace-hash.js";

const baseTrace: WorkTrace = {
  workUnitId: "wu_test_1",
  traceId: "wu_test_1",
  intent: "test.intent",
  mode: "skill",
  organizationId: "org_1",
  actor: { type: "service", id: "svc_test" },
  trigger: "api",
  parameters: { a: 1 },
  governanceOutcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
  outcome: "completed",
  durationMs: 1,
  modeMetrics: undefined,
  requestedAt: "2026-04-29T00:00:00.000Z",
  governanceCompletedAt: "2026-04-29T00:00:00.001Z",
  ingressPath: "platform_ingress",
  hashInputVersion: 2,
};

describe("buildWorkTraceHashInput — v1 vs v2", () => {
  it("v1 input shape excludes ingressPath and hashInputVersion", () => {
    const input = buildWorkTraceHashInput({ ...baseTrace, hashInputVersion: 1 }, 1);
    expect(input).not.toHaveProperty("ingressPath");
    expect(input).not.toHaveProperty("hashInputVersion");
    expect(input.hashVersion).toBe(1);
  });

  it("v2 input shape includes ingressPath and excludes hashInputVersion", () => {
    const input = buildWorkTraceHashInput({ ...baseTrace, hashInputVersion: 2 }, 1);
    expect(input).toHaveProperty("ingressPath", "platform_ingress");
    expect(input).not.toHaveProperty("hashInputVersion");
    expect(input.hashVersion).toBe(2);
  });

  it("v2 hashes differ when ingressPath differs", () => {
    const a = computeWorkTraceContentHash(
      { ...baseTrace, hashInputVersion: 2, ingressPath: "platform_ingress" },
      1,
    );
    const b = computeWorkTraceContentHash(
      { ...baseTrace, hashInputVersion: 2, ingressPath: "store_recorded_operator_mutation" },
      1,
    );
    expect(a).not.toEqual(b);
  });

  it("v1 hash for a row matches a pinned reference fixture", () => {
    // Pin the v1 hash so future refactors cannot silently change it and break
    // pre-migration locked rows. If this fixture changes, we have invalidated
    // every pre-migration row's contentHash. That is a breaking change that
    // must be explicit, not accidental.
    const v1Trace: WorkTrace = {
      ...baseTrace,
      hashInputVersion: 1,
      ingressPath: "platform_ingress",
    };
    const hash = computeWorkTraceContentHash(v1Trace, 1);
    expect(hash).toMatchInlineSnapshot();
    // ^ first run will populate the inline snapshot; reviewer must inspect.
  });
});
```

- [ ] **Step 2: Run tests, watch them fail**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace-hash.test.ts`
Expected: FAIL — current `buildWorkTraceHashInput` includes all fields, so v1 expectations fail.

- [ ] **Step 3: Update `work-trace-hash.ts`** — replace the body with versioned input:

```ts
import { canonicalizeSync } from "../audit/canonical-json.js";
import { sha256 } from "../audit/canonical-hash.js";
import type { WorkTrace } from "./work-trace.js";

export const WORK_TRACE_HASH_VERSION_V1 = 1;
export const WORK_TRACE_HASH_VERSION_V2 = 2;
export const WORK_TRACE_HASH_VERSION_LATEST = WORK_TRACE_HASH_VERSION_V2;

// Backwards-compatible export for callers that still reference the constant.
// Equals the latest version (operator-mutation rows persist at v2).
export const WORK_TRACE_HASH_VERSION = WORK_TRACE_HASH_VERSION_LATEST;

const EXCLUDED_BASE = ["contentHash", "traceVersion", "lockedAt"] as const;

export const WORK_TRACE_HASH_EXCLUDED_FIELDS_V1 = [
  ...EXCLUDED_BASE,
  // v1 rows pre-date these columns; the column DB defaults backfill them, but
  // they were not present when the original hash was computed.
  "ingressPath",
  "hashInputVersion",
] as const satisfies readonly (keyof WorkTrace)[];

export const WORK_TRACE_HASH_EXCLUDED_FIELDS_V2 = [
  ...EXCLUDED_BASE,
  // hashInputVersion is excluded from the v2 input itself (avoids self-reference);
  // its identity is bound into the hash via the `hashVersion` output field below.
  "hashInputVersion",
] as const satisfies readonly (keyof WorkTrace)[];

function excludedFor(hashInputVersion: number): Set<string> {
  if (hashInputVersion === WORK_TRACE_HASH_VERSION_V1) {
    return new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1);
  }
  if (hashInputVersion === WORK_TRACE_HASH_VERSION_V2) {
    return new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2);
  }
  throw new Error(`Unknown WorkTrace hashInputVersion: ${hashInputVersion}`);
}

export function buildWorkTraceHashInput(
  trace: WorkTrace,
  traceVersion: number,
): Record<string, unknown> {
  const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
  const excluded = excludedFor(hashInputVersion);
  const out: Record<string, unknown> = {
    hashVersion: hashInputVersion,
    traceVersionForHash: traceVersion,
  };
  for (const [key, value] of Object.entries(trace) as Array<[keyof WorkTrace, unknown]>) {
    if (excluded.has(key as string)) continue;
    out[key as string] = value;
  }
  return out;
}

export function computeWorkTraceContentHash(trace: WorkTrace, traceVersion: number): string {
  return sha256(canonicalizeSync(buildWorkTraceHashInput(trace, traceVersion)));
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace-hash.test.ts`
Expected: PASS. The pinned-fixture test will populate its inline snapshot on first run — review the snapshot value before committing; this is the canonical v1 hash that must never change again.

- [ ] **Step 5: Run downstream typecheck**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck`
Expected: PASS. The `WORK_TRACE_HASH_VERSION` re-export keeps any existing callers compiling.

- [ ] **Step 6: Update BOTH audit-ledger snapshots in `PrismaWorkTraceStore`** — `prisma-work-trace-store.ts` has TWO snapshots with `hashVersion: 1`:
  - `persist()` snapshot at line ~118
  - `update()` snapshot at line ~392

  Replace BOTH with `hashVersion: hashInputVersion` (computed locally from the trace; new rows = 2; pre-migration backfilled rows = 1). Use `const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;` near the top of each method, then reference it. This keeps the audit-ledger observability honest about which canonical-input shape was used.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/platform/work-trace-hash.ts packages/core/src/platform/__tests__/work-trace-hash.test.ts packages/db/src/stores/prisma-work-trace-store.ts
git commit -m "feat(core): version WorkTrace hash input (v1 excludes ingressPath, v2 includes)"
```

---

## Task 5: `buildWorkTrace` accepts `ingressPath`

**Files:**

- Modify: `packages/core/src/platform/work-trace-recorder.ts`
- Modify: `packages/core/src/platform/__tests__/work-trace-recorder.test.ts`

- [ ] **Step 1: Write the failing test** — extend the existing `work-trace-recorder.test.ts` (create if absent):

```ts
import { describe, it, expect } from "vitest";
import { buildWorkTrace } from "../work-trace-recorder.js";

const baseInput = {
  workUnit: {
    id: "wu_x",
    traceId: "wu_x",
    intent: "test.intent",
    resolvedMode: "skill" as const,
    organizationId: "org_1",
    actor: { type: "service" as const, id: "svc_1" },
    trigger: "api" as const,
    parameters: {},
    requestedAt: "2026-04-29T00:00:00.000Z",
  },
  governanceDecision: {
    outcome: "execute" as const,
    riskScore: 0,
    matchedPolicies: [],
  },
  governanceCompletedAt: "2026-04-29T00:00:00.001Z",
};

describe("buildWorkTrace ingressPath", () => {
  it("defaults ingressPath to 'platform_ingress'", () => {
    const t = buildWorkTrace(baseInput);
    expect(t.ingressPath).toBe("platform_ingress");
  });

  it("carries an explicit ingressPath through", () => {
    const t = buildWorkTrace({ ...baseInput, ingressPath: "store_recorded_operator_mutation" });
    expect(t.ingressPath).toBe("store_recorded_operator_mutation");
  });

  it("defaults hashInputVersion to the latest version", () => {
    const t = buildWorkTrace(baseInput);
    expect(t.hashInputVersion).toBeGreaterThanOrEqual(2);
  });
});
```

(`baseInput` types may need adjusting to actual `WorkUnit`/`GovernanceDecision` shapes — copy from existing tests in the file if present.)

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace-recorder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `TraceInput` and `buildWorkTrace`**

```ts
import { WORK_TRACE_HASH_VERSION_LATEST } from "./work-trace-hash.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
  ingressPath?: WorkTrace["ingressPath"]; // NEW — defaults to "platform_ingress"
}

export function buildWorkTrace(input: TraceInput): WorkTrace {
  // ... existing body ...
  return {
    // ... existing fields ...
    ingressPath: input.ingressPath ?? "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/work-trace-recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/work-trace-recorder.ts packages/core/src/platform/__tests__/work-trace-recorder.test.ts
git commit -m "feat(core): buildWorkTrace accepts ingressPath (default platform_ingress)"
```

---

## Task 6: `PrismaWorkTraceStore.persist()` writes new columns; deserializer reads them

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`

- [ ] **Step 1: Identify the `persist()` body and any deserializer** — locate the `tx.workTrace.create({ data: { ... } })` call and the row→WorkTrace mapping function (likely `findByWorkUnitId`/`getByWorkUnitId`).

- [ ] **Step 2: Add `ingressPath` and `hashInputVersion` to the `data` block**

```ts
data: {
  // ... existing fields ...
  contentHash,
  traceVersion,
  ingressPath: trace.ingressPath, // explicit; should always be set by buildWorkTrace
  hashInputVersion: trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST,
},
```

- [ ] **Step 3: Update the row→WorkTrace deserializer** — wherever rows are mapped back into the `WorkTrace` shape, include:

```ts
ingressPath: (row.ingressPath ?? "platform_ingress") as WorkTrace["ingressPath"],
hashInputVersion: row.hashInputVersion ?? 1,
```

The `?? 1` fallback handles any edge case where the column is somehow null (it shouldn't be; defaults guarantee it). The `?? "platform_ingress"` mirrors that.

- [ ] **Step 4: Write a unit test** — `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` (extend if exists; create otherwise):

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import type { WorkTrace } from "@switchboard/core/platform";

function buildTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu_p1",
    traceId: "wu_p1",
    intent: "test.intent",
    mode: "skill",
    organizationId: "org_1",
    actor: { type: "service", id: "svc_1" },
    trigger: "api",
    parameters: {},
    governanceOutcome: "execute",
    riskScore: 0,
    matchedPolicies: [],
    outcome: "completed",
    durationMs: 1,
    requestedAt: "2026-04-29T00:00:00.000Z",
    governanceCompletedAt: "2026-04-29T00:00:00.001Z",
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
    ...overrides,
  };
}

describe("PrismaWorkTraceStore.persist — new columns", () => {
  it("writes ingressPath and hashInputVersion to the row", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const tx = { workTrace: { create } };
    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
    });

    await store.persist(buildTrace({ ingressPath: "store_recorded_operator_mutation" }));

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data;
    expect(data.ingressPath).toBe("store_recorded_operator_mutation");
    expect(data.hashInputVersion).toBe(2);
  });
});
```

- [ ] **Step 5: Run test, watch it pass**

Run: `pnpm --filter @switchboard/db exec vitest run packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-work-trace-store.ts packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts
git commit -m "feat(db): PrismaWorkTraceStore writes ingressPath and hashInputVersion"
```

---

## Task 7: Add `recordOperatorMutation(trace, { tx })` to `PrismaWorkTraceStore`

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`

The new method MUST:

- Accept an external `tx` (`Prisma.TransactionClient`) so the insert joins the caller's `$transaction`.
- Compute `contentHash` via `computeWorkTraceContentHash(trace, 1)` (same as `persist()`'s initial `traceVersion = 1`).
- Set `traceVersion = 1` and `hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST`.
- Record the same audit-ledger entry as `persist()` (or invoke the shared helper if there is one), but _outside_ the `tx` only if the existing audit ledger doesn't run inside `tx`. Inspect existing `persist()` to see which side of the transaction the ledger record lives on; mirror it.

- [ ] **Step 1: Write the failing test**

```ts
describe("PrismaWorkTraceStore.recordOperatorMutation", () => {
  it("inserts via the provided tx client (not the outer prisma)", async () => {
    const txCreate = vi.fn().mockResolvedValue(undefined);
    const outerCreate = vi.fn();
    const tx = { workTrace: { create: txCreate } };
    const prisma = {
      $transaction: vi.fn(),
      workTrace: { create: outerCreate },
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
    });

    await store.recordOperatorMutation(
      buildTrace({ ingressPath: "store_recorded_operator_mutation", mode: "operator_mutation" }),
      { tx: tx as never },
    );

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(outerCreate).not.toHaveBeenCalled();
    const data = txCreate.mock.calls[0]![0].data;
    expect(data.ingressPath).toBe("store_recorded_operator_mutation");
    expect(data.hashInputVersion).toBe(2);
    expect(data.traceVersion).toBe(1);
    expect(typeof data.contentHash).toBe("string");
    expect(data.contentHash.length).toBeGreaterThan(0);
  });

  it("rejects an explicitly missing ingressPath", async () => {
    const tx = { workTrace: { create: vi.fn() } };
    const prisma = {} as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn() } as never,
      operatorAlerter: { alert: vi.fn() } as never,
    });
    const trace = buildTrace();
    // @ts-expect-error force-clear to ensure runtime guard catches it
    delete trace.ingressPath;
    await expect(store.recordOperatorMutation(trace, { tx: tx as never })).rejects.toThrow(
      /ingressPath/,
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @switchboard/db exec vitest run packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement** — add to `PrismaWorkTraceStore`:

```ts
async recordOperatorMutation(
  trace: WorkTrace,
  ctx: { tx: Prisma.TransactionClient },
): Promise<void> {
  if (trace.ingressPath !== "store_recorded_operator_mutation") {
    throw new Error(
      `recordOperatorMutation requires ingressPath="store_recorded_operator_mutation"; got "${trace.ingressPath}"`,
    );
  }
  const traceVersion = 1;
  const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
  const contentHash = computeWorkTraceContentHash(trace, traceVersion);

  await ctx.tx.workTrace.create({
    data: {
      // mirror persist() but using ctx.tx instead of $transaction
      workUnitId: trace.workUnitId,
      traceId: trace.traceId,
      parentWorkUnitId: trace.parentWorkUnitId ?? null,
      intent: trace.intent,
      mode: trace.mode,
      organizationId: trace.organizationId,
      actorId: trace.actor.id,
      actorType: trace.actor.type,
      trigger: trace.trigger,
      parameters: trace.parameters ? JSON.stringify(trace.parameters) : null,
      deploymentContext: trace.deploymentContext ? JSON.stringify(trace.deploymentContext) : null,
      governanceOutcome: trace.governanceOutcome,
      riskScore: trace.riskScore,
      matchedPolicies: JSON.stringify(trace.matchedPolicies),
      governanceConstraints: trace.governanceConstraints
        ? JSON.stringify(trace.governanceConstraints)
        : null,
      approvalId: trace.approvalId ?? null,
      approvalOutcome: trace.approvalOutcome ?? null,
      approvalRespondedBy: trace.approvalRespondedBy ?? null,
      approvalRespondedAt: trace.approvalRespondedAt ? new Date(trace.approvalRespondedAt) : null,
      outcome: trace.outcome,
      durationMs: trace.durationMs,
      errorCode: trace.error?.code ?? null,
      errorMessage: trace.error?.message ?? null,
      executionSummary: trace.executionSummary ?? null,
      executionOutputs: trace.executionOutputs ? JSON.stringify(trace.executionOutputs) : null,
      modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
      requestedAt: new Date(trace.requestedAt),
      governanceCompletedAt: new Date(trace.governanceCompletedAt),
      executionStartedAt: trace.executionStartedAt ? new Date(trace.executionStartedAt) : null,
      idempotencyKey: trace.idempotencyKey ?? null,
      completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
      contentHash,
      traceVersion,
      ingressPath: trace.ingressPath,
      hashInputVersion,
    },
  });

  // Audit-ledger record — best-effort, mirrors persist() shape but is OUTSIDE the
  // caller's transaction. The state mutation + WorkTrace insert atomicity is what
  // matters; the audit-ledger insert is observability and must not block the tx.
  await this.auditLedger.record(
    {
      eventType: "work_trace.persisted",
      actorType: trace.actor.type === "service" ? "service_account" : trace.actor.type,
      actorId: trace.actor.id,
      entityType: "work_trace",
      entityId: trace.workUnitId,
      riskCategory: "low",
      visibilityLevel: "system",
      summary: `WorkTrace ${trace.workUnitId} persisted at v${traceVersion} (operator mutation)`,
      organizationId: trace.organizationId,
      traceId: trace.traceId,
      snapshot: {
        workUnitId: trace.workUnitId,
        traceId: trace.traceId,
        contentHash,
        traceVersion,
        hashAlgorithm: "sha256",
        hashVersion: hashInputVersion,
        ingressPath: trace.ingressPath,
      },
    },
    {} as never,
  );
}
```

If the existing `persist()` factors the `data` payload into a helper, refactor that helper into a shared `buildWorkTraceCreateData(trace, { traceVersion, contentHash, hashInputVersion })` and call it from both. DRY beats duplication, but only if the diff stays small and contained to this file.

If `Prisma.TransactionClient` isn't imported, add `import type { Prisma } from "@prisma/client";` at the top.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @switchboard/db exec vitest run packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-work-trace-store.ts packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts
git commit -m "feat(db): add tx-aware PrismaWorkTraceStore.recordOperatorMutation"
```

---

## Task 8: `ConversationStateStore` interface in core platform

**Files:**

- Create: `packages/core/src/platform/conversation-state-store.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/src/platform/__tests__/conversation-state-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  ConversationStateStore,
  ConversationOperatorActionKind,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
} from "../conversation-state-store.js";

describe("ConversationStateStore type surface", () => {
  it("exports the three action kinds", () => {
    const kinds: ConversationOperatorActionKind[] = [
      "conversation.override.set",
      "conversation.message.send",
      "escalation.reply.release_to_ai",
    ];
    expect(kinds).toHaveLength(3);
  });

  it("has the three method signatures", () => {
    const stub: ConversationStateStore = {
      setOverride: async (_i: SetOverrideInput): Promise<SetOverrideResult> => ({
        conversationId: "c",
        threadId: "t",
        status: "active",
        workTraceId: "w",
      }),
      sendOperatorMessage: async (
        _i: SendOperatorMessageInput,
      ): Promise<SendOperatorMessageResult> => ({
        conversationId: "c",
        threadId: "t",
        channel: "telegram",
        destinationPrincipalId: "p",
        workTraceId: "w",
        appendedMessage: { role: "owner", text: "hi", timestamp: "2026-04-29T00:00:00.000Z" },
      }),
      releaseEscalationToAi: async (
        _i: ReleaseEscalationInput,
      ): Promise<ReleaseEscalationResult> => ({
        conversationId: "c",
        threadId: "t",
        channel: "telegram",
        destinationPrincipalId: "p",
        workTraceId: "w",
        appendedReply: { role: "owner", text: "hi", timestamp: "2026-04-29T00:00:00.000Z" },
      }),
    };
    expect(typeof stub.setOverride).toBe("function");
    expect(typeof stub.sendOperatorMessage).toBe("function");
    expect(typeof stub.releaseEscalationToAi).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (compile errors — module missing).

- [ ] **Step 3: Create the interface file**

```ts
// packages/core/src/platform/conversation-state-store.ts
import type { Actor } from "./types.js";

export type ConversationOperatorActionKind =
  | "conversation.override.set"
  | "conversation.message.send"
  | "escalation.reply.release_to_ai";

export interface SetOverrideInput {
  organizationId: string;
  threadId: string;
  override: boolean;
  operator: Actor;
}

export interface SetOverrideResult {
  conversationId: string;
  threadId: string;
  status: string;
  workTraceId: string;
}

export interface SendOperatorMessageInput {
  organizationId: string;
  threadId: string;
  operator: Actor;
  message: { text: string };
}

export interface SendOperatorMessageResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedMessage: { role: "owner"; text: string; timestamp: string };
}

export interface ReleaseEscalationInput {
  organizationId: string;
  handoffId: string;
  threadId: string;
  operator: Actor;
  reply: { text: string };
}

export interface ReleaseEscalationResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedReply: { role: "owner"; text: string; timestamp: string };
}

export interface ConversationStateStore {
  setOverride(input: SetOverrideInput): Promise<SetOverrideResult>;
  sendOperatorMessage(input: SendOperatorMessageInput): Promise<SendOperatorMessageResult>;
  releaseEscalationToAi(input: ReleaseEscalationInput): Promise<ReleaseEscalationResult>;
}

export class ConversationStateNotFoundError extends Error {
  readonly kind = "conversation_state_not_found" as const;
  constructor(public readonly threadId: string) {
    super(`ConversationState not found for threadId="${threadId}"`);
    this.name = "ConversationStateNotFoundError";
  }
}

export class ConversationStateInvalidTransitionError extends Error {
  readonly kind = "conversation_state_invalid_transition" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConversationStateInvalidTransitionError";
  }
}
```

- [ ] **Step 4: Re-export from `packages/core/src/platform/index.ts`** — add:

```ts
export type {
  ConversationStateStore,
  ConversationOperatorActionKind,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
} from "./conversation-state-store.js";
export {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
} from "./conversation-state-store.js";
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm --filter @switchboard/core exec vitest run packages/core/src/platform/__tests__/conversation-state-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/platform/conversation-state-store.ts packages/core/src/platform/index.ts packages/core/src/platform/__tests__/conversation-state-store.test.ts
git commit -m "feat(core): add ConversationStateStore interface and error types"
```

---

## Task 9: `PrismaConversationStateStore.setOverride`

**Files:**

- Create: `packages/db/src/stores/prisma-conversation-state-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`

The store opens its own `$transaction`. Inside the tx callback it reads, validates, mutates, and writes the operator-mutation `WorkTrace` row via `recordOperatorMutation(trace, { tx })`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationStateStore } from "../prisma-conversation-state-store.js";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";

// Note: ActorType is "user" | "agent" | "system" | "service". We use "user"
// for operator-driven mutations (operators are humans). The id is whatever the
// API request can attribute — see Task 13 for resolveOperatorActor.
const operator = { type: "user" as const, id: "user_op_1" };

function makeStore() {
  const txConvUpdate = vi.fn();
  const txConvFindFirst = vi.fn();
  const txTraceCreate = vi.fn().mockResolvedValue(undefined);
  const tx = {
    conversationState: { findFirst: txConvFindFirst, update: txConvUpdate },
    workTrace: { create: txTraceCreate },
  };
  const prisma = {
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as never;
  const recordOperatorMutation = vi.fn(async (_trace: unknown, ctx: { tx: typeof tx }) => {
    await ctx.tx.workTrace.create({ data: {} });
  });
  // Mocks WorkTraceStore.update used for the post-tx finalize step (spec §4.7.1).
  const workTraceStoreUpdate = vi.fn(async (_workUnitId: string, _patch: unknown) => ({
    ok: true as const,
    trace: {} as never,
  }));
  const workTraceStore = { recordOperatorMutation, update: workTraceStoreUpdate } as never;
  const store = new PrismaConversationStateStore(prisma, workTraceStore);
  return {
    store,
    tx,
    txConvFindFirst,
    txConvUpdate,
    recordOperatorMutation,
    workTraceStoreUpdate,
  };
}

describe("PrismaConversationStateStore.setOverride", () => {
  it("flips status to human_override and records an operator-mutation trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      status: "active",
      threadId: "t1",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      status: "human_override",
      threadId: "t1",
    });

    const result = await harness.store.setOverride({
      organizationId: "org_1",
      threadId: "t1",
      override: true,
      operator,
    });

    expect(harness.txConvUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: expect.objectContaining({ status: "human_override" }),
    });
    expect(harness.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const [trace] = harness.recordOperatorMutation.mock.calls[0]!;
    // Initial trace persists as non-terminal "running" (see spec §4.7.1).
    // Finalize to "completed" happens via workTraceStore.update after tx commits.
    expect(trace).toMatchObject({
      intent: "conversation.override.set",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
      hashInputVersion: 2,
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      actor: { type: "user", id: "user_op_1" },
      trigger: "api",
      outcome: "running",
      durationMs: 0,
      modeMetrics: expect.objectContaining({ governanceMode: "operator_auto_allow" }),
    });
    expect(trace.executionStartedAt).toBeUndefined();
    expect(trace.completedAt).toBeUndefined();
    expect(trace.parameters).toMatchObject({
      actionKind: "conversation.override.set",
      orgId: "org_1",
      conversationId: "conv_1",
      before: { status: "active" },
      after: { status: "human_override" },
    });
    // Finalize update is called AFTER the outer tx commits, with terminal fields.
    expect(harness.workTraceStoreUpdate).toHaveBeenCalledTimes(1);
    const [finalizeWorkUnitId, finalizePatch] = harness.workTraceStoreUpdate.mock.calls[0]!;
    expect(finalizeWorkUnitId).toBe(trace.workUnitId);
    expect(finalizePatch).toMatchObject({
      outcome: "completed",
      executionStartedAt: expect.any(String),
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
    });
    expect(result.status).toBe("human_override");
    expect(result.workTraceId).toBe(trace.workUnitId);
  });

  it("flips status to active when override=false", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      status: "human_override",
      threadId: "t1",
    });
    harness.txConvUpdate.mockResolvedValueOnce({ id: "conv_1", status: "active", threadId: "t1" });
    const result = await harness.store.setOverride({
      organizationId: "org_1",
      threadId: "t1",
      override: false,
      operator,
    });
    expect(result.status).toBe("active");
  });

  it("throws ConversationStateNotFoundError when no row matches", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.setOverride({
        organizationId: "org_1",
        threadId: "missing",
        override: true,
        operator,
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
    expect(harness.txConvUpdate).not.toHaveBeenCalled();
    expect(harness.recordOperatorMutation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Create `prisma-conversation-state-store.ts`** with `setOverride` only (other methods become no-op stubs that throw `Error("not implemented")` for this task — they get filled in Tasks 10 + 11):

```ts
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  ConversationStateStore,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
} from "@switchboard/core/platform";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import type { WorkTrace } from "@switchboard/core/platform";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

export class PrismaConversationStateStore implements ConversationStateStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}

  async setOverride(input: SetOverrideInput): Promise<SetOverrideResult> {
    // Per spec §4.7.1: persist initial trace as outcome="running" inside the
    // outer tx (atomic with the conversation mutation), then finalize via
    // workTraceStore.update AFTER the tx commits. The finalize update is what
    // stamps lockedAt and seals the row.
    const requestedAt = new Date();
    const executionStartedAt = new Date();
    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversationState.findFirst({
        where: { threadId: input.threadId, organizationId: input.organizationId },
      });
      if (!existing) throw new ConversationStateNotFoundError(input.threadId);

      const before = { status: existing.status };
      const nextStatus = input.override ? "human_override" : "active";
      const after = { status: nextStatus };

      const updated = await tx.conversationState.update({
        where: { id: existing.id },
        data: { status: nextStatus, lastActivityAt: requestedAt },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "conversation.override.set",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "conversation.override.set",
          orgId: input.organizationId,
          conversationId: existing.id,
          before,
          after,
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running", // non-terminal at persist; finalized below
        durationMs: 0, // finalized below
        executionSummary: `operator ${input.operator.id} set override=${input.override} on conversation ${existing.id}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
        // executionStartedAt + completedAt left undefined; set on finalize
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, updated };
    });

    // Finalize: separate transaction. If this fails, the trace row exists as
    // "running" permanently (the conversation mutation already happened, which
    // is the audit-critical invariant). See spec §4.7.1 and §10.2.
    const completedAt = new Date();
    const finalizeResult = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "ConversationStateStore.setOverride" },
    );
    if (!finalizeResult.ok) {
      console.warn(
        `[conversation-state-store] setOverride finalize rejected for ${txResult.workUnitId}: ${finalizeResult.reason}`,
      );
    }

    return {
      conversationId: txResult.updated.id,
      threadId: txResult.updated.threadId,
      status: txResult.updated.status,
      workTraceId: txResult.workUnitId,
    };
  }

  sendOperatorMessage(_input: SendOperatorMessageInput): Promise<SendOperatorMessageResult> {
    throw new Error("not implemented (Task 10)");
  }

  releaseEscalationToAi(_input: ReleaseEscalationInput): Promise<ReleaseEscalationResult> {
    throw new Error("not implemented (Task 11)");
  }
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @switchboard/db exec vitest run packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`
Expected: PASS for the three `setOverride` tests; the other methods are not exercised here.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversation-state-store.ts packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts
git commit -m "feat(db): PrismaConversationStateStore.setOverride with operator-mutation trace"
```

---

## Task 10: `PrismaConversationStateStore.sendOperatorMessage`

**Files:**

- Modify: `packages/db/src/stores/prisma-conversation-state-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`

The store appends an `{ role: "owner", text, timestamp }` message to `messages` JSON, bumps `lastActivityAt`, and writes the operator-mutation trace. Internally derives `bodyHash` (sha256 of UTF-8 text) and `redactedPreview` (first 80 chars with control chars stripped). Validates that `status === "human_override"` before mutating.

- [ ] **Step 1: Write the failing tests**

```ts
import { ConversationStateInvalidTransitionError } from "@switchboard/core/platform";

describe("PrismaConversationStateStore.sendOperatorMessage", () => {
  it("appends owner message and records send trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      messages: [{ role: "agent", text: "earlier", timestamp: "2026-04-28T00:00:00.000Z" }],
      channel: "telegram",
      principalId: "p_customer",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      channel: "telegram",
      principalId: "p_customer",
    });

    const result = await harness.store.sendOperatorMessage({
      organizationId: "org_1",
      threadId: "t1",
      operator,
      message: { text: "Hello there, how can I help?" },
    });

    const [trace] = harness.recordOperatorMutation.mock.calls[0]!;
    expect(trace).toMatchObject({
      intent: "conversation.message.send",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
    });
    expect(trace.parameters).toMatchObject({
      actionKind: "conversation.message.send",
      message: expect.objectContaining({
        channel: "telegram",
        destination: "p_customer",
        deliveryAttempted: false,
      }),
    });
    expect(typeof (trace.parameters as { message: { bodyHash: string } }).message.bodyHash).toBe(
      "string",
    );
    expect(
      (trace.parameters as { message: { bodyHash: string } }).message.bodyHash.length,
    ).toBeGreaterThan(0);
    expect(
      (trace.parameters as { message: { redactedPreview: string } }).message.redactedPreview,
    ).toBe("Hello there, how can I help?");
    expect(result.appendedMessage.role).toBe("owner");
    expect(result.appendedMessage.text).toBe("Hello there, how can I help?");
    expect(result.channel).toBe("telegram");
    expect(result.destinationPrincipalId).toBe("p_customer");
  });

  it("rejects when conversation is not in human_override", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "c",
      status: "active",
      threadId: "t",
      messages: [],
    });
    await expect(
      harness.store.sendOperatorMessage({
        organizationId: "org_1",
        threadId: "t",
        operator,
        message: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateInvalidTransitionError);
    expect(harness.txConvUpdate).not.toHaveBeenCalled();
  });

  it("404s when conversation is missing", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.sendOperatorMessage({
        organizationId: "org_1",
        threadId: "missing",
        operator,
        message: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — replace the `sendOperatorMessage` stub:

```ts
import { createHash } from "node:crypto";
import { ConversationStateInvalidTransitionError } from "@switchboard/core/platform";

// helper, file-local
function bodyHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function redactedPreview(text: string, max = 80): string {
  // Strip ASCII control chars; the persisted message text in messages JSON is
  // unaltered — only the trace preview is sanitized.
  // CONTROL_CHARS strips ASCII control codes (0x00-0x1F and 0x7F DEL).
  // Built via RegExp(string, "g") so the source file stays plain ASCII
  // and tooling (file(1), prettier, grep) treats it as text. Note: the
  // direct regex literal /[\u0000-\u001F\u007F]/g works too, but is
  // typed in some editors as literal control bytes.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F]", "g");
  const stripped = text.replace(CONTROL_CHARS, "");
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}
function safeMessages(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// inside class:
async sendOperatorMessage(input: SendOperatorMessageInput): Promise<SendOperatorMessageResult> {
  return this.prisma.$transaction(async (tx) => {
    const existing = await tx.conversationState.findFirst({
      where: { threadId: input.threadId, organizationId: input.organizationId },
    });
    if (!existing) throw new ConversationStateNotFoundError(input.threadId);
    if (existing.status !== "human_override") {
      throw new ConversationStateInvalidTransitionError(
        `Conversation ${existing.id} must be in human_override to send operator messages (current: ${existing.status})`,
      );
    }

    const requestedAt = new Date();
    const ownerMessage = {
      role: "owner" as const,
      text: input.message.text,
      timestamp: requestedAt.toISOString(),
    };
    const nextMessages = [...safeMessages(existing.messages), ownerMessage];

    await tx.conversationState.update({
      where: { id: existing.id },
      data: { messages: nextMessages, lastActivityAt: requestedAt },
    });

    const workUnitId = randomUUID();
    const trace: WorkTrace = {
      workUnitId,
      traceId: workUnitId,
      intent: "conversation.message.send",
      mode: "operator_mutation",
      organizationId: input.organizationId,
      actor: input.operator,
      trigger: "api",
      parameters: {
        actionKind: "conversation.message.send",
        orgId: input.organizationId,
        conversationId: existing.id,
        before: { status: existing.status },
        after: { status: existing.status }, // status unchanged on send
        message: {
          channel: existing.channel,
          destination: existing.principalId,
          redactedPreview: redactedPreview(input.message.text),
          bodyHash: bodyHash(input.message.text),
          deliveryAttempted: false,
        },
      },
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      outcome: "running", // non-terminal at persist; finalized via WorkTraceStore.update from route
      durationMs: 0,
      executionSummary: `operator ${input.operator.id} sent message on conversation ${existing.id}`,
      modeMetrics: { governanceMode: "operator_auto_allow" },
      ingressPath: "store_recorded_operator_mutation",
      hashInputVersion: 2,
      requestedAt: requestedAt.toISOString(),
      governanceCompletedAt: requestedAt.toISOString(),
      // executionStartedAt + completedAt left undefined; route sets them on finalize
    };

    await this.workTraceStore.recordOperatorMutation(trace, { tx: tx as Prisma.TransactionClient });

    return {
      conversationId: existing.id,
      threadId: existing.threadId,
      channel: existing.channel,
      destinationPrincipalId: existing.principalId,
      workTraceId: workUnitId,
      // executionStartedAt is the route-side stamp. The store records requestedAt;
      // the route stamps executionStartedAt at the moment it's about to do delivery.
      appendedMessage: ownerMessage,
    };
  });
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversation-state-store.ts packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts
git commit -m "feat(db): PrismaConversationStateStore.sendOperatorMessage with redacted preview + bodyHash"
```

---

## Task 11: `PrismaConversationStateStore.releaseEscalationToAi`

**Files:**

- Modify: `packages/db/src/stores/prisma-conversation-state-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`

Resolves the `threadId` provided by the route, sets `status: "active"` on the conversation, appends owner reply, and records the trace. The route is responsible for the `handoff.update` and channel delivery; this method only owns `ConversationState` mutation.

- [ ] **Step 1: Write the failing test**

```ts
describe("PrismaConversationStateStore.releaseEscalationToAi", () => {
  it("flips conversation to active, appends owner reply, records escalation.reply.release_to_ai trace", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
      messages: [],
      channel: "whatsapp",
      principalId: "p_customer",
    });
    harness.txConvUpdate.mockResolvedValueOnce({
      id: "conv_1",
      threadId: "t1",
      status: "active",
      channel: "whatsapp",
      principalId: "p_customer",
    });

    const result = await harness.store.releaseEscalationToAi({
      organizationId: "org_1",
      handoffId: "h_1",
      threadId: "t1",
      operator,
      reply: { text: "Thanks, taking it from here." },
    });

    expect(harness.txConvUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: expect.objectContaining({ status: "active" }),
    });
    const [trace] = harness.recordOperatorMutation.mock.calls[0]!;
    expect(trace).toMatchObject({
      intent: "escalation.reply.release_to_ai",
      mode: "operator_mutation",
      ingressPath: "store_recorded_operator_mutation",
    });
    expect(trace.parameters).toMatchObject({
      actionKind: "escalation.reply.release_to_ai",
      escalationId: "h_1",
      before: { status: "human_override" },
      after: { status: "active" },
    });
    expect(result.channel).toBe("whatsapp");
    expect(result.destinationPrincipalId).toBe("p_customer");
    expect(result.appendedReply.role).toBe("owner");
  });

  it("404s when conversation is missing for the threadId", async () => {
    const harness = makeStore();
    harness.txConvFindFirst.mockResolvedValueOnce(null);
    await expect(
      harness.store.releaseEscalationToAi({
        organizationId: "org_1",
        handoffId: "h_1",
        threadId: "t_missing",
        operator,
        reply: { text: "x" },
      }),
    ).rejects.toBeInstanceOf(ConversationStateNotFoundError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — replace the `releaseEscalationToAi` stub:

```ts
async releaseEscalationToAi(input: ReleaseEscalationInput): Promise<ReleaseEscalationResult> {
  return this.prisma.$transaction(async (tx) => {
    const existing = await tx.conversationState.findFirst({
      where: { threadId: input.threadId, organizationId: input.organizationId },
    });
    if (!existing) throw new ConversationStateNotFoundError(input.threadId);

    const requestedAt = new Date();
    const ownerReply = {
      role: "owner" as const,
      text: input.reply.text,
      timestamp: requestedAt.toISOString(),
    };
    const before = { status: existing.status };
    const after = { status: "active" };
    const nextMessages = [...safeMessages(existing.messages), ownerReply];

    await tx.conversationState.update({
      where: { id: existing.id },
      data: { status: "active", messages: nextMessages, lastActivityAt: requestedAt },
    });

    const workUnitId = randomUUID();
    const trace: WorkTrace = {
      workUnitId,
      traceId: workUnitId,
      intent: "escalation.reply.release_to_ai",
      mode: "operator_mutation",
      organizationId: input.organizationId,
      actor: input.operator,
      trigger: "api",
      parameters: {
        actionKind: "escalation.reply.release_to_ai",
        orgId: input.organizationId,
        conversationId: existing.id,
        escalationId: input.handoffId,
        before,
        after,
        message: {
          channel: existing.channel,
          destination: existing.principalId,
          redactedPreview: redactedPreview(input.reply.text),
          bodyHash: bodyHash(input.reply.text),
          deliveryAttempted: false,
        },
      },
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      outcome: "running", // non-terminal at persist; finalized via WorkTraceStore.update from route
      durationMs: 0,
      executionSummary: `operator ${input.operator.id} released escalation ${input.handoffId} on conversation ${existing.id}`,
      modeMetrics: { governanceMode: "operator_auto_allow" },
      ingressPath: "store_recorded_operator_mutation",
      hashInputVersion: 2,
      requestedAt: requestedAt.toISOString(),
      governanceCompletedAt: requestedAt.toISOString(),
      // executionStartedAt + completedAt left undefined; route sets them on finalize
    };

    await this.workTraceStore.recordOperatorMutation(trace, { tx: tx as Prisma.TransactionClient });

    return {
      conversationId: existing.id,
      threadId: existing.threadId,
      channel: existing.channel,
      destinationPrincipalId: existing.principalId,
      workTraceId: workUnitId,
      appendedReply: ownerReply,
    };
  });
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversation-state-store.ts packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts
git commit -m "feat(db): PrismaConversationStateStore.releaseEscalationToAi"
```

---

## Task 12: Wire `app.conversationStateStore` in `apps/api/src/app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Locate the existing `app.workTraceStore` decoration block** (around line 416–424). The new store goes immediately after.

- [ ] **Step 2: Add the import**

```ts
import { PrismaConversationStateStore } from "@switchboard/db";
// only if PrismaConversationStateStore is exported from @switchboard/db's index;
// otherwise import from the specific store path used by other Prisma stores in this file.
```

(Verify `packages/db/src/index.ts` re-exports `PrismaConversationStateStore`; if not, add the re-export in this same task — one-line change to `packages/db/src/index.ts`.)

- [ ] **Step 3: Decorate `app.conversationStateStore`**

```ts
let conversationStateStore: ConversationStateStore | undefined;
if (prismaClient && workTraceStore instanceof PrismaWorkTraceStore) {
  conversationStateStore = new PrismaConversationStateStore(prismaClient, workTraceStore);
}
app.decorate("conversationStateStore", conversationStateStore ?? null);
```

- [ ] **Step 4: Add the Fastify type augmentation** — extend the `declare module "fastify"` block (or wherever the decorator types live in this file):

```ts
import type { ConversationStateStore } from "@switchboard/core/platform";

declare module "fastify" {
  interface FastifyInstance {
    // ... existing decorators ...
    conversationStateStore: ConversationStateStore | null;
  }
}
```

- [ ] **Step 5: Update test-server bootstrap** — `apps/api/src/__tests__/test-server.ts` decorates the same store with an in-memory or stub implementation. Add:

```ts
const conversationStateStore: ConversationStateStore = {
  setOverride: vi.fn(async () => ({
    conversationId: "stub",
    threadId: "stub",
    status: "active",
    workTraceId: "stub",
  })),
  sendOperatorMessage: vi.fn(async () => ({
    conversationId: "stub",
    threadId: "stub",
    channel: "telegram",
    destinationPrincipalId: "stub",
    workTraceId: "stub",
    appendedMessage: { role: "owner", text: "stub", timestamp: new Date().toISOString() },
  })),
  releaseEscalationToAi: vi.fn(async () => ({
    conversationId: "stub",
    threadId: "stub",
    channel: "telegram",
    destinationPrincipalId: "stub",
    workTraceId: "stub",
    appendedReply: { role: "owner", text: "stub", timestamp: new Date().toISOString() },
  })),
};
app.decorate("conversationStateStore", conversationStateStore);
```

(Adjust to match the existing test-server pattern — if the file already builds stubs via a helper, add a `buildStubConversationStateStore()` and call it.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/__tests__/test-server.ts packages/db/src/index.ts
git commit -m "feat(api): decorate app.conversationStateStore"
```

---

## Task 13: Refactor `conversations.ts` PATCH override route

**Files:**

- Modify: `apps/api/src/routes/conversations.ts`
- Modify: `apps/api/src/routes/__tests__/conversations-send.test.ts` (existing tests for override flow live alongside send tests in this file or a sibling — locate first)

- [ ] **Step 1: Find the existing override-route test** — run:

```bash
grep -rn "override" apps/api/src/routes/__tests__ | head -10
```

If no override-specific test exists, write one in `apps/api/src/routes/__tests__/conversations-override.test.ts` before refactoring. The test must mock `app.conversationStateStore.setOverride` and assert the route calls it with the right inputs and maps the result to a 200 response, plus the 404 path on `ConversationStateNotFoundError`.

- [ ] **Step 2: Write/update the failing route test**

```ts
import { describe, it, expect, vi } from "vitest";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import { buildTestApp } from "./helpers.js"; // or the equivalent helper in this codebase

describe("PATCH /api/conversations/:threadId/override", () => {
  it("delegates to conversationStateStore.setOverride and returns 200 with the new status", async () => {
    const setOverride = vi.fn().mockResolvedValue({
      conversationId: "conv_1",
      threadId: "t1",
      status: "human_override",
      workTraceId: "wt_1",
    });
    const app = await buildTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: true },
      headers: {
        /* auth header that yields organizationIdFromAuth = "org_1" */
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      id: "conv_1",
      threadId: "t1",
      status: "human_override",
    });
    expect(setOverride).toHaveBeenCalledWith({
      organizationId: "org_1",
      threadId: "t1",
      override: true,
      operator: expect.objectContaining({ type: "user" }),
    });
  });

  it("returns 404 when the store throws ConversationStateNotFoundError", async () => {
    const setOverride = vi.fn().mockRejectedValue(new ConversationStateNotFoundError("missing"));
    const app = await buildTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/missing/override",
      payload: { override: true },
      headers: {
        /* auth */
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

(Adapt to the actual test-helper API in `apps/api/src/__tests__/test-server.ts`.)

- [ ] **Step 3: Run, expect FAIL** (route still calls Prisma directly).

- [ ] **Step 4: Refactor the route handler** — replace the body of the `PATCH /:threadId/override` handler in `conversations.ts`:

```ts
app.patch(
  "/:threadId/override",
  { schema: { description: "Toggle human override for a conversation.", tags: ["Conversations"] } },
  async (request, reply) => {
    if (!app.conversationStateStore) {
      return reply.code(503).send({ error: "Conversation store unavailable", statusCode: 503 });
    }
    const { threadId } = request.params as { threadId: string };
    const body = request.body as { override?: boolean };
    const orgId = request.organizationIdFromAuth;
    if (!orgId)
      return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });

    try {
      const result = await app.conversationStateStore.setOverride({
        organizationId: orgId,
        threadId,
        override: body.override !== false,
        operator: resolveOperatorActor(request),
      });
      return reply.send({
        id: result.conversationId,
        threadId: result.threadId,
        status: result.status,
      });
    } catch (err) {
      if (err instanceof ConversationStateNotFoundError) {
        return reply.code(404).send({ error: "Conversation not found", statusCode: 404 });
      }
      throw err;
    }
  },
);
```

`resolveOperatorActor(request)` is a small file-local helper:

```ts
function resolveOperatorActor(request: FastifyRequest): { type: "user"; id: string } {
  // Per spec §4.4 + §10.1: the API uses API-key auth with no per-user
  // identifier today. We record the API key's principal id as the actor and
  // accept the documented limitation that this attributes to the org-scoped
  // dashboard service account, not to the specific human who clicked. A
  // follow-up Risk (see spec §10.1) will introduce per-user attribution via
  // either per-user API keys or a dashboard-signed user-id header.
  const id = request.principalIdFromAuth ?? "operator";
  return { type: "user", id };
}
```

Add it once in `apps/api/src/routes/conversations.ts` (or a small `apps/api/src/routes/operator-actor.ts` shared file if both `conversations.ts` and `escalations.ts` need it). The plan picks the shared file approach since both routes need it (Tasks 13–15).

Add the imports: `import { ConversationStateNotFoundError } from "@switchboard/core/platform";` and `import type { FastifyRequest } from "fastify";` (if not already imported).

- [ ] **Step 5: Run, expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/conversations.ts apps/api/src/routes/__tests__/conversations-override.test.ts
git commit -m "refactor(api): conversations override route uses conversationStateStore"
```

---

## Task 14: Refactor `conversations.ts` POST send route + post-delivery `WorkTraceStore.update`

**Files:**

- Modify: `apps/api/src/routes/conversations.ts`
- Modify: `apps/api/src/routes/__tests__/conversations-send.test.ts`

- [ ] **Step 1: Update the existing route test** to mock the store (not `mockPrisma.conversationState`) and assert the post-delivery `app.workTraceStore.update` call.

```ts
describe("POST /api/conversations/:threadId/send", () => {
  it("delegates to store, then enriches the WorkTrace with delivery outcome", async () => {
    const sendOperatorMessage = vi.fn().mockResolvedValue({
      conversationId: "conv_1",
      threadId: "t1",
      channel: "telegram",
      destinationPrincipalId: "p1",
      workTraceId: "wt_1",
      appendedMessage: { role: "owner", text: "hi", timestamp: "2026-04-29T00:00:00.000Z" },
    });
    const update = vi.fn().mockResolvedValue({
      ok: true,
      trace: {
        /* unused */
      },
    });
    const sendProactive = vi.fn().mockResolvedValue(undefined);
    const app = await buildTestApp({
      conversationStateStore: {
        sendOperatorMessage,
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: {
        update,
        persist: vi.fn(),
        getByWorkUnitId: vi.fn(),
        getByIdempotencyKey: vi.fn(),
      },
      agentNotifier: { sendProactive },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
      headers: {
        /* auth */
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sendOperatorMessage).toHaveBeenCalledTimes(1);
    expect(sendProactive).toHaveBeenCalledWith("p1", "telegram", "hi");
    // The finalize call atomically enriches parameters AND transitions the
    // trace to terminal "completed" (which stamps lockedAt automatically).
    expect(update).toHaveBeenCalledWith(
      "wt_1",
      expect.objectContaining({
        parameters: expect.objectContaining({
          message: expect.objectContaining({
            deliveryAttempted: true,
            deliveryResult: expect.any(String),
          }),
        }),
        outcome: "completed",
        executionStartedAt: expect.any(String),
        completedAt: expect.any(String),
        durationMs: expect.any(Number),
      }),
      expect.any(Object),
    );
  });

  it("returns 502 and still records deliveryAttempted=true with deliveryResult='failed' when channel send throws", async () => {
    // … same wiring; sendProactive.mockRejectedValueOnce(new Error("boom")); …
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Refactor the route handler**

```ts
app.post(
  "/:threadId/send",
  {
    /* schema unchanged */
  },
  async (request, reply) => {
    if (!app.conversationStateStore || !app.workTraceStore) {
      return reply.code(503).send({ error: "Conversation store unavailable", statusCode: 503 });
    }
    const { threadId } = request.params as { threadId: string };
    const { message } = request.body as { message: string };
    const orgId = request.organizationIdFromAuth;
    if (!orgId)
      return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });

    let storeResult;
    try {
      storeResult = await app.conversationStateStore.sendOperatorMessage({
        organizationId: orgId,
        threadId,
        operator: resolveOperatorActor(request),
        message: { text: message },
      });
    } catch (err) {
      if (err instanceof ConversationStateNotFoundError) {
        return reply.code(404).send({ error: "Conversation not found", statusCode: 404 });
      }
      if (err instanceof ConversationStateInvalidTransitionError) {
        return reply.code(409).send({
          error: "Conversation must be in human_override status to send operator messages",
          statusCode: 409,
        });
      }
      throw err;
    }

    const executionStartedAt = new Date(); // route-side stamp, set just before delivery
    if (!app.agentNotifier) {
      await finalizeOperatorTrace(app.workTraceStore, storeResult.workTraceId, {
        deliveryAttempted: false,
        deliveryResult: "no_notifier",
        executionStartedAt,
        completedAt: new Date(),
        caller: "conversations.send",
      });
      return reply.code(502).send({
        error: "Channel delivery not configured (agentNotifier is null)",
        statusCode: 502,
      });
    }

    let deliveryResult: string;
    let httpResult: { code: number; body: Record<string, unknown> };
    try {
      await app.agentNotifier.sendProactive(
        storeResult.destinationPrincipalId,
        storeResult.channel,
        message,
      );
      deliveryResult = "delivered";
      httpResult = { code: 200, body: { sent: true, threadId } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conversations] Channel delivery failed for ${threadId}: ${msg}`);
      deliveryResult = `failed: ${msg}`;
      httpResult = {
        code: 502,
        body: { error: "Message saved but channel delivery failed", statusCode: 502 },
      };
    }
    await finalizeOperatorTrace(app.workTraceStore, storeResult.workTraceId, {
      deliveryAttempted: true,
      deliveryResult,
      executionStartedAt,
      completedAt: new Date(),
      caller: "conversations.send",
    });
    return reply.code(httpResult.code).send(httpResult.body);
  },
);
```

`finalizeOperatorTrace` is a small shared helper at `apps/api/src/routes/work-trace-delivery-enrichment.ts` (new file). It:

1. Fetches the existing WorkTrace via `getByWorkUnitId`.
2. Merges the delivery patch into `parameters.message`.
3. Calls `workTraceStore.update(workUnitId, { parameters: merged, outcome: "completed", executionStartedAt, completedAt, durationMs }, { caller })` — finalizing **both** the trace's terminal outcome AND the enrichment data in one call. The `running → completed` transition stamps `lockedAt` automatically (validator §4.7.1).
4. On rejection (soft `{ ok: false, code: "WORK_TRACE_LOCKED" }` in production, or thrown `WorkTraceLockedError` in dev/test per `prisma-work-trace-store.ts:306-308`), wraps the throw in try/catch, logs `console.warn`, and continues. Mid-flight seal by another writer is extremely rare and not worth failing the operator's HTTP request, which already mutated state.

```ts
// apps/api/src/routes/work-trace-delivery-enrichment.ts
import type { WorkTraceStore } from "@switchboard/core/platform";
import { WorkTraceLockedError } from "@switchboard/core/platform";

export interface FinalizePatch {
  deliveryAttempted: boolean;
  deliveryResult: string;
  executionStartedAt: Date;
  completedAt: Date;
  caller: string;
}

export async function finalizeOperatorTrace(
  store: WorkTraceStore,
  workUnitId: string,
  patch: FinalizePatch,
): Promise<void> {
  const existing = await store.getByWorkUnitId(workUnitId);
  if (!existing) {
    console.warn(`[${patch.caller}] WorkTrace ${workUnitId} missing on finalize`);
    return;
  }
  const params = (existing.trace.parameters ?? {}) as Record<string, unknown>;
  const message = (params.message ?? {}) as Record<string, unknown>;
  const nextParameters = {
    ...params,
    message: {
      ...message,
      deliveryAttempted: patch.deliveryAttempted,
      deliveryResult: patch.deliveryResult,
    },
  };
  const durationMs = Math.max(0, patch.completedAt.getTime() - patch.executionStartedAt.getTime());
  try {
    const result = await store.update(
      workUnitId,
      {
        parameters: nextParameters,
        outcome: "completed",
        executionStartedAt: patch.executionStartedAt.toISOString(),
        completedAt: patch.completedAt.toISOString(),
        durationMs,
      },
      { caller: patch.caller },
    );
    if (!result.ok) {
      console.warn(`[${patch.caller}] WorkTrace ${workUnitId} finalize rejected: ${result.reason}`);
    }
  } catch (err) {
    if (err instanceof WorkTraceLockedError) {
      console.warn(
        `[${patch.caller}] WorkTrace ${workUnitId} sealed mid-flight: ${err.diagnostic.reason}`,
      );
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Trim the `PrismaLike` interface** — remove `update` from the typed surface in `conversations.ts` so `buildConversationList`/`buildConversationDetail` keep working but the file no longer declares the mutation method:

```ts
interface PrismaLike {
  conversationState: {
    findMany: (args: Record<string, unknown>) => Promise<ConversationRow[]>;
    count: (args: Record<string, unknown>) => Promise<number>;
    findFirst: (args: Record<string, unknown>) => Promise<ConversationRow | null>;
    findUnique: (args: Record<string, unknown>) => Promise<ConversationRow | null>;
    // update removed — mutations go through app.conversationStateStore
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/conversations.ts apps/api/src/routes/__tests__/conversations-send.test.ts
git commit -m "refactor(api): conversations send route uses store + WorkTraceStore.update for delivery"
```

---

## Task 15: Refactor `escalations.ts` POST reply route

**Files:**

- Modify: `apps/api/src/routes/escalations.ts`
- Modify: `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`

- [ ] **Step 1: Update the test** to mock `app.conversationStateStore.releaseEscalationToAi` and assert it is called with the resolved `threadId` (from `handoff.sessionId`). Cover the missing-conversation path (now an explicit error from the store, not silent skip — see spec §6.2).

- [ ] **Step 2: Refactor the handler** — replace the inline `app.prisma.conversationState.update` block in the reply route:

```ts
// after handoff.update(...) succeeds, IF handoff.sessionId is set:
let storeResult: ReleaseEscalationResult | null = null;
if (handoff.sessionId) {
  if (!app.conversationStateStore) {
    return reply.code(503).send({ error: "Conversation store unavailable", statusCode: 503 });
  }
  try {
    storeResult = await app.conversationStateStore.releaseEscalationToAi({
      organizationId: orgId,
      handoffId: handoff.id,
      threadId: handoff.sessionId,
      operator: resolveOperatorActor(request),
      reply: { text: message },
    });
  } catch (err) {
    if (err instanceof ConversationStateNotFoundError) {
      return reply
        .code(404)
        .send({ error: "Conversation not found for escalation", statusCode: 404 });
    }
    throw err;
  }
}

// channel delivery — use storeResult to find principalId/channel; fall back to
// fetching the conversation directly only if storeResult is null (sessionId was null).
const executionStartedAt = new Date(); // route-side stamp, set just before delivery
let channelDelivered = false;
if (storeResult && app.agentNotifier) {
  try {
    await app.agentNotifier.sendProactive(
      storeResult.destinationPrincipalId,
      storeResult.channel,
      message,
    );
    channelDelivered = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[escalations] Channel delivery failed for ${handoff.sessionId}: ${msg}`);
  }
  if (app.workTraceStore) {
    // finalize: enrich + transition to "completed" + stamp lockedAt
    await finalizeOperatorTrace(app.workTraceStore, storeResult.workTraceId, {
      deliveryAttempted: true,
      deliveryResult: channelDelivered ? "delivered" : "failed",
      executionStartedAt,
      completedAt: new Date(),
      caller: "escalations.reply",
    });
  }
}
```

`finalizeOperatorTrace` is imported from `apps/api/src/routes/work-trace-delivery-enrichment.ts` (the shared helper introduced in Task 14). Both routes use the same import.

The redundant post-update `app.prisma.conversationState.findUnique` lookup at line 227 is removed — `storeResult.channel` and `storeResult.destinationPrincipalId` already carry that info.

- [ ] **Step 3: Run, expect PASS.**

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/escalations.ts apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts apps/api/src/routes/work-trace-delivery-enrichment.ts
git commit -m "refactor(api): escalations reply route uses conversationStateStore + delivery enrichment"
```

---

## Task 16: Regression-harness test — routes never call `prisma.conversationState.update`

**Files:**

- Create: `apps/api/src/routes/__tests__/no-direct-conversation-state-mutation.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildTestApp } from "../../__tests__/test-server.js";

describe("Routes never call prisma.conversationState.update directly", () => {
  it("override route does not touch mockPrisma.conversationState.update on success", async () => {
    const updateSpy = vi.fn().mockImplementation(() => {
      throw new Error(
        "Routes must not mutate conversationState directly — use app.conversationStateStore",
      );
    });
    const app = await buildTestApp({
      // Wire mockPrisma so .update throws if anyone calls it
      prismaOverrides: { conversationState: { update: updateSpy } },
      conversationStateStore: {
        setOverride: vi.fn().mockResolvedValue({
          conversationId: "c",
          threadId: "t",
          status: "human_override",
          workTraceId: "wt",
        }),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t/override",
      payload: { override: true },
      headers: {
        /* auth */
      },
    });
    expect(res.statusCode).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("send route does not touch mockPrisma.conversationState.update on success", async () => {
    /* analogous */
  });
  it("escalation reply route does not touch mockPrisma.conversationState.update on success", async () => {
    /* analogous */
  });
});
```

(`prismaOverrides` may need to be added to the existing `buildTestApp` helper — small extension.)

- [ ] **Step 2: Run, expect PASS** (the refactored routes should already satisfy this contract).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/__tests__/no-direct-conversation-state-mutation.test.ts apps/api/src/__tests__/test-server.ts
git commit -m "test(api): assert routes never mutate conversationState via Prisma directly"
```

---

## Task 17: Integration test gated on `DATABASE_URL`

**Files:**

- Create: `apps/api/src/__tests__/conversation-state-store.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaConversationStateStore } from "@switchboard/db";
import { PrismaWorkTraceStore } from "@switchboard/db";

describe.skipIf(!process.env["DATABASE_URL"])("PrismaConversationStateStore (integration)", () => {
  it("setOverride writes ConversationState mutation and WorkTrace row in the same transaction", async () => {
    const prisma = new PrismaClient();
    try {
      // Seed a ConversationState row.
      const seed = await prisma.conversationState.create({
        data: {
          threadId: `it-${Date.now()}`,
          channel: "telegram",
          principalId: "p_int_test",
          organizationId: "org_int_test",
          status: "active",
          messages: [],
          firstReplyAt: null,
          lastActivityAt: new Date(),
        },
      });

      const workTraceStore = new PrismaWorkTraceStore(prisma, {
        auditLedger: { record: async () => undefined } as never,
        operatorAlerter: { alert: async () => undefined } as never,
      });
      const store = new PrismaConversationStateStore(prisma, workTraceStore);

      const result = await store.setOverride({
        organizationId: seed.organizationId!,
        threadId: seed.threadId,
        override: true,
        operator: { type: "user", id: "user_op_int" },
      });

      const after = await prisma.conversationState.findUnique({ where: { id: seed.id } });
      const traceRow = await prisma.workTrace.findUnique({
        where: { workUnitId: result.workTraceId },
      });
      expect(after?.status).toBe("human_override");
      expect(traceRow).not.toBeNull();
      expect(traceRow?.ingressPath).toBe("store_recorded_operator_mutation");
      expect(traceRow?.mode).toBe("operator_mutation");
      expect(traceRow?.intent).toBe("conversation.override.set");
      expect(traceRow?.hashInputVersion).toBe(2);
      expect(traceRow?.contentHash).toBeTruthy();
      // After setOverride() returns, the post-tx finalize update has run:
      // outcome MUST be "completed" and lockedAt MUST be stamped (the
      // running → completed transition triggers automatic locking via the
      // validator; spec §4.7.1).
      expect(traceRow?.outcome).toBe("completed");
      expect(traceRow?.lockedAt).not.toBeNull();
      expect(traceRow?.executionStartedAt).not.toBeNull();
      expect(traceRow?.completedAt).not.toBeNull();
      // Per CLAUDE.md ActorType convention, operator mutations record the
      // human-friendly type "user" (not the (non-existent) "operator").
      expect(traceRow?.actorType).toBe("user");
      expect(traceRow?.trigger).toBe("api");

      // Cleanup
      await prisma.workTrace.delete({ where: { workUnitId: result.workTraceId } });
      await prisma.conversationState.delete({ where: { id: seed.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
```

- [ ] **Step 2: Run** — without `DATABASE_URL`, expect SKIP. With `DATABASE_URL`, expect PASS.

Run: `pnpm --filter @switchboard/api exec vitest run apps/api/src/__tests__/conversation-state-store.integration.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/conversation-state-store.integration.test.ts
git commit -m "test(api): integration test for ConversationStateStore (skipped without DATABASE_URL)"
```

---

## Task 18: Verification, audit-doc update, and PR

**Files:**

- Modify: `.audit/08-launch-blocker-sequence.md`

- [ ] **Step 1: Run the full verification sequence**

```bash
pnpm reset
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

Expected: every command exits zero. If `pnpm reset` reports stale exports from `@switchboard/schemas`/`db`/`core`, re-run it once — that path is documented in `CLAUDE.md`.

- [ ] **Step 2: Update the Risk #1 audit entry** — open `.audit/08-launch-blocker-sequence.md`, locate Risk #1 (around line 512), and append a Status block:

```markdown
**Status:** ✅ Shipped <DATE> via PR #<N> (`fix/launch-conversation-state-store`).

Verification:

- `pnpm reset && pnpm typecheck && pnpm test && pnpm build && pnpm lint` clean as of <DATE>.
- Routes no longer mutate `prisma.conversationState`. Persistence boundary owned by `ConversationStateStore`.
- Each operator mutation produces a `WorkTrace` row with `ingressPath = "store_recorded_operator_mutation"` and `hashInputVersion = 2`.
- Pre-existing locked rows continue to verify against their original `contentHash` via the `hashInputVersion = 1` path.
```

(Replace `<DATE>` and `<N>` with real values when the implementation PR merges. The audit-doc edit can land in the implementation PR itself, alongside the code.)

- [ ] **Step 3: Commit**

```bash
git add .audit/08-launch-blocker-sequence.md
git commit -m "chore(audit): mark Launch-Risk #1 (ConversationStateStore) shipped"
```

- [ ] **Step 4: Push and open the implementation PR**

```bash
git push -u origin fix/launch-conversation-state-store
gh pr create --base main --head fix/launch-conversation-state-store \
  --title "fix(launch): ConversationStateStore for operator mutations (Launch-Risk #1)" \
  --body "..."
```

The PR body should reference the spec PR (#309 once merged), explain the operator-mutation trace shape, and include a test plan that lists `pnpm db:check-drift` as a merger pre-flight.

- [ ] **Step 5: Run `/code-review:code-review` on the open PR**

Address any ≥80-confidence finding before squash-merging. Below 80 is yours to triage.

- [ ] **Step 6: After merge, tear down the worktree**

```bash
cd /Users/jasonli/switchboard
git worktree remove .worktrees/fix-launch-conversation-state-store
git worktree prune
```

---

## Self-review

- **Spec coverage** — every section of the spec (§1 problem, §4 architecture, §5 tests, §6 behavioral changes including 6.2 explicit 404 and 6.4 pre-migration locked-row integrity, §8 acceptance) is covered by Tasks 1–18. The pre-migration locked-row integrity property is covered by Task 4's pinned-fixture test plus the v1/v2 split in `buildWorkTraceHashInput`.
- **Placeholder scan** — the `…` in Task 18 PR body is intentionally a fill-in (the PR body is composed by the implementer at PR-creation time using the spec/plan as source). Otherwise no `TBD` / `implement later` / "similar to Task N without code" patterns. Code blocks are full where the implementer needs to copy.
- **Type consistency** — `ConversationStateStore` method names (`setOverride`, `sendOperatorMessage`, `releaseEscalationToAi`) are stable across Tasks 8 → 9 → 10 → 11 → 13 → 14 → 15. Action-kind strings (`conversation.override.set`, `conversation.message.send`, `escalation.reply.release_to_ai`) match across the spec and every task. `ingressPath` literal values (`"platform_ingress"`, `"store_recorded_operator_mutation"`) are stable. `hashInputVersion` literal values (1, 2) are stable.
- **Open implementer choices** — three small ones, all called out in-task:
  1. Task 7 — whether to factor a shared `buildWorkTraceCreateData` helper between `persist()` and `recordOperatorMutation`. The instruction is "DRY beats duplication, but only if the diff stays small."
  2. Task 12 — whether `PrismaConversationStateStore` is re-exported from `packages/db/src/index.ts`; if not, the implementer adds the export.
  3. Task 13 — `resolveOperatorActor(request)`: small new helper or existing helper if one exists. Codebase exploration during Task 13 confirms.

These are deliberate handoffs to the implementer; the plan does not pretend to make decisions it cannot make without reading the current bootstrap code. Each is bounded and ≤ 10 lines of code.
