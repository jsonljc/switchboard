# F6 DLQ Retention Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scheduled retention purge that deletes aged `FailedMessage` (dead-letter-queue) rows so patient PII in failed-webhook payloads is no longer retained forever (PDPA F6).

**Architecture:** A new `packages/db` store method `PrismaFailedMessageRetentionStore.purgeExpired(...)` owns the batched, cross-tenant `deleteMany` (predicate: terminal-status rows past the soft window OR any-status rows past the hard cap). A new thin `apps/api` Inngest cron (`dlq-retention-purge.ts`, daily `0 4 * * *`) computes cutoffs from env-configurable windows and calls the store inside `step.run`, carrying the low-risk async-failure contract. No schema change (purge by indexed `createdAt`). Two new env vars.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma, Inngest, Vitest (mocked Prisma in `packages/db`; fake `step`/mocked store in `apps/api`).

---

## File Structure

- Create: `packages/db/src/stores/prisma-failed-message-retention-store.ts` — the batched purge `deleteMany`.
- Create: `packages/db/src/stores/__tests__/prisma-failed-message-retention-store.test.ts`
- Modify: `packages/db/src/index.ts` — export the new store.
- Create: `apps/api/src/services/cron/dlq-retention-purge.ts` — pure executor + cron factory.
- Create: `apps/api/src/services/cron/__tests__/dlq-retention-purge.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts` — construct store, build deps, register cron.
- Modify: `scripts/env-allowlist.local-readiness.json` — add the two env vars.
- Modify: `.env.example` — document the two env vars.

---

### Task 1: DB store — `purgeExpired` batched cross-tenant delete

**Files:**

- Create: `packages/db/src/stores/prisma-failed-message-retention-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-failed-message-retention-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { PrismaFailedMessageRetentionStore } from "../prisma-failed-message-retention-store.js";

function makePrisma(batches: string[][]) {
  // findMany returns successive batches of {id}; deleteMany echoes count.
  let call = 0;
  const findMany = vi.fn(async () => {
    const ids = batches[call] ?? [];
    call += 1;
    return ids.map((id) => ({ id }));
  });
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }));
  return { failedMessage: { findMany, deleteMany } } as never;
}

const SOFT = new Date("2026-05-12T00:00:00Z"); // now - 30d
const HARD = new Date("2026-03-13T00:00:00Z"); // now - 90d

describe("PrismaFailedMessageRetentionStore.purgeExpired", () => {
  it("selects with the soft-status-OR-hard-cap predicate, oldest first", async () => {
    const prisma = makePrisma([["a", "b"], []]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(prisma.failedMessage.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: { in: ["resolved", "exhausted"] }, createdAt: { lt: SOFT } },
          { createdAt: { lt: HARD } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });
  });

  it("loops batched deletes until a batch is empty and sums the count", async () => {
    const prisma = makePrisma([["a", "b"], ["c"], []]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 2,
      maxBatches: 100,
    });
    expect(prisma.failedMessage.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["a", "b"] } },
    });
    expect(prisma.failedMessage.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["c"] } },
    });
    expect(result).toEqual({ purged: 3, batches: 2, truncated: false });
  });

  it("halts at maxBatches and reports truncated", async () => {
    const prisma = makePrisma([["a"], ["b"], ["c"]]); // would keep going
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1,
      maxBatches: 2,
    });
    expect(result).toEqual({ purged: 2, batches: 2, truncated: true });
    expect(prisma.failedMessage.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the first batch is empty", async () => {
    const prisma = makePrisma([[]]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(result).toEqual({ purged: 0, batches: 0, truncated: false });
    expect(prisma.failedMessage.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test prisma-failed-message-retention-store`
Expected: FAIL — cannot find module `../prisma-failed-message-retention-store.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { PrismaClient } from "../client.js";

export interface PurgeExpiredInput {
  /** Rows with status in softStatuses and createdAt < softCutoff are purged. */
  softCutoff: Date;
  /** Rows of ANY status with createdAt < hardCutoff are purged (absolute cap). */
  hardCutoff: Date;
  softStatuses: string[];
  batchSize: number;
  maxBatches: number;
}

export interface PurgeExpiredResult {
  purged: number;
  batches: number;
  /** True when maxBatches was hit with rows still eligible. */
  truncated: boolean;
}

/**
 * Retention purge for the dead-letter queue (`FailedMessage`). The DLQ stores
 * the entire inbound webhook (patient message text + phone) verbatim; without a
 * purge it retains PII forever (PDPA F6). This deletes terminal-status rows past
 * the soft window and any-status rows past the hard cap, in bounded batches so a
 * large backlog never holds long table locks.
 */
export class PrismaFailedMessageRetentionStore {
  constructor(private prisma: PrismaClient) {}

  async purgeExpired(input: PurgeExpiredInput): Promise<PurgeExpiredResult> {
    const where = {
      OR: [
        { status: { in: input.softStatuses }, createdAt: { lt: input.softCutoff } },
        { createdAt: { lt: input.hardCutoff } },
      ],
    };

    let purged = 0;
    let batches = 0;
    let truncated = false;

    for (;;) {
      if (batches >= input.maxBatches) {
        truncated = true;
        break;
      }
      // route-governance: store-mutation-global — daily cron-triggered (inngest
      // 0 4 * * *) cross-tenant PDPA retention purge of the dead-letter queue;
      // no tenant context, intentionally system-wide.
      const rows = await this.prisma.failedMessage.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: input.batchSize,
      });
      if (rows.length === 0) break;

      const ids = rows.map((r: { id: string }) => r.id);
      const result = await this.prisma.failedMessage.deleteMany({ where: { id: { in: ids } } });
      purged += result.count;
      batches += 1;
    }

    return { purged, batches, truncated };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test prisma-failed-message-retention-store`
Expected: PASS (4 tests).

- [ ] **Step 5: Export the store + commit**

Add to `packages/db/src/index.ts` (alphabetically near other store exports):

```typescript
export { PrismaFailedMessageRetentionStore } from "./stores/prisma-failed-message-retention-store.js";
export type {
  PurgeExpiredInput,
  PurgeExpiredResult,
} from "./stores/prisma-failed-message-retention-store.js";
```

Then:

```bash
pnpm --filter @switchboard/db build
git add packages/db/src/stores/prisma-failed-message-retention-store.ts \
        packages/db/src/stores/__tests__/prisma-failed-message-retention-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): add failed-message retention purge store for pdpa (f6)"
```

> NOTE for executor: confirm the exact `PrismaClient` import path used by sibling stores in `packages/db/src/stores/` (it may be `../client.js` or a package-relative import). Match the sibling pattern exactly; adjust the import line if needed before building.

---

### Task 2: API cron — executor + factory

**Files:**

- Create: `apps/api/src/services/cron/dlq-retention-purge.ts`
- Test: `apps/api/src/services/cron/__tests__/dlq-retention-purge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  executeDlqRetentionPurge,
  createDlqRetentionPurgeCron,
  resolveRetentionWindows,
} from "../dlq-retention-purge.js";
import type { DlqRetentionPurgeDeps, StepTools } from "../dlq-retention-purge.js";
import type { AsyncFailureContext } from "@switchboard/core";

const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));
vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: createFunctionSpy })),
}));

function makeFailureContext(): AsyncFailureContext {
  return {
    auditLedger: { record: vi.fn().mockResolvedValue({}) },
    operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  } as unknown as AsyncFailureContext;
}

function makeStep(): StepTools {
  return { run: vi.fn((_n: string, fn: () => unknown) => fn()) as StepTools["run"] };
}

const NOW = new Date("2026-06-11T00:00:00Z");

function makeDeps(over: Partial<DlqRetentionPurgeDeps> = {}): DlqRetentionPurgeDeps {
  return {
    failure: makeFailureContext(),
    purge: vi.fn().mockResolvedValue({ purged: 5, batches: 1, truncated: false }),
    now: () => NOW,
    softRetentionDays: 30,
    hardRetentionDays: 90,
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
}

describe("resolveRetentionWindows", () => {
  it("defaults to 30/90 when env is absent or non-numeric", () => {
    expect(resolveRetentionWindows(undefined, undefined)).toEqual({ soft: 30, hard: 90 });
    expect(resolveRetentionWindows("abc", "")).toEqual({ soft: 30, hard: 90 });
  });
  it("parses numeric env values", () => {
    expect(resolveRetentionWindows("14", "60")).toEqual({ soft: 14, hard: 60 });
  });
  it("floors the hard cap to never be tighter than the soft window", () => {
    expect(resolveRetentionWindows("45", "30")).toEqual({ soft: 45, hard: 45 });
  });
});

describe("executeDlqRetentionPurge", () => {
  it("computes cutoffs from now + windows and calls purge inside a step", async () => {
    const deps = makeDeps();
    const result = await executeDlqRetentionPurge(makeStep(), deps);
    expect(deps.purge).toHaveBeenCalledWith({
      softCutoff: new Date("2026-05-12T00:00:00Z"), // now - 30d
      hardCutoff: new Date("2026-03-13T00:00:00Z"), // now - 90d
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(result).toEqual({ purged: 5, batches: 1, truncated: false });
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it("warns when the purge truncated", async () => {
    const deps = makeDeps({
      purge: vi.fn().mockResolvedValue({ purged: 100000, batches: 100, truncated: true }),
    });
    await executeDlqRetentionPurge(makeStep(), deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe("createDlqRetentionPurgeCron", () => {
  it("registers a daily function with an onFailure handler", () => {
    createDlqRetentionPurgeCron(makeDeps());
    const cfg = createFunctionSpy.mock.calls.at(-1)?.[0];
    expect(cfg.id).toBe("dlq-retention-purge");
    expect(cfg.triggers).toEqual([{ cron: "0 4 * * *" }]);
    expect(typeof cfg.onFailure).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test dlq-retention-purge`
Expected: FAIL — cannot find module `../dlq-retention-purge.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { PurgeExpiredInput, PurgeExpiredResult } from "@switchboard/db";

const inngestClient = new Inngest({ id: "switchboard" });

const DEFAULT_SOFT_RETENTION_DAYS = 30;
const DEFAULT_HARD_RETENTION_DAYS = 90;
const SOFT_STATUSES = ["resolved", "exhausted"];
const BATCH_SIZE = 1000;
const MAX_BATCHES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface DlqRetentionPurgeDeps {
  failure: AsyncFailureContext;
  purge: (input: PurgeExpiredInput) => Promise<PurgeExpiredResult>;
  now?: () => Date;
  softRetentionDays: number;
  hardRetentionDays: number;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

/**
 * Parse the two retention-window env vars. Non-numeric / absent values fall
 * back to defaults (Number.isFinite guard — a NaN-blind comparison would purge
 * nothing or everything). The hard cap is floored to the soft window so a
 * misconfiguration can never make the absolute cap tighter than the soft one.
 */
export function resolveRetentionWindows(
  softEnv: string | undefined,
  hardEnv: string | undefined,
): { soft: number; hard: number } {
  const parse = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const soft = parse(softEnv, DEFAULT_SOFT_RETENTION_DAYS);
  const hard = Math.max(parse(hardEnv, DEFAULT_HARD_RETENTION_DAYS), soft);
  return { soft, hard };
}

export async function executeDlqRetentionPurge(
  step: StepTools,
  deps: DlqRetentionPurgeDeps,
): Promise<PurgeExpiredResult> {
  const now = (deps.now ?? (() => new Date()))();
  const softCutoff = new Date(now.getTime() - deps.softRetentionDays * DAY_MS);
  const hardCutoff = new Date(now.getTime() - deps.hardRetentionDays * DAY_MS);

  const result = await step.run("purge-expired-dlq", () =>
    deps.purge({
      softCutoff,
      hardCutoff,
      softStatuses: SOFT_STATUSES,
      batchSize: BATCH_SIZE,
      maxBatches: MAX_BATCHES,
    }),
  );

  deps.logger.info(
    `[dlq-retention-purge] purged=${result.purged} batches=${result.batches} ` +
      `softDays=${deps.softRetentionDays} hardDays=${deps.hardRetentionDays}`,
  );
  if (result.truncated) {
    deps.logger.warn(
      `[dlq-retention-purge] maxBatches (${MAX_BATCHES}) hit with rows remaining; ` +
        `next run continues. purged=${result.purged}`,
    );
  }
  return result;
}

export function createDlqRetentionPurgeCron(deps: DlqRetentionPurgeDeps) {
  return inngestClient.createFunction(
    {
      id: "dlq-retention-purge",
      name: "Dead-Letter Queue Retention Purge",
      retries: 2,
      triggers: [{ cron: "0 4 * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "dlq-retention-purge",
          riskCategory: "low",
          alert: false,
          emitEvent: false,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeDlqRetentionPurge(step as unknown as StepTools, deps);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test dlq-retention-purge`
Expected: PASS.

> NOTE for executor: confirm `makeOnFailureHandler`'s config field names against `meta-token-refresh.ts` (it omits `eventDomain` for a low-risk no-event cron — match that file exactly). If the `onFailure` config shape differs, copy it verbatim from `meta-token-refresh.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/cron/dlq-retention-purge.ts \
        apps/api/src/services/cron/__tests__/dlq-retention-purge.test.ts
git commit -m "feat(api): add dlq retention purge cron executor (f6)"
```

---

### Task 3: Wire the cron in bootstrap + env

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts`
- Modify: `scripts/env-allowlist.local-readiness.json`
- Modify: `.env.example`

- [ ] **Step 1: Add the store import** to the `@switchboard/db` import block in `inngest.ts`:

```typescript
  PrismaFailedMessageRetentionStore,
```

- [ ] **Step 2: Add the cron-factory import** near the other `../services/cron/*` imports:

```typescript
import { createDlqRetentionPurgeCron } from "../services/cron/dlq-retention-purge.js";
import type { DlqRetentionPurgeDeps } from "../services/cron/dlq-retention-purge.js";
```

- [ ] **Step 3: Build deps** — place after `metaTokenRefreshDeps` (it shares the daily-maintenance theme), before the `await app.register(inngestFastify, ...)` call:

```typescript
// Dead-letter-queue retention purge (PDPA F6). Deletes aged FailedMessage rows
// (terminal-status past the soft window OR any-status past the hard cap) so the
// DLQ — which stores the entire inbound webhook (patient text + phone) — does
// not retain PII forever. Cross-tenant by design; thin orchestrator over the
// batched db-store purge. Windows env-configurable (defaults 30 / 90 days).
const failedMessageRetentionStore = new PrismaFailedMessageRetentionStore(app.prisma);
const { soft: dlqSoftDays, hard: dlqHardDays } = resolveRetentionWindows(
  process.env["DLQ_RETENTION_DAYS"],
  process.env["DLQ_HARD_RETENTION_DAYS"],
);
const dlqRetentionPurgeDeps: DlqRetentionPurgeDeps = {
  failure: asyncFailure,
  purge: (input) => failedMessageRetentionStore.purgeExpired(input),
  softRetentionDays: dlqSoftDays,
  hardRetentionDays: dlqHardDays,
  logger: { info: (msg) => app.log.info(msg), warn: (msg) => app.log.warn(msg) },
};
```

Add `resolveRetentionWindows` to the cron-factory import line from Step 2:

```typescript
import {
  createDlqRetentionPurgeCron,
  resolveRetentionWindows,
} from "../services/cron/dlq-retention-purge.js";
import type { DlqRetentionPurgeDeps } from "../services/cron/dlq-retention-purge.js";
```

- [ ] **Step 4: Register the cron** in the `functions: [ ... ]` array (add after `createMetaTokenRefreshCron(metaTokenRefreshDeps),`):

```typescript
      createDlqRetentionPurgeCron(dlqRetentionPurgeDeps),
```

- [ ] **Step 5: Add env vars to the allowlist** — insert `DLQ_HARD_RETENTION_DAYS` and `DLQ_RETENTION_DAYS` into the `required_in_env_example` array in `scripts/env-allowlist.local-readiness.json`, keeping alphabetical order (they sit just after `DEV_BYPASS_AUTH`, before `EMAIL_FROM`):

```json
    "DEV_BYPASS_AUTH",
    "DLQ_HARD_RETENTION_DAYS",
    "DLQ_RETENTION_DAYS",
    "EMAIL_FROM",
```

- [ ] **Step 6: Document env vars in `.env.example`** — add near other background-job / retention settings (or after the database block):

```bash
# Dead-letter-queue retention purge (PDPA F6). Aged FailedMessage rows are deleted daily (0 4 * * *).
# Terminal-status (resolved/exhausted) rows older than DLQ_RETENTION_DAYS are purged;
# any-status rows older than DLQ_HARD_RETENTION_DAYS are purged unconditionally (absolute cap).
DLQ_RETENTION_DAYS=30
DLQ_HARD_RETENTION_DAYS=90
```

- [ ] **Step 7: Build + run the env-completeness check + both suites**

Run:

```bash
pnpm --filter @switchboard/db build
pnpm --filter @switchboard/api build
CI=1 npx tsx scripts/check-env-completeness.ts
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/api test
```

Expected: env check passes (both vars categorized); all tests green.

> NOTE for executor: if `check-env-completeness.ts` is not the exact script name, find it via `ls scripts | grep env`. The allowlist file's `$schema-note` names the checker.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts scripts/env-allowlist.local-readiness.json .env.example
git commit -m "feat(api): wire dlq retention purge cron + env (f6)"
```

---

### Task 4: Full gate sweep

- [ ] **Step 1: Run all required gates**

Run:

```bash
pnpm typecheck
pnpm arch:check
pnpm format:check
```

Expected: all pass. If `format:check` flags files, run `pnpm format` (or `pnpm exec prettier --write` on the touched files) and re-commit.

- [ ] **Step 2: Confirm apps/chat is untouched**

Run: `git diff --name-only origin/main...HEAD | grep '^apps/chat' || echo "chat untouched"`
Expected: `chat untouched` (so its suite is not required).

- [ ] **Step 3: Final commit if formatting changed**

```bash
git add -A && git commit -m "style: prettier formatting for dlq retention purge (f6)" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:**

- Retention windows (soft 30 / hard 90, env-configurable, hard ≥ soft) → Task 2 `resolveRetentionWindows` + Task 3 env.
- Delete location (db store, called by api cron) → Task 1 + Task 2/3.
- No schema change (purge by `createdAt`) → Task 1 predicate, no migration anywhere.
- Batching (cursor loop, batchSize 1000, maxBatches 100, terminates) → Task 1 tests.
- Observability (count + truncation log) → Task 2.
- Schedule `0 4 * * *` + low-risk failure contract → Task 2.
- `store-mutation-global` annotation → Task 1 implementation.
- env-allowlist + `.env.example` → Task 3.
- Gates (db + api test, typecheck, arch:check, format:check) → Task 3/4.

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `purgeExpired`/`PurgeExpiredInput`/`PurgeExpiredResult` defined in Task 1 and consumed identically in Task 2/3. `DlqRetentionPurgeDeps.purge` signature matches the store method. `resolveRetentionWindows` signature matches its call site in Task 3.
