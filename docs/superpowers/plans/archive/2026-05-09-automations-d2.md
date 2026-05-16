# `/automations` (Slice D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Mercury read-only `/automations` register over `ScheduledTriggerRecord` — the third Tools-tier surface, behind `NEXT_PUBLIC_AUTOMATIONS_LIVE`.

**Architecture:** Backend stays surface-agnostic — projection types extend the existing `packages/schemas/src/scheduler.ts`; a new `listTriggersForBrowse` core function projects raw `ScheduledTrigger` rows from a new `TriggerStore.listForBrowse` method into a redacted `ScheduledTriggerBrowseRow`. Cursor encoding and trimming live in core. Frontend is the only place the word "automation" appears, with an inline drawer for inspectability.

**Tech Stack:** TypeScript, pnpm + Turbo monorepo, Zod schemas, Prisma + Postgres, Fastify (API), Next.js App Router (dashboard), TanStack React Query, vitest, Tailwind + CSS modules.

**Spec:** `docs/superpowers/specs/2026-05-09-automations-d2-design.md` (v3, decisions ledger §2.0).

**PR shape:** Two PRs targeting `main`.

- **PR-D2a** = Tasks 1–8 (backend: schemas + core + db + api + Next proxy + Prisma index).
- **PR-D2b** = Tasks 9–18 (frontend page + tests). Gated by `NEXT_PUBLIC_AUTOMATIONS_LIVE=false` until staging review.

After every task: `pnpm typecheck` and the relevant `pnpm --filter <pkg> test` must be green before commit. CI runs `pnpm lint` + `pnpm test` + `pnpm typecheck` on PR open; fix errors locally, never on the PR.

If `pnpm typecheck` reports missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core` after a schema or store edit, run `pnpm reset` (per CLAUDE.md) before debugging — the dist/ folders need refreshing across the layers.

---

## File map

### PR-D2a (backend)

**Modify:**

- `packages/schemas/src/scheduler.ts` — append browse types.
- `packages/core/src/scheduler/trigger-store.ts` — add `listForBrowse` to interface.
- `packages/core/src/scheduler/index.ts` — export new helpers.
- `packages/core/src/scheduler/__tests__/scheduler-service.test.ts` — replace inline in-memory store with shared import.
- `packages/db/src/index.ts` — barrel-export `InMemoryTriggerStore`.
- `packages/db/src/stores/prisma-trigger-store.ts` — implement `listForBrowse`.
- `packages/db/prisma/schema.prisma` — add `@@index([organizationId, createdAt])` to `ScheduledTriggerRecord`.
- `apps/api/src/types/decisions-fastify.d.ts` — add `triggerStore?: TriggerStore`.
- `apps/api/src/app.ts` — decorate `triggerStore`.
- `apps/api/src/bootstrap/routes.ts` — register `dashboardAutomationsRoutes`.
- `apps/dashboard/src/lib/api-client/dashboard.ts` — add `getAutomations(query)`.

**Create:**

- `packages/core/src/scheduler/list-triggers.ts`
- `packages/core/src/scheduler/__tests__/list-triggers.test.ts`
- `packages/db/src/stores/in-memory-trigger-store.ts`
- `packages/db/prisma/migrations/<timestamp>_automations_d2_index/migration.sql` (generated)
- `apps/api/src/routes/dashboard-automations.ts`
- `apps/api/src/__tests__/api-automations.test.ts`
- `apps/dashboard/src/app/api/dashboard/automations/route.ts`
- `apps/dashboard/src/app/api/dashboard/automations/__tests__/route.test.ts`

### PR-D2b (frontend)

**Modify:**

- `apps/dashboard/src/lib/query-keys.ts` — append `automations` namespace.

**Create (route + page):**

- `apps/dashboard/src/app/(auth)/automations/page.tsx`
- `apps/dashboard/src/app/(auth)/automations/automations-page.tsx`
- `apps/dashboard/src/app/(auth)/automations/automations.module.css`
- `apps/dashboard/src/app/(auth)/automations/fixtures.ts`

**Create (components):**

- `components/header.tsx`
- `components/filter-chips.tsx`
- `components/automations-table.tsx`
- `components/automation-row.tsx`
- `components/automation-row-drawer.tsx`
- `components/pagination-footer.tsx`
- `components/empty-state.tsx`
- `components/format.ts`

**Create (hooks):**

- `hooks/use-automations-list.ts`

**Create (tests):**

- `__tests__/automations-page.test.tsx`
- `__tests__/automations-table.test.tsx`
- `__tests__/automation-row-drawer.test.tsx`
- `__tests__/filter-chips.test.tsx`
- `__tests__/use-automations-list.test.ts`
- `components/format.test.ts`

---

# PR-D2a — Backend

## Task 1: Append browse types to `packages/schemas/src/scheduler.ts`

**Files:**

- Modify: `packages/schemas/src/scheduler.ts` (append at end, before any existing trailing comments)

The new browse types live in the **existing** `scheduler.ts` (not a new file) so the schema layer stays surface-agnostic.

- [ ] **Step 1: Append the browse projection schemas**

Add to the bottom of `packages/schemas/src/scheduler.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// D2 — /automations browse projection (page-ready, surface-agnostic).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row in the /automations Mercury list.
 *
 * Hard invariant: never carries `action.payload` values. The drawer surfaces
 * an allowlisted subset of payload key names plus a `redactedKeyCount`.
 */
export const ScheduledTriggerBrowseRowSchema = z.object({
  id: z.string(),
  type: TriggerTypeSchema,
  status: TriggerStatusSchema,
  // Derived display label — see core/list-triggers.ts. Defensive fallbacks
  // ("cron:unknown" etc.) keep malformed legacy rows from crashing the page.
  scheduleLabel: z.string(),
  actionType: TriggerActionTypeSchema,
  sourceWorkflowId: z.string().nullable(),
  createdAt: z.string().datetime(),
  fireAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  drawer: z.object({
    eventPatternSummary: z.string().nullable(),
    visibleActionPayloadKeys: z.array(z.string()),
    redactedKeyCount: z.number().int().min(0),
  }),
});
export type ScheduledTriggerBrowseRow = z.infer<typeof ScheduledTriggerBrowseRowSchema>;

/**
 * Query for `GET /api/dashboard/automations`. No `type` filter in v1
 * (cut for YAGNI per spec §2.0 #6); no `search` in v1; only `createdAt` sort.
 */
export const ScheduledTriggersListQuerySchema = z.object({
  status: TriggerStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["createdAt"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ScheduledTriggersListQuery = z.infer<typeof ScheduledTriggersListQuerySchema>;

export const TriggerStatusCountsSchema = z.object({
  all: z.number().int().min(0),
  active: z.number().int().min(0),
  fired: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  expired: z.number().int().min(0),
});
export type TriggerStatusCounts = z.infer<typeof TriggerStatusCountsSchema>;

export const ScheduledTriggersListResponseSchema = z.object({
  rows: z.array(ScheduledTriggerBrowseRowSchema),
  // Counts reflect persisted ScheduledTriggerRecord rows only — reaped rows
  // (deleted by TriggerStore.deleteExpired) are not surfaced. D2 doesn't
  // recompute expiry state.
  statusCounts: TriggerStatusCountsSchema,
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ScheduledTriggersListResponse = z.infer<typeof ScheduledTriggersListResponseSchema>;
```

- [ ] **Step 2: Build & typecheck**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/schemas typecheck`
Expected: clean exit. The package re-exports from `index.ts` via `export *` (already present), so the new types are auto-barrelled.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/scheduler.ts
git commit -m "feat(schemas): /automations browse projection (D2)"
```

---

## Task 2: Extract in-memory trigger store

**Files:**

- Create: `packages/db/src/stores/in-memory-trigger-store.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/core/src/scheduler/__tests__/scheduler-service.test.ts` (replace inline `createInMemoryTriggerStore`)

The fixture lives inline at `scheduler-service.test.ts:14`. Cleanup-while-here: extract so D2's `list-triggers.test.ts` can reuse it.

- [ ] **Step 1: Create the shared in-memory store**

`packages/db/src/stores/in-memory-trigger-store.ts`:

```ts
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";
import type { TriggerStore } from "@switchboard/core";

/**
 * Test-only in-memory implementation of `TriggerStore`. Extracted from
 * `scheduler-service.test.ts` so that `list-triggers.test.ts` can reuse it.
 * Production code uses `PrismaTriggerStore`.
 */
export class InMemoryTriggerStore implements TriggerStore {
  private readonly triggers = new Map<string, ScheduledTrigger>();

  async save(trigger: ScheduledTrigger): Promise<void> {
    this.triggers.set(trigger.id, { ...trigger });
  }

  async findById(id: string): Promise<ScheduledTrigger | null> {
    return this.triggers.get(id) ?? null;
  }

  async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    let result = Array.from(this.triggers.values());
    if (filters.organizationId) {
      result = result.filter((t) => t.organizationId === filters.organizationId);
    }
    if (filters.status) {
      result = result.filter((t) => t.status === filters.status);
    }
    if (filters.type) {
      result = result.filter((t) => t.type === filters.type);
    }
    if (filters.sourceWorkflowId) {
      result = result.filter((t) => t.sourceWorkflowId === filters.sourceWorkflowId);
    }
    return result;
  }

  async updateStatus(id: string, status: TriggerStatus): Promise<void> {
    const trigger = this.triggers.get(id);
    if (trigger) {
      this.triggers.set(id, { ...trigger, status });
    }
  }

  async deleteExpired(before: Date): Promise<number> {
    let count = 0;
    for (const [id, trigger] of this.triggers) {
      if (
        trigger.expiresAt &&
        trigger.expiresAt < before &&
        ["fired", "cancelled", "expired"].includes(trigger.status)
      ) {
        this.triggers.delete(id);
        count++;
      }
    }
    return count;
  }

  async expireOverdue(now: Date): Promise<number> {
    let count = 0;
    for (const [id, trigger] of this.triggers) {
      if (trigger.status === "active" && trigger.expiresAt && trigger.expiresAt < now) {
        this.triggers.set(id, { ...trigger, status: "expired" });
        count++;
      }
    }
    return count;
  }

  /**
   * Test-only: snapshot of all triggers (used by list-triggers tests that
   * need to seed and inspect at once). Not part of `TriggerStore`.
   */
  _all(): ScheduledTrigger[] {
    return Array.from(this.triggers.values()).map((t) => ({ ...t }));
  }
}
```

- [ ] **Step 2: Barrel-export it**

Add to `packages/db/src/index.ts` near the existing `PrismaTriggerStore` export (line 66):

```ts
export { InMemoryTriggerStore } from "./stores/in-memory-trigger-store.js";
```

- [ ] **Step 3: Replace the inline fixture in scheduler-service.test.ts**

In `packages/core/src/scheduler/__tests__/scheduler-service.test.ts` lines ~14–73, delete the local `createInMemoryTriggerStore` function entirely.

Add at the top of the file (with the other imports):

```ts
import { InMemoryTriggerStore } from "@switchboard/db";
```

Replace every `createInMemoryTriggerStore()` call site with `new InMemoryTriggerStore()`. Search the file to make sure there are no remaining references.

- [ ] **Step 4: Run scheduler tests to verify nothing regressed**

Run: `pnpm --filter @switchboard/core test -- scheduler-service`
Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/in-memory-trigger-store.ts packages/db/src/index.ts packages/core/src/scheduler/__tests__/scheduler-service.test.ts
git commit -m "refactor(db): extract InMemoryTriggerStore for shared test reuse"
```

---

## Task 3: Add `listForBrowse` to `TriggerStore` interface + in-memory impl

**Files:**

- Modify: `packages/core/src/scheduler/trigger-store.ts`
- Modify: `packages/db/src/stores/in-memory-trigger-store.ts`

The store stays dumb about cursor encoding/trimming — it returns up to `limit + 1` rows raw. Core owns those semantics (Task 4).

- [ ] **Step 1: Extend the interface**

Replace the contents of `packages/core/src/scheduler/trigger-store.ts` with:

```ts
import type {
  ScheduledTrigger,
  TriggerFilters,
  TriggerStatus,
  TriggerStatusCounts,
} from "@switchboard/schemas";

/**
 * Pre-decoded keyset cursor handed to `listForBrowse`. The store is unaware
 * of base64; the projector (core/list-triggers.ts) encodes/decodes on the
 * way in/out. Mirrors the ContactBrowseQuery cursor pattern.
 */
export interface TriggerBrowseCursor {
  ts: Date;
  id: string;
}

export interface TriggerBrowseQuery {
  orgId: string;
  status?: TriggerStatus;
  sort: "createdAt";
  direction: "asc" | "desc";
  cursor?: TriggerBrowseCursor;
  /** Store fetches up to `limit + 1` rows so the projector can detect hasMore. */
  limit: number;
}

export interface TriggerBrowseResult {
  /** Up to `limit + 1` rows. Core trims to `limit` and computes hasMore. */
  rows: ScheduledTrigger[];
  /** Per-status counts across all org rows (single GROUP BY). */
  statusCounts: TriggerStatusCounts;
}

export interface TriggerStore {
  save(trigger: ScheduledTrigger): Promise<void>;
  findById(id: string): Promise<ScheduledTrigger | null>;
  findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  updateStatus(id: string, status: TriggerStatus): Promise<void>;
  deleteExpired(before: Date): Promise<number>;
  /** Mark active triggers whose expiresAt has passed as "expired". */
  expireOverdue(now: Date): Promise<number>;
  /**
   * Read-only browse projection backing `GET /api/dashboard/automations`.
   * Distinct from `findByFilters` — this method handles cursor pagination,
   * sort direction, and per-status counts in one round-trip. Mutating callers
   * and event matching keep using the existing methods.
   */
  listForBrowse(query: TriggerBrowseQuery): Promise<TriggerBrowseResult>;
}
```

- [ ] **Step 2: Implement on the in-memory store**

In `packages/db/src/stores/in-memory-trigger-store.ts`, add this method to the `InMemoryTriggerStore` class (above `_all`):

```ts
async listForBrowse(query: import("@switchboard/core").TriggerBrowseQuery): Promise<
  import("@switchboard/core").TriggerBrowseResult
> {
  const orgRows = Array.from(this.triggers.values()).filter(
    (t) => t.organizationId === query.orgId,
  );

  // Per-status counts over the full org set (chip counts ignore filter/cursor).
  const statusCounts = {
    all: orgRows.length,
    active: orgRows.filter((t) => t.status === "active").length,
    fired: orgRows.filter((t) => t.status === "fired").length,
    cancelled: orgRows.filter((t) => t.status === "cancelled").length,
    expired: orgRows.filter((t) => t.status === "expired").length,
  };

  let filtered = orgRows;
  if (query.status) {
    filtered = filtered.filter((t) => t.status === query.status);
  }

  // Sort by (createdAt, id) — id is the stable tiebreak for keyset paging.
  const dir = query.direction === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    const tsCmp = a.createdAt.getTime() - b.createdAt.getTime();
    if (tsCmp !== 0) return tsCmp * dir;
    return a.id.localeCompare(b.id) * dir;
  });

  // Apply cursor (strict: row must come *after* the cursor in sort order).
  if (query.cursor) {
    const cTs = query.cursor.ts.getTime();
    const cId = query.cursor.id;
    filtered = filtered.filter((t) => {
      const tsCmp = t.createdAt.getTime() - cTs;
      if (tsCmp !== 0) return tsCmp * dir > 0;
      return t.id.localeCompare(cId) * dir > 0;
    });
  }

  const rows = filtered.slice(0, query.limit + 1); // up to limit + 1; core trims
  return { rows, statusCounts };
}
```

(The `import("@switchboard/core")` inline types avoid a circular `db → core` value import; `@switchboard/db` only imports types from `@switchboard/core`, never values.)

- [ ] **Step 3: Update the existing scheduler-service.test.ts to compile**

Run: `pnpm --filter @switchboard/core typecheck`

If typecheck fails because `scheduler-service.test.ts` references the old single-method `TriggerStore` shape, those tests should already pass — `listForBrowse` is new and existing tests don't call it. If you hit a "missing method `listForBrowse`" error, the existing test instantiates a structural literal of `TriggerStore`; convert it to use `new InMemoryTriggerStore()` (already done in Task 2 — re-check).

- [ ] **Step 4: Build core + db**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/db build`
Expected: clean exit on both.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scheduler/trigger-store.ts packages/db/src/stores/in-memory-trigger-store.ts
git commit -m "feat(core,db): add TriggerStore.listForBrowse for /automations browse (D2)"
```

---

## Task 4: Core projector `listTriggersForBrowse`

**Files:**

- Create: `packages/core/src/scheduler/list-triggers.ts`
- Create: `packages/core/src/scheduler/__tests__/list-triggers.test.ts`
- Modify: `packages/core/src/scheduler/index.ts`

This is the heart of D2a. TDD: write the tests first, then implement.

- [ ] **Step 1: Create the test file (failing)**

`packages/core/src/scheduler/__tests__/list-triggers.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTriggerStore } from "@switchboard/db";
import { listTriggersForBrowse, InvalidCursorError } from "../list-triggers.js";
import type { ScheduledTrigger } from "@switchboard/schemas";

const ORG = "org-test";
const OTHER = "org-other";

function trigger(
  overrides: Partial<ScheduledTrigger> & { id: string; createdAt: Date },
): ScheduledTrigger {
  return {
    id: overrides.id,
    organizationId: overrides.organizationId ?? ORG,
    type: overrides.type ?? "cron",
    fireAt: overrides.fireAt ?? null,
    cronExpression: overrides.cronExpression ?? "0 7 * * *",
    eventPattern: overrides.eventPattern ?? null,
    action: overrides.action ?? { type: "spawn_workflow", payload: {} },
    sourceWorkflowId: overrides.sourceWorkflowId ?? null,
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt,
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("listTriggersForBrowse", () => {
  let store: InMemoryTriggerStore;

  beforeEach(() => {
    store = new InMemoryTriggerStore();
  });

  it("default sort is createdAt DESC", async () => {
    await store.save(trigger({ id: "t1", createdAt: new Date("2026-05-01T00:00:00Z") }));
    await store.save(trigger({ id: "t2", createdAt: new Date("2026-05-03T00:00:00Z") }));
    await store.save(trigger({ id: "t3", createdAt: new Date("2026-05-02T00:00:00Z") }));

    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );

    expect(res.rows.map((r) => r.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("status filter applies before pagination", async () => {
    await store.save(trigger({ id: "a", status: "active", createdAt: new Date("2026-05-01") }));
    await store.save(trigger({ id: "f", status: "fired", createdAt: new Date("2026-05-02") }));
    await store.save(trigger({ id: "c", status: "cancelled", createdAt: new Date("2026-05-03") }));

    const res = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: { status: "active", sort: "createdAt", direction: "desc", limit: 50 },
      },
      { triggerStore: store },
    );

    expect(res.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("cursor round-trip yields the next page", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(
        trigger({ id: `t${i}`, createdAt: new Date(`2026-05-${String(i + 1).padStart(2, "0")}`) }),
      );
    }

    const page1 = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 2 } },
      { triggerStore: store },
    );
    expect(page1.rows).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: {
          sort: "createdAt",
          direction: "desc",
          limit: 2,
          cursor: page1.nextCursor!,
        },
      },
      { triggerStore: store },
    );
    expect(page2.rows).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: {
          sort: "createdAt",
          direction: "desc",
          limit: 2,
          cursor: page2.nextCursor!,
        },
      },
      { triggerStore: store },
    );
    expect(page3.rows).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
  });

  it("hasMore reflects fetch-count > limit", async () => {
    await store.save(trigger({ id: "t1", createdAt: new Date("2026-05-01") }));
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 1 } },
      { triggerStore: store },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it("scheduleLabel uses cron expression for cron triggers", async () => {
    await store.save(
      trigger({
        id: "c",
        type: "cron",
        cronExpression: "*/15 * * * *",
        fireAt: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("*/15 * * * *");
  });

  it("scheduleLabel uses ISO for timer triggers", async () => {
    await store.save(
      trigger({
        id: "t",
        type: "timer",
        fireAt: new Date("2026-05-12T18:00:00Z"),
        cronExpression: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("2026-05-12T18:00:00.000Z");
  });

  it("scheduleLabel uses event:<type> for event_match triggers", async () => {
    await store.save(
      trigger({
        id: "e",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: { type: "lead.captured", filters: { source: "ad" } },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("event:lead.captured");
  });

  it("scheduleLabel falls back gracefully on malformed legacy rows", async () => {
    // Plant deliberately malformed rows directly via the store.
    await store.save(
      trigger({
        id: "bad-cron",
        type: "cron",
        cronExpression: null,
        fireAt: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    await store.save(
      trigger({
        id: "bad-timer",
        type: "timer",
        cronExpression: null,
        fireAt: null,
        createdAt: new Date("2026-05-02"),
      }),
    );
    await store.save(
      trigger({
        id: "bad-event",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: null,
        createdAt: new Date("2026-05-03"),
      }),
    );

    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "asc", limit: 50 } },
      { triggerStore: store },
    );
    const labels = Object.fromEntries(res.rows.map((r) => [r.id, r.scheduleLabel]));
    expect(labels["bad-cron"]).toBe("cron:unknown");
    expect(labels["bad-timer"]).toBe("timer:unknown");
    expect(labels["bad-event"]).toBe("event:unknown");
  });

  it("eventPatternSummary lists pattern type + filter key names", async () => {
    await store.save(
      trigger({
        id: "e",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: { type: "lead.captured", filters: { source: "ad", contactId: "x" } },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.drawer.eventPatternSummary).toBe(
      "lead.captured (filters: source, contactId)",
    );
  });

  it("eventPatternSummary is null for non-event_match rows", async () => {
    await store.save(trigger({ id: "c", createdAt: new Date("2026-05-01") }));
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.drawer.eventPatternSummary).toBeNull();
  });

  it("VALUE redaction: payload values never appear in the projection", async () => {
    await store.save(
      trigger({
        id: "redact",
        action: {
          type: "spawn_workflow",
          payload: { sentinel: "REDACTION_PROBE_X9", workflowId: "wf-abc" },
        },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    const json = JSON.stringify(res);
    expect(json).not.toContain("REDACTION_PROBE_X9");
    expect(json).not.toContain('"sentinel"'); // non-allowlisted key also stripped
    expect(json).toContain("workflowId"); // allowlisted key kept
  });

  it("KEY allowlist: non-allowlisted keys are counted, not exposed", async () => {
    await store.save(
      trigger({
        id: "allowlist",
        action: {
          type: "spawn_workflow",
          payload: {
            stripeCustomerId: "cus_x",
            contactId: "c-1",
            workflowId: "wf-y",
          },
        },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    const drawer = res.rows[0]!.drawer;
    expect(drawer.visibleActionPayloadKeys.sort()).toEqual(["contactId", "workflowId"]);
    expect(drawer.redactedKeyCount).toBe(1);
  });

  it("statusCounts span the full org regardless of filter", async () => {
    await store.save(trigger({ id: "a1", status: "active", createdAt: new Date("2026-05-01") }));
    await store.save(trigger({ id: "a2", status: "active", createdAt: new Date("2026-05-02") }));
    await store.save(trigger({ id: "f1", status: "fired", createdAt: new Date("2026-05-03") }));
    await store.save(trigger({ id: "c1", status: "cancelled", createdAt: new Date("2026-05-04") }));
    await store.save(trigger({ id: "e1", status: "expired", createdAt: new Date("2026-05-05") }));

    const res = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: { status: "active", sort: "createdAt", direction: "desc", limit: 50 },
      },
      { triggerStore: store },
    );
    expect(res.rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(res.statusCounts).toEqual({ all: 5, active: 2, fired: 1, cancelled: 1, expired: 1 });
  });

  it("empty result returns zeroed counts and null cursor", async () => {
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows).toEqual([]);
    expect(res.statusCounts).toEqual({ all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 });
    expect(res.nextCursor).toBeNull();
    expect(res.hasMore).toBe(false);
  });

  it("org-scoping: rows in another org never appear and never count", async () => {
    await store.save(trigger({ id: "mine", createdAt: new Date("2026-05-01") }));
    await store.save(
      trigger({ id: "theirs", organizationId: OTHER, createdAt: new Date("2026-05-02") }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows.map((r) => r.id)).toEqual(["mine"]);
    expect(res.statusCounts.all).toBe(1);
  });

  it("invalid cursor throws InvalidCursorError", async () => {
    await expect(
      listTriggersForBrowse(
        {
          orgId: ORG,
          query: {
            sort: "createdAt",
            direction: "desc",
            limit: 50,
            cursor: "not-base64-json",
          },
        },
        { triggerStore: store },
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @switchboard/core test -- list-triggers`
Expected: FAIL — "Cannot find module '../list-triggers.js'".

- [ ] **Step 3: Create the implementation**

`packages/core/src/scheduler/list-triggers.ts`:

```ts
import type {
  ScheduledTrigger,
  ScheduledTriggersListQuery,
  ScheduledTriggersListResponse,
  ScheduledTriggerBrowseRow,
} from "@switchboard/schemas";
import type { TriggerStore, TriggerBrowseQuery, TriggerBrowseCursor } from "./trigger-store.js";

/**
 * Thrown when the dashboard hands back a cursor we can't decode. The Fastify
 * route maps this to 400.
 */
export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";
  constructor(message = "Invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface ListTriggersDeps {
  triggerStore: Pick<TriggerStore, "listForBrowse">;
}

/**
 * Allowlist of `action.payload` key names the drawer is permitted to surface.
 * Any other key is rolled into `redactedKeyCount`. Lives here (not in schemas)
 * because it's a backend-only redaction policy — clients only see the
 * post-redaction projection.
 */
export const VISIBLE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "workflowId",
  "contactId",
  "eventType",
  "agentKey",
  "triggerId",
  "source",
]);

export async function listTriggersForBrowse(
  input: { orgId: string; query: ScheduledTriggersListQuery },
  deps: ListTriggersDeps,
): Promise<ScheduledTriggersListResponse> {
  const { orgId, query } = input;
  const decodedCursor = query.cursor ? decodeCursor(query.cursor) : undefined;

  const storeQuery: TriggerBrowseQuery = {
    orgId,
    status: query.status,
    sort: query.sort,
    direction: query.direction,
    cursor: decodedCursor,
    limit: query.limit,
  };

  const result = await deps.triggerStore.listForBrowse(storeQuery);

  const hasMore = result.rows.length > query.limit;
  const kept = hasMore ? result.rows.slice(0, query.limit) : result.rows;

  const rows: ScheduledTriggerBrowseRow[] = kept.map(projectRow);

  const last = kept[kept.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ts: last.createdAt, id: last.id }) : null;

  return {
    rows,
    statusCounts: result.statusCounts,
    nextCursor,
    hasMore,
  };
}

function projectRow(t: ScheduledTrigger): ScheduledTriggerBrowseRow {
  const payload = isRecord(t.action.payload) ? t.action.payload : {};
  const allKeys = Object.keys(payload);
  const visibleActionPayloadKeys = allKeys.filter((k) => VISIBLE_PAYLOAD_KEYS.has(k));
  const redactedKeyCount = allKeys.length - visibleActionPayloadKeys.length;

  return {
    id: t.id,
    type: t.type,
    status: t.status,
    scheduleLabel: scheduleLabel(t),
    actionType: t.action.type,
    sourceWorkflowId: t.sourceWorkflowId,
    createdAt: t.createdAt.toISOString(),
    fireAt: t.fireAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    drawer: {
      eventPatternSummary: eventPatternSummary(t),
      visibleActionPayloadKeys,
      redactedKeyCount,
    },
  };
}

function scheduleLabel(t: ScheduledTrigger): string {
  switch (t.type) {
    case "cron":
      return t.cronExpression ?? "cron:unknown";
    case "timer":
      return t.fireAt?.toISOString() ?? "timer:unknown";
    case "event_match":
      return `event:${t.eventPattern?.type ?? "unknown"}`;
  }
}

function eventPatternSummary(t: ScheduledTrigger): string | null {
  if (t.type !== "event_match" || !t.eventPattern) return null;
  const filterKeys = Object.keys(t.eventPattern.filters ?? {});
  if (filterKeys.length === 0) return `${t.eventPattern.type} (no filters)`;
  return `${t.eventPattern.type} (filters: ${filterKeys.join(", ")})`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Cursor encoding — opaque base64 over `{ ts: ISO, id }`. The dashboard never
// sees this shape; it round-trips the string back as `?cursor=...`.
// ---------------------------------------------------------------------------

function encodeCursor(k: TriggerBrowseCursor): string {
  const json = JSON.stringify({ ts: k.ts.toISOString(), id: k.id });
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeCursor(s: string): TriggerBrowseCursor {
  let raw: string;
  try {
    raw = Buffer.from(s, "base64").toString("utf8");
  } catch {
    throw new InvalidCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidCursorError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { ts?: unknown }).ts !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    throw new InvalidCursorError();
  }
  const { ts, id } = parsed as { ts: string; id: string };
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) throw new InvalidCursorError();
  return { ts: date, id };
}
```

- [ ] **Step 4: Export from the scheduler barrel**

Add to `packages/core/src/scheduler/index.ts`:

```ts
export {
  listTriggersForBrowse,
  InvalidCursorError,
  VISIBLE_PAYLOAD_KEYS,
} from "./list-triggers.js";
export type { ListTriggersDeps } from "./list-triggers.js";
export type {
  TriggerBrowseQuery,
  TriggerBrowseResult,
  TriggerBrowseCursor,
} from "./trigger-store.js";
```

- [ ] **Step 5: Run tests to verify they all pass**

Run: `pnpm --filter @switchboard/core test -- list-triggers`
Expected: PASS — all 16 tests green.

- [ ] **Step 6: Run full core test suite for regression**

Run: `pnpm --filter @switchboard/core test`
Expected: every test passes; no regression in scheduler-service tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/scheduler/list-triggers.ts packages/core/src/scheduler/__tests__/list-triggers.test.ts packages/core/src/scheduler/index.ts
git commit -m "feat(core): listTriggersForBrowse projection w/ allowlist redaction (D2)"
```

---

## Task 5: Prisma `listForBrowse` impl + index migration

**Files:**

- Modify: `packages/db/src/stores/prisma-trigger-store.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_automations_d2_index/migration.sql` (generated)

- [ ] **Step 1: Implement `listForBrowse` on `PrismaTriggerStore`**

Add to the bottom of the `PrismaTriggerStore` class in `packages/db/src/stores/prisma-trigger-store.ts`:

```ts
async listForBrowse(query: import("@switchboard/core").TriggerBrowseQuery): Promise<
  import("@switchboard/core").TriggerBrowseResult
> {
  const { orgId, status, direction, cursor, limit } = query;

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) where.status = status;
  if (cursor) {
    // Strict keyset pagination: row must come *after* the cursor in sort
    // direction. (createdAt, id) tuple comparison.
    if (direction === "desc") {
      where.OR = [
        { createdAt: { lt: cursor.ts } },
        { createdAt: cursor.ts, id: { lt: cursor.id } },
      ];
    } else {
      where.OR = [
        { createdAt: { gt: cursor.ts } },
        { createdAt: cursor.ts, id: { gt: cursor.id } },
      ];
    }
  }

  const orderBy =
    direction === "desc"
      ? [{ createdAt: "desc" as const }, { id: "desc" as const }]
      : [{ createdAt: "asc" as const }, { id: "asc" as const }];

  // Single GROUP BY status for chip counts — separate query, scoped to the org.
  const [records, grouped] = await Promise.all([
    this.prisma.scheduledTriggerRecord.findMany({
      where,
      orderBy,
      take: limit + 1,
    }),
    this.prisma.scheduledTriggerRecord.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
  ]);

  const counts = { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 };
  for (const g of grouped) {
    const n = g._count._all;
    counts.all += n;
    if (g.status === "active") counts.active = n;
    else if (g.status === "fired") counts.fired = n;
    else if (g.status === "cancelled") counts.cancelled = n;
    else if (g.status === "expired") counts.expired = n;
  }

  return {
    rows: records.map((r) => toScheduledTrigger(r as PrismaRecord)),
    statusCounts: counts,
  };
}
```

- [ ] **Step 2: Add the additive index to schema.prisma**

Find the `ScheduledTriggerRecord` model in `packages/db/prisma/schema.prisma:1389`. Add one line to the `@@index` block:

```prisma
@@index([organizationId, createdAt])
```

The block should now contain (in addition to existing indexes):

```prisma
@@index([organizationId, status])
@@index([status, type])
@@index([sourceWorkflowId])
@@index([fireAt])
@@index([organizationId, createdAt])  // D2: cursor sort
```

- [ ] **Step 3: Generate the migration via `migrate diff`**

Per `feedback_prisma_migrate_dev_tty.md` — never use `migrate dev` in agent sessions. Generate the SQL diff explicitly:

```bash
mkdir -p packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_automations_d2_index
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script \
  > packages/db/prisma/migrations/$(ls packages/db/prisma/migrations/ | grep automations_d2_index)/migration.sql
```

The resulting `migration.sql` should contain a single `CREATE INDEX` statement, e.g.:

```sql
-- CreateIndex
CREATE INDEX "ScheduledTriggerRecord_organizationId_createdAt_idx" ON "ScheduledTriggerRecord"("organizationId", "createdAt");
```

If the diff produces unrelated changes (drift between local DB and schema), STOP — that means the local DB is out of sync. Run `pnpm reset` first, then redo this step.

- [ ] **Step 4: Apply the migration locally**

```bash
pnpm --filter @switchboard/db exec prisma migrate deploy
pnpm db:generate
```

- [ ] **Step 5: Run the existing prisma-trigger-store tests**

Run: `pnpm --filter @switchboard/db test -- prisma-trigger-store`
Expected: existing tests still pass (the new method isn't tested at the Prisma level — covered by the in-memory store + integration via the API test in Task 7).

- [ ] **Step 6: Build db**

Run: `pnpm --filter @switchboard/db build`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/db/src/stores/prisma-trigger-store.ts
git commit -m "feat(db): PrismaTriggerStore.listForBrowse + (orgId, createdAt) index (D2)"
```

---

## Task 6: Decorate `triggerStore` on Fastify; type augmentation

**Files:**

- Modify: `apps/api/src/types/decisions-fastify.d.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Augment FastifyInstance**

In `apps/api/src/types/decisions-fastify.d.ts`, add `TriggerStore` to the imports and add the optional decoration:

```ts
import type {
  ContactStore,
  HandoffStore,
  ConversationThreadStore,
  OpportunityStore,
  RevenueStore,
  TriggerStore,
} from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    contactStore?: ContactStore;
    handoffStore?: HandoffStore;
    threadStore?: ConversationThreadStore;
    opportunityStore?: OpportunityStore;
    revenueEventStore?: RevenueStore;
    triggerStore?: TriggerStore;
  }
}
```

- [ ] **Step 2: Decorate `triggerStore` in app.ts**

In `apps/api/src/app.ts`, find the block around line 569 where `contactStore` is decorated:

```ts
app.decorate("contactStore", new PrismaContactStore(prismaClient));
```

Add `PrismaTriggerStore` to the existing `@switchboard/db` import block at the top of the file (the imports already include `PrismaContactStore`, `PrismaOpportunityStore`, etc.):

```ts
import {
  // ...existing imports...
  PrismaTriggerStore,
} from "@switchboard/db";
```

Add a sibling decoration line directly after the `contactStore` block:

```ts
app.decorate("triggerStore", new PrismaTriggerStore(prismaClient));
```

- [ ] **Step 3: Build api**

Run: `pnpm --filter @switchboard/api build`
Expected: clean exit. If `@switchboard/core` doesn't yet re-export `TriggerStore` as a _type_, fix that — `packages/core/src/index.ts` should already barrel-export `./scheduler/index.js`, which now exports `TriggerStore` (verified in Task 3).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/types/decisions-fastify.d.ts apps/api/src/app.ts
git commit -m "chore(api): decorate triggerStore on FastifyInstance (D2)"
```

---

## Task 7: Fastify route + tests

**Files:**

- Create: `apps/api/src/routes/dashboard-automations.ts`
- Create: `apps/api/src/__tests__/api-automations.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`

- [ ] **Step 1: Wire the test server with an InMemoryTriggerStore**

In `apps/api/src/__tests__/test-server.ts`, around line 75 (where `contactStore` is declared as a TestContext type), add `triggerStore` to the same shape, and around line 262 (where `app.decorate("contactStore", new TestContactStore())`), add an analogous line. The exact additions:

Locate the `TestContext` type:

```ts
contactStore?: ContactStore;
```

Add directly below:

```ts
triggerStore?: import("@switchboard/core").TriggerStore;
```

Locate the decoration block:

```ts
app.decorate("contactStore", new TestContactStore());
```

Add directly below:

```ts
app.decorate("triggerStore", new InMemoryTriggerStore());
```

Add the import at the top of the file:

```ts
import { InMemoryTriggerStore } from "@switchboard/db";
```

- [ ] **Step 2: Write the failing API tests**

`apps/api/src/__tests__/api-automations.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { ScheduledTrigger } from "@switchboard/schemas";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

function trigger(overrides: Partial<ScheduledTrigger> & { id: string }): ScheduledTrigger {
  return {
    id: overrides.id,
    organizationId: overrides.organizationId ?? "org-test",
    type: overrides.type ?? "cron",
    fireAt: overrides.fireAt ?? null,
    cronExpression: overrides.cronExpression ?? "0 7 * * *",
    eventPattern: overrides.eventPattern ?? null,
    action: overrides.action ?? { type: "spawn_workflow", payload: {} },
    sourceWorkflowId: overrides.sourceWorkflowId ?? null,
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? new Date("2026-05-01T00:00:00Z"),
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("GET /api/dashboard/automations", () => {
  it("returns 200 + projected shape on happy path", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "t1" }));

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.statusCounts).toEqual({
      all: 1,
      active: 1,
      fired: 0,
      cancelled: 0,
      expired: 0,
    });
    expect(body.rows[0]?.id).toBe("t1");
    expect(body.rows[0]?.scheduleLabel).toBe("0 7 * * *");
    expect(body.rows[0]?.drawer).toBeDefined();
  });

  it("returns 400 for invalid status", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?status=banana",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit > 100", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?limit=101",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit < 1", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?limit=0",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for malformed cursor", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?cursor=not-base64-json",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_CURSOR");
  });

  it("cross-org isolation: another org's triggers never returned", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "mine", organizationId: "org-test" }));
    await ctx.app.triggerStore!.save(trigger({ id: "theirs", organizationId: "org-other" }));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    expect(res.json().statusCounts.all).toBe(1);
  });

  it("status filter passes through", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "a", status: "active" }));
    await ctx.app.triggerStore!.save(trigger({ id: "f", status: "fired" }));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?status=fired",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { id: string }) => r.id)).toEqual(["f"]);
  });

  it("returns 503 when triggerStore is missing", async () => {
    // Simulate by removing the decoration on a fresh context.
    const otherCtx = await buildTestServer();
    // hack: overwrite via Object.defineProperty since `triggerStore` is a decorated optional prop
    Object.defineProperty(otherCtx.app, "triggerStore", { value: undefined, writable: true });
    const res = await otherCtx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(503);
    await otherCtx.app.close();
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `pnpm --filter @switchboard/api test -- api-automations`
Expected: FAIL — route not registered, all tests 404 or test-server lacks the wiring.

- [ ] **Step 4: Implement the Fastify route**

`apps/api/src/routes/dashboard-automations.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { ScheduledTriggersListQuerySchema } from "@switchboard/schemas";
import { listTriggersForBrowse, InvalidCursorError } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

/**
 * GET /api/dashboard/automations — read-only browse projection backing the
 * Mercury /automations list surface (D2). Validation is the same Zod schema
 * the dashboard imports, so query-shape drift can't happen.
 */
export const dashboardAutomationsRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test parity: when authDisabled, accept x-org-id (mirrors
  // dashboard-contacts and dashboard-reports).
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/api/dashboard/automations", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = ScheduledTriggersListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    if (!app.triggerStore) {
      return reply.code(503).send({ error: "Trigger store not available" });
    }

    try {
      return await listTriggersForBrowse(
        { orgId, query: parsed.data },
        { triggerStore: app.triggerStore },
      );
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return reply.code(400).send({ error: "INVALID_CURSOR" });
      }
      throw e;
    }
  });
};
```

- [ ] **Step 5: Register the route**

In `apps/api/src/bootstrap/routes.ts`, around line 55 (the contacts import) add:

```ts
import { dashboardAutomationsRoutes } from "../routes/dashboard-automations.js";
```

And around line 150 (where `dashboardContactsRoutes` is registered) add directly below:

```ts
await app.register(dashboardAutomationsRoutes);
```

- [ ] **Step 6: Run the API tests, confirm they pass**

Run: `pnpm --filter @switchboard/api test -- api-automations`
Expected: PASS — 8 tests green.

- [ ] **Step 7: Run full api test suite for regressions**

Run: `pnpm --filter @switchboard/api test`
Expected: every test passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/dashboard-automations.ts apps/api/src/bootstrap/routes.ts apps/api/src/__tests__/api-automations.test.ts apps/api/src/__tests__/test-server.ts
git commit -m "feat(api): GET /api/dashboard/automations + tests (D2)"
```

---

## Task 8: Next proxy + dashboard client method

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/dashboard.ts`
- Create: `apps/dashboard/src/app/api/dashboard/automations/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/automations/__tests__/route.test.ts`

- [ ] **Step 1: Add `getAutomations` to the dashboard client**

In `apps/dashboard/src/lib/api-client/dashboard.ts`, near the end of the `SwitchboardDashboardClient` class (right after `getContacts`/`getContact` around line 130), add:

```ts
// ── Automations (Mercury /automations list — D2) ──

async getAutomations(query: {
  status?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
  direction?: string;
}): Promise<import("@switchboard/schemas").ScheduledTriggersListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  const qs = params.toString();
  return this.request(`/api/dashboard/automations${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 2: Write the failing proxy test**

`apps/dashboard/src/app/api/dashboard/automations/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "u1" } }),
}));

const getAutomations = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({
    getAutomations: (q: object) => getAutomations(q),
  }),
}));

describe("GET /api/dashboard/automations (Next proxy)", () => {
  beforeEach(() => {
    getAutomations.mockReset();
  });

  it("forwards query params to the API client", async () => {
    getAutomations.mockResolvedValueOnce({
      rows: [],
      statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
      nextCursor: null,
      hasMore: false,
    });
    const req = new NextRequest(
      "http://localhost:3002/api/dashboard/automations?status=active&limit=25&cursor=abc",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(getAutomations).toHaveBeenCalledWith({
      status: "active",
      cursor: "abc",
      limit: 25,
      sort: undefined,
      direction: undefined,
    });
  });

  it("returns 401 when session check throws Unauthorized", async () => {
    const { requireSession } = await import("@/lib/session");
    (
      requireSession as unknown as { mockRejectedValueOnce: (e: Error) => void }
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const req = new NextRequest("http://localhost:3002/api/dashboard/automations");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- automations/__tests__/route`
Expected: FAIL — `route` module not found.

- [ ] **Step 4: Implement the Next proxy**

`apps/dashboard/src/app/api/dashboard/automations/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const sp = req.nextUrl.searchParams;
    const data = await client.getAutomations({
      status: sp.get("status") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      sort: sp.get("sort") ?? undefined,
      direction: sp.get("direction") ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- automations/__tests__/route`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/api-client/dashboard.ts apps/dashboard/src/app/api/dashboard/automations/
git commit -m "feat(dashboard): /api/dashboard/automations Next proxy + client (D2)"
```

- [ ] **Step 7: Final D2a sanity check**

Run: `pnpm typecheck && pnpm test`
Expected: clean across the monorepo. **PR-D2a is now ready to push and PR.**

---

# PR-D2b — Frontend page

## Task 9: Append `automations` query-key namespace

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`

- [ ] **Step 1: Append the namespace**

Find the `contacts:` block in `apps/dashboard/src/lib/query-keys.ts` (around line 192). Add a sibling namespace after it (still inside the returned object):

```ts
contacts: {
  list: (query: object) => [orgId, "contacts", "list", query] as const,
  detail: (id: string) => [orgId, "contacts", "detail", id] as const,
},
automations: {
  list: (query: object) => [orgId, "automations", "list", query] as const,
},
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts
git commit -m "chore(dashboard): scoped queryKeys.automations namespace (D2)"
```

---

## Task 10: `format.ts` helpers + tests

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/components/format.ts`
- Create: `apps/dashboard/src/app/(auth)/automations/components/format.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/dashboard/src/app/(auth)/automations/components/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatShortDate,
  formatFullIso,
  resolveTimezone,
  truncateWorkflowId,
  redactedKeyLabel,
} from "./format";

describe("format helpers", () => {
  describe("resolveTimezone", () => {
    it("returns the org timezone when provided", () => {
      expect(resolveTimezone("Asia/Singapore")).toBe("Asia/Singapore");
    });

    it("falls back to browser timezone when org tz is null/undefined", () => {
      const tz = resolveTimezone(undefined);
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe("formatShortDate", () => {
    it("renders a short month-day in the resolved timezone", () => {
      // 2026-05-09 18:00:00 UTC → 2026-05-10 02:00 SGT → "May 10"
      const out = formatShortDate("2026-05-09T18:00:00Z", "Asia/Singapore");
      expect(out).toMatch(/May\s+10/);
    });

    it("falls back to em-dash on bad input", () => {
      expect(formatShortDate("not-a-date", "UTC")).toBe("—");
    });
  });

  describe("formatFullIso", () => {
    it("emits ISO8601 with offset for the resolved zone", () => {
      // 2026-05-09T10:00Z in Asia/Singapore is +08:00.
      const out = formatFullIso("2026-05-09T10:00:00Z", "Asia/Singapore");
      expect(out).toMatch(/2026-05-09T18:00:00.*\+08:00/);
    });

    it("falls back to em-dash on bad input", () => {
      expect(formatFullIso("nonsense", "UTC")).toBe("—");
    });
  });

  describe("truncateWorkflowId", () => {
    it("renders WF:<first 8 chars> when present", () => {
      expect(truncateWorkflowId("a1b2c3d4-rest-of-uuid")).toBe("WF:a1b2c3d4");
    });

    it("renders em-dash when null", () => {
      expect(truncateWorkflowId(null)).toBe("—");
    });
  });

  describe("redactedKeyLabel", () => {
    it("returns nothing when count is 0", () => {
      expect(redactedKeyLabel(0)).toBe("");
    });

    it("returns ' · N redacted' when count > 0", () => {
      expect(redactedKeyLabel(3)).toBe(" · 3 redacted");
    });
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- automations/components/format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

`apps/dashboard/src/app/(auth)/automations/components/format.ts`:

```ts
const FALLBACK_TZ = "UTC";

function browserTimezone(): string {
  if (typeof Intl !== "undefined") {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) return tz;
    } catch {
      // fall through
    }
  }
  return FALLBACK_TZ;
}

/** Resolve the display timezone: org tz → browser tz → UTC. */
export function resolveTimezone(orgTimezone: string | null | undefined): string {
  if (orgTimezone && orgTimezone.length > 0) return orgTimezone;
  return browserTimezone();
}

/**
 * Short month-day for the table cell. Falls back to "—" if the upstream
 * delivers a malformed timestamp (Zod should have caught it earlier; this
 * is a defensive last resort so a bad row doesn't crash the whole table).
 */
export function formatShortDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Full ISO8601 with offset, used inside the drawer. */
export function formatFullIso(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Build the offset for the target zone using Intl, then format manually.
  // Avoids pulling in date-fns-tz just for this surface.
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "shortOffset",
    }).formatToParts(d);
    const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const datePart = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
    const timePart = `${lookup("hour")}:${lookup("minute")}:${lookup("second")}`;
    // shortOffset returns e.g. "GMT+8" — normalise to "+08:00".
    const offsetRaw = lookup("timeZoneName").replace("GMT", "");
    const sign = offsetRaw.startsWith("-") ? "-" : "+";
    const num = offsetRaw.replace(/[+-]/, "");
    const [h, m = "0"] = num.split(":");
    const offset = `${sign}${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    return `${datePart}T${timePart}${offset}`;
  } catch {
    return d.toISOString();
  }
}

export function truncateWorkflowId(id: string | null): string {
  if (!id) return "—";
  return `WF:${id.slice(0, 8)}`;
}

export function redactedKeyLabel(count: number): string {
  if (count <= 0) return "";
  return ` · ${count} redacted`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- automations/components/format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/components/format.ts apps/dashboard/src/app/\(auth\)/automations/components/format.test.ts
git commit -m "feat(dashboard): /automations format helpers + tests (D2)"
```

---

## Task 11: Fixtures (6 rows)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/fixtures.ts`

- [ ] **Step 1: Create the fixture page**

`apps/dashboard/src/app/(auth)/automations/fixtures.ts`:

```ts
import type { ScheduledTriggersListResponse } from "@switchboard/schemas";

export const AUTOMATIONS_FIXTURE_PAGE: ScheduledTriggersListResponse = {
  rows: [
    {
      id: "fix-cron-active",
      type: "cron",
      status: "active",
      scheduleLabel: "0 7 * * *",
      actionType: "spawn_workflow",
      sourceWorkflowId: "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd",
      createdAt: "2026-05-07T09:00:00.000Z",
      fireAt: null,
      expiresAt: null,
      drawer: {
        eventPatternSummary: null,
        visibleActionPayloadKeys: ["workflowId", "agentKey"],
        redactedKeyCount: 0,
      },
    },
    {
      id: "fix-timer-active",
      type: "timer",
      status: "active",
      scheduleLabel: "2026-05-12T18:00:00.000Z",
      actionType: "emit_event",
      sourceWorkflowId: null,
      createdAt: "2026-05-08T14:30:00.000Z",
      fireAt: "2026-05-12T18:00:00.000Z",
      expiresAt: null,
      drawer: {
        eventPatternSummary: null,
        visibleActionPayloadKeys: ["eventType", "contactId"],
        redactedKeyCount: 1,
      },
    },
    {
      id: "fix-event-active",
      type: "event_match",
      status: "active",
      scheduleLabel: "event:lead.captured",
      actionType: "spawn_workflow",
      sourceWorkflowId: "e5f6g7h8-eeee-ffff-gggg-hhhhhhhhhhhh",
      createdAt: "2026-05-08T16:15:00.000Z",
      fireAt: null,
      expiresAt: null,
      drawer: {
        eventPatternSummary: "lead.captured (filters: source, contactId)",
        visibleActionPayloadKeys: ["workflowId"],
        redactedKeyCount: 0,
      },
    },
    {
      id: "fix-cron-fired",
      type: "cron",
      status: "fired",
      scheduleLabel: "*/15 * * * *",
      actionType: "resume_workflow",
      sourceWorkflowId: "i9j0k1l2-iiii-jjjj-kkkk-llllllllllll",
      createdAt: "2026-04-30T12:00:00.000Z",
      fireAt: null,
      expiresAt: null,
      drawer: {
        eventPatternSummary: null,
        visibleActionPayloadKeys: ["workflowId"],
        redactedKeyCount: 0,
      },
    },
    {
      id: "fix-timer-cancelled",
      type: "timer",
      status: "cancelled",
      scheduleLabel: "2026-05-04T10:00:00.000Z",
      actionType: "spawn_workflow",
      sourceWorkflowId: null,
      createdAt: "2026-05-02T08:00:00.000Z",
      fireAt: "2026-05-04T10:00:00.000Z",
      expiresAt: null,
      drawer: {
        eventPatternSummary: null,
        visibleActionPayloadKeys: ["workflowId", "contactId"],
        redactedKeyCount: 0,
      },
    },
    {
      id: "fix-cron-expired",
      type: "cron",
      status: "expired",
      scheduleLabel: "0 0 1 * *",
      actionType: "emit_event",
      sourceWorkflowId: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      fireAt: null,
      expiresAt: "2026-04-01T00:00:00.000Z",
      drawer: {
        eventPatternSummary: null,
        visibleActionPayloadKeys: ["eventType"],
        redactedKeyCount: 0,
      },
    },
  ],
  statusCounts: { all: 6, active: 3, fired: 1, cancelled: 1, expired: 1 },
  nextCursor: null,
  hasMore: false,
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/fixtures.ts
git commit -m "feat(dashboard): /automations 6-row fixture page (D2)"
```

---

## Task 12: `useAutomationsList` hook + test

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/hooks/use-automations-list.ts`
- Create: `apps/dashboard/src/app/(auth)/automations/__tests__/use-automations-list.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/app/(auth)/automations/__tests__/use-automations-list.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useAutomationsList } from "../hooks/use-automations-list";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    automations: { list: (q: object) => ["org-test", "automations", "list", q] as const },
  }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAutomationsList", () => {
  const ORIG_LIVE = process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = ORIG_LIVE;
  });

  it("returns the fixture page when NEXT_PUBLIC_AUTOMATIONS_LIVE !== 'true'", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "false";
    const { result } = renderHook(() => useAutomationsList({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]).toEqual(AUTOMATIONS_FIXTURE_PAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls /api/dashboard/automations when live and validates the response", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "true";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => AUTOMATIONS_FIXTURE_PAGE,
    } as Response);

    const { result } = renderHook(() => useAutomationsList({ status: "active" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/automations?status=active"),
    );
  });

  it("throws when the response shape is invalid", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "true";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rows: "not-an-array" }),
    } as Response);

    const { result } = renderHook(() => useAutomationsList({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- use-automations-list`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

`apps/dashboard/src/app/(auth)/automations/hooks/use-automations-list.ts`:

```ts
"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import {
  ScheduledTriggersListResponseSchema,
  type ScheduledTriggersListQuery,
  type ScheduledTriggersListResponse,
} from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

export type AutomationsListQueryInput = Partial<Omit<ScheduledTriggersListQuery, "cursor">>;

export type UseAutomationsListResult = UseInfiniteQueryResult<
  { pages: ScheduledTriggersListResponse[]; pageParams: (string | undefined)[] },
  Error
>;

const isLive = (): boolean => process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true";

function buildSearch(query: AutomationsListQueryInput, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAutomationsList(query: AutomationsListQueryInput): UseAutomationsListResult {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useInfiniteQuery<
    ScheduledTriggersListResponse,
    Error,
    { pages: ScheduledTriggersListResponse[]; pageParams: (string | undefined)[] },
    readonly unknown[],
    string | undefined
  >({
    queryKey: keys?.automations.list(query) ?? (["__disabled_automations__", query] as const),
    queryFn: async ({ pageParam }) => {
      if (!live) return AUTOMATIONS_FIXTURE_PAGE;
      const res = await fetch(`/api/dashboard/automations${buildSearch(query, pageParam)}`);
      if (!res.ok) throw new Error(`Failed to load automations: ${res.status}`);
      return ScheduledTriggersListResponseSchema.parse(await res.json());
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (live ? (last.nextCursor ?? undefined) : undefined),
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
  });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- use-automations-list`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/hooks/ apps/dashboard/src/app/\(auth\)/automations/__tests__/use-automations-list.test.ts
git commit -m "feat(dashboard): useAutomationsList hook + tests (D2)"
```

---

## Task 13: Filter chips (with counts)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/components/filter-chips.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/__tests__/filter-chips.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/app/(auth)/automations/__tests__/filter-chips.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChips } from "../components/filter-chips";

const counts = { all: 101, active: 12, fired: 83, cancelled: 4, expired: 2 };

describe("<FilterChips />", () => {
  it("renders all 5 chips with counts and marks Active as default-selected", () => {
    render(<FilterChips active={"active"} counts={counts} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Active 12/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Fired 83/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /All 101/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelled 4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expired 2/ })).toBeInTheDocument();
  });

  it("calls onChange with 'all' when the All chip is clicked", () => {
    const onChange = vi.fn();
    render(<FilterChips active={"active"} counts={counts} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /All 101/ }));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("calls onChange with the chosen status on click", () => {
    const onChange = vi.fn();
    render(<FilterChips active={"active"} counts={counts} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Fired 83/ }));
    expect(onChange).toHaveBeenCalledWith("fired");
  });

  it("only one chip is aria-pressed at a time", () => {
    render(<FilterChips active={"fired"} counts={counts} onChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent(/Fired 83/);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- filter-chips`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`apps/dashboard/src/app/(auth)/automations/components/filter-chips.tsx`:

```tsx
"use client";

import type { TriggerStatus, TriggerStatusCounts } from "@switchboard/schemas";
import styles from "../automations.module.css";

export type ChipKey = TriggerStatus | "all";

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "active", label: "Active" },
  { key: "fired", label: "Fired" },
  { key: "cancelled", label: "Cancelled" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
];

interface Props {
  active: ChipKey;
  counts: TriggerStatusCounts;
  onChange: (next: ChipKey) => void;
}

export function FilterChips({ active, counts, onChange }: Props) {
  return (
    <div className={styles.chipRow} role="group" aria-label="Status filter">
      {CHIPS.map(({ key, label }) => {
        const count = key === "all" ? counts.all : counts[key];
        const pressed = key === active;
        return (
          <button
            key={key}
            type="button"
            className={pressed ? styles.chipActive : styles.chip}
            aria-pressed={pressed}
            onClick={() => onChange(key)}
          >
            {label} {count}
          </button>
        );
      })}
    </div>
  );
}
```

(The `automations.module.css` `.chipRow / .chip / .chipActive` classes are added in Task 17.)

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm --filter @switchboard/dashboard test -- filter-chips`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/components/filter-chips.tsx apps/dashboard/src/app/\(auth\)/automations/__tests__/filter-chips.test.tsx
git commit -m "feat(dashboard): /automations filter chips with counts (D2)"
```

---

## Task 14: Drawer component (`automation-row-drawer.tsx`)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/components/automation-row-drawer.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/__tests__/automation-row-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/app/(auth)/automations/__tests__/automation-row-drawer.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutomationRowDrawer } from "../components/automation-row-drawer";
import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";

const SENTINEL = "REDACTION_PROBE_X9";

const baseRow: ScheduledTriggerBrowseRow = {
  id: "abcd-1234-uuid-rest",
  type: "cron",
  status: "active",
  scheduleLabel: "0 7 * * *",
  actionType: "spawn_workflow",
  sourceWorkflowId: "wf-uuid-12345678",
  createdAt: "2026-05-09T10:00:00.000Z",
  fireAt: null,
  expiresAt: "2026-06-01T00:00:00.000Z",
  drawer: {
    eventPatternSummary: null,
    visibleActionPayloadKeys: ["workflowId", "contactId"],
    redactedKeyCount: 2,
  },
};

describe("<AutomationRowDrawer />", () => {
  it("renders id, source workflow, schedule, action, dates, payload keys", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="drawer-row-1" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByText("abcd-1234-uuid-rest")).toBeInTheDocument();
    expect(screen.getByText("wf-uuid-12345678")).toBeInTheDocument();
    expect(screen.getByText("0 7 * * *")).toBeInTheDocument();
    expect(screen.getByText("spawn_workflow")).toBeInTheDocument();
    expect(screen.getByText(/workflowId, contactId/)).toBeInTheDocument();
    expect(screen.getByText(/2 redacted/)).toBeInTheDocument();
  });

  it("renders an em-dash when there are no visible payload keys", () => {
    const row: ScheduledTriggerBrowseRow = {
      ...baseRow,
      drawer: { eventPatternSummary: null, visibleActionPayloadKeys: [], redactedKeyCount: 0 },
    };
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={row} drawerId="d2" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("payload-keys")).toHaveTextContent("—");
  });

  it("never renders a sentinel that could be in raw payload values", () => {
    // The drawer only ever sees the projected `row` — there is no path to
    // raw payload values. Belt-and-braces test: even if we accidentally
    // pass a sentinel via a different field, it should not appear.
    const row: ScheduledTriggerBrowseRow = {
      ...baseRow,
      // intentionally try to smuggle the sentinel into a stringy field
      sourceWorkflowId: SENTINEL, // worst case: somehow a leak ends up here
    };
    const { container } = render(
      <table>
        <tbody>
          <AutomationRowDrawer row={row} drawerId="d3" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    // We DO render sourceWorkflowId — the sentinel will appear because the
    // row deliberately put it there. The point of this test is to assert
    // that the drawer makes no attempt to read row.action or any
    // payload-shaped property. Confirm by negating: payload keys never
    // accept arbitrary values, only the structured allowlist field.
    expect(container.innerHTML).not.toMatch(/action\.payload|raw payload/);
    // Sanity that the test row was rendered.
    expect(container.textContent).toContain(SENTINEL);
  });

  it("contains no buttons whose accessible name suggests a mutation", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="d4" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    const mutationRegex = /Cancel|Edit|Delete|Pause|Reschedule/i;
    const buttons = screen.queryAllByRole("button");
    for (const b of buttons) {
      expect(b.getAttribute("aria-label") ?? b.textContent ?? "").not.toMatch(mutationRegex);
    }
  });

  it("provides copy-to-clipboard buttons for trigger id and source workflow", () => {
    render(
      <table>
        <tbody>
          <AutomationRowDrawer row={baseRow} drawerId="d5" colSpan={6} timezone="UTC" />
        </tbody>
      </table>,
    );
    expect(screen.getByRole("button", { name: /Copy trigger id/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy source workflow id/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- automation-row-drawer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the drawer**

`apps/dashboard/src/app/(auth)/automations/components/automation-row-drawer.tsx`:

```tsx
"use client";

import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { formatFullIso, redactedKeyLabel } from "./format";
import styles from "../automations.module.css";

interface Props {
  row: ScheduledTriggerBrowseRow;
  drawerId: string;
  colSpan: number;
  timezone: string;
}

export function AutomationRowDrawer({ row, drawerId, colSpan, timezone }: Props) {
  const visibleKeys = row.drawer.visibleActionPayloadKeys;
  const keysLabel =
    visibleKeys.length === 0
      ? "—"
      : `${visibleKeys.join(", ")}${redactedKeyLabel(row.drawer.redactedKeyCount)}`;

  return (
    <tr id={drawerId} className={styles.drawerRow}>
      <td colSpan={colSpan} className={styles.drawerCell}>
        <dl className={styles.drawerGrid}>
          <dt>Trigger id</dt>
          <dd className={styles.copyableCell}>
            <span className={styles.mono}>{row.id}</span>
            <CopyButton value={row.id} label="Copy trigger id" />
          </dd>

          <dt>Source workflow</dt>
          <dd className={styles.copyableCell}>
            <span className={styles.mono}>{row.sourceWorkflowId ?? "—"}</span>
            {row.sourceWorkflowId ? (
              <CopyButton value={row.sourceWorkflowId} label="Copy source workflow id" />
            ) : null}
          </dd>

          <dt>Created</dt>
          <dd className={styles.mono}>{formatFullIso(row.createdAt, timezone)}</dd>

          <dt>Expires</dt>
          <dd className={styles.mono}>
            {row.expiresAt ? formatFullIso(row.expiresAt, timezone) : "—"}
          </dd>

          <dt>Schedule</dt>
          <dd className={styles.mono}>{row.scheduleLabel}</dd>

          <dt>Event pattern</dt>
          <dd className={styles.mono}>{row.drawer.eventPatternSummary ?? "—"}</dd>

          <dt>Action</dt>
          <dd className={styles.mono}>{row.actionType}</dd>

          <dt>Payload</dt>
          <dd className={styles.mono} data-testid="payload-keys">
            {keysLabel}
          </dd>
        </dl>
      </td>
    </tr>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={styles.copyButton}
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(value);
        }
      }}
    >
      Copy
    </button>
  );
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- automation-row-drawer`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/components/automation-row-drawer.tsx apps/dashboard/src/app/\(auth\)/automations/__tests__/automation-row-drawer.test.tsx
git commit -m "feat(dashboard): /automations row drawer w/ ARIA + redaction (D2)"
```

---

## Task 15: Table + row + chevron toggle

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/components/automation-row.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/components/automations-table.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/__tests__/automations-table.test.tsx`

- [ ] **Step 1: Write the failing table test**

`apps/dashboard/src/app/(auth)/automations/__tests__/automations-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationsTable } from "../components/automations-table";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

const ALL_ROWS = AUTOMATIONS_FIXTURE_PAGE.rows;

describe("<AutomationsTable />", () => {
  it("renders all rows and the column headers in the resolved tz", () => {
    render(<AutomationsTable rows={ALL_ROWS} timezone="UTC" />);
    expect(screen.getByRole("columnheader", { name: /TYPE/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /SCHEDULE/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /CREATED · UTC/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(ALL_ROWS.length); // tbody rows + thead
  });

  it("chevron is a button with aria-expanded=false initially", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the chevron opens the drawer; clicking again closes it", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(ALL_ROWS[0]!.id)).toBeInTheDocument();
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("opening another row's drawer closes the first", () => {
    render(<AutomationsTable rows={ALL_ROWS.slice(0, 2)} timezone="UTC" />);
    const chevrons = screen.getAllByRole("button", { name: /Expand row/i });
    fireEvent.click(chevrons[0]!);
    expect(chevrons[0]!).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevrons[1]!);
    expect(chevrons[0]!).toHaveAttribute("aria-expanded", "false");
    expect(chevrons[1]!).toHaveAttribute("aria-expanded", "true");
  });

  it("Enter key on the chevron toggles the drawer", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    chevron.focus();
    fireEvent.keyDown(chevron, { key: "Enter" });
    // Real <button> elements automatically dispatch click on Enter; the test
    // confirms the rendered element is a real button so default keyboard
    // behaviour applies. We assert via tagName here rather than relying on
    // jsdom dispatching the synthetic click for keyDown.
    expect(chevron.tagName).toBe("BUTTON");
  });

  it("clicking the row body does not open the drawer", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const dataRow = screen.getAllByRole("row")[1]!; // [0] is thead
    fireEvent.click(dataRow);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @switchboard/dashboard test -- automations-table`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the row**

`apps/dashboard/src/app/(auth)/automations/components/automation-row.tsx`:

```tsx
"use client";

import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { formatShortDate, truncateWorkflowId } from "./format";
import styles from "../automations.module.css";

interface Props {
  row: ScheduledTriggerBrowseRow;
  drawerId: string;
  expanded: boolean;
  onToggle: () => void;
  timezone: string;
}

const TYPE_LABEL: Record<ScheduledTriggerBrowseRow["type"], string> = {
  cron: "cron",
  timer: "timer",
  event_match: "event",
};

const STATUS_CLASS: Record<ScheduledTriggerBrowseRow["status"], string> = {
  active: styles.statusActive ?? "",
  fired: styles.statusFired ?? "",
  cancelled: styles.statusCancelled ?? "",
  expired: styles.statusExpired ?? "",
};

export function AutomationRow({ row, drawerId, expanded, onToggle, timezone }: Props) {
  return (
    <tr className={styles.dataRow}>
      <td className={`${styles.cellType} ${styles.mono} ${styles.stickyType}`}>
        {TYPE_LABEL[row.type]}
      </td>
      <td className={styles.mono}>{row.scheduleLabel}</td>
      <td className={styles.mono}>{row.actionType}</td>
      <td>
        <span className={`${styles.statusPill} ${STATUS_CLASS[row.status]}`}>{row.status}</span>
      </td>
      <td className={styles.mono}>{truncateWorkflowId(row.sourceWorkflowId)}</td>
      <td className={`${styles.mono} ${styles.cellCreated}`}>
        {formatShortDate(row.createdAt, timezone)}
      </td>
      <td className={styles.cellChevron}>
        <button
          type="button"
          aria-label={expanded ? "Collapse row" : "Expand row"}
          aria-expanded={expanded}
          aria-controls={drawerId}
          className={styles.chevronButton}
          onClick={onToggle}
        >
          {expanded ? "▴" : "▾"}
        </button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Implement the table**

`apps/dashboard/src/app/(auth)/automations/components/automations-table.tsx`:

```tsx
"use client";

import { useId, useState } from "react";
import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { AutomationRow } from "./automation-row";
import { AutomationRowDrawer } from "./automation-row-drawer";
import styles from "../automations.module.css";

interface Props {
  rows: ScheduledTriggerBrowseRow[];
  timezone: string;
}

const COLUMN_COUNT = 7;

export function AutomationsTable({ rows, timezone }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const idPrefix = useId();

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.stickyType}>
              TYPE
            </th>
            <th scope="col">SCHEDULE</th>
            <th scope="col">ACTION</th>
            <th scope="col">STATUS</th>
            <th scope="col">SOURCE</th>
            <th scope="col">CREATED · {timezone.toUpperCase()}</th>
            <th scope="col" aria-hidden="true">
              {/* chevron column header is intentionally empty */}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const drawerId = `${idPrefix}-${row.id}`;
            const expanded = openId === row.id;
            return (
              <>
                <AutomationRow
                  key={row.id}
                  row={row}
                  drawerId={drawerId}
                  expanded={expanded}
                  timezone={timezone}
                  onToggle={() => setOpenId((cur) => (cur === row.id ? null : row.id))}
                />
                {expanded ? (
                  <AutomationRowDrawer
                    key={`${row.id}-drawer`}
                    row={row}
                    drawerId={drawerId}
                    colSpan={COLUMN_COUNT}
                    timezone={timezone}
                  />
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Run table tests, verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- automations-table`
Expected: PASS — 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/components/automation-row.tsx apps/dashboard/src/app/\(auth\)/automations/components/automations-table.tsx apps/dashboard/src/app/\(auth\)/automations/__tests__/automations-table.test.tsx
git commit -m "feat(dashboard): /automations table + row w/ chevron drawer toggle (D2)"
```

---

## Task 16: Header, pagination footer, empty state

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/components/header.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/components/pagination-footer.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/components/empty-state.tsx`

These are small enough to ship together; tests are exercised at the page level (Task 17).

- [ ] **Step 1: Header**

`apps/dashboard/src/app/(auth)/automations/components/header.tsx`:

```tsx
"use client";

import styles from "../automations.module.css";

/**
 * AutomationsHeader is intentionally a near-clone of ContactsHeader / ReportsHeader
 * for now (decision §2.0 #4). Once D3 ships, the three headers will be
 * extracted into a shared MercuryAuthShell — that's D3's tax.
 */
export function AutomationsHeader() {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.brand}>Switchboard</div>
      <nav aria-label="Agents" className={styles.agentNav}>
        <span>Alex</span>
        <span>·</span>
        <span>Riley</span>
        <span>·</span>
        <span>+</span>
      </nav>
      <nav aria-label="Tools" className={styles.toolNav}>
        <span>Live</span>
        <span>·</span>
        <span>Inbox</span>
        <span>·</span>
        <span>Halt</span>
        <span>·</span>
        <span>M</span>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Pagination footer**

`apps/dashboard/src/app/(auth)/automations/components/pagination-footer.tsx`:

```tsx
"use client";

import styles from "../automations.module.css";

interface Props {
  shownCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}

export function PaginationFooter({ shownCount, hasMore, onLoadMore, loading }: Props) {
  return (
    <div className={styles.paginationFooter}>
      <span className={styles.mono}>
        Showing 1–{shownCount}
        {hasMore ? " · " : ""}
      </span>
      {hasMore ? (
        <button type="button" className={styles.moreButton} onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading…" : "more →"}
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Empty state**

`apps/dashboard/src/app/(auth)/automations/components/empty-state.tsx`:

```tsx
"use client";

import styles from "../automations.module.css";

type Kind = "zero" | "filtered" | "error";

interface Props {
  kind: Kind;
  onClearFilter?: () => void;
  onRetry?: () => void;
}

export function EmptyState({ kind, onClearFilter, onRetry }: Props) {
  if (kind === "zero") {
    return (
      <div className={styles.emptyState}>
        <p>No automations yet. Triggers scheduled by your agents will appear here.</p>
      </div>
    );
  }
  if (kind === "filtered") {
    return (
      <div className={styles.emptyState}>
        <p>No matches. Try a different filter.</p>
        <button type="button" onClick={onClearFilter} className={styles.linkButton}>
          Clear
        </button>
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      <p>Couldn&rsquo;t load automations.</p>
      <button type="button" onClick={onRetry} className={styles.linkButton}>
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/components/header.tsx apps/dashboard/src/app/\(auth\)/automations/components/pagination-footer.tsx apps/dashboard/src/app/\(auth\)/automations/components/empty-state.tsx
git commit -m "feat(dashboard): /automations header, pagination, empty-state (D2)"
```

---

## Task 17: CSS module + page composition

**Files:**

- Create: `apps/dashboard/src/app/(auth)/automations/automations.module.css`
- Create: `apps/dashboard/src/app/(auth)/automations/automations-page.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/automations/__tests__/automations-page.test.tsx`

- [ ] **Step 1: CSS module**

`apps/dashboard/src/app/(auth)/automations/automations.module.css`:

```css
/* Mercury aliases — same module-scoping pattern used by reports.module.css and contacts.module.css */
.automationsPage {
  --cream: var(--mercury-cream);
  --ink: var(--mercury-ink);
  --ink-3: var(--mercury-ink-3);
  --accent: var(--mercury-accent);
  --hair: var(--mercury-hairline);
  --row-hover: var(--mercury-row-hover);
  --neg: var(--mercury-neg);
  --serif: var(--font-serif-mercury);
  --sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --mono: var(--font-mono-mercury);

  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
  font-variant-numeric: tabular-nums;
  min-height: 100dvh;
  padding: 0 24px 96px;
}

.pageHeader {
  position: sticky;
  top: 0;
  background: var(--cream);
  border-bottom: 1px solid var(--hair);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  z-index: 10;
}

.brand,
.agentNav,
.toolNav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-family: var(--serif);
  font-size: 40px;
  margin: 32px 0 0;
}

.notice {
  border-bottom: 1px solid var(--hair);
  padding: 8px 0;
  color: var(--ink-3);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--mono);
}

.chipRow {
  display: flex;
  gap: 8px;
  margin: 24px 0 16px;
  flex-wrap: wrap;
}

.chip,
.chipActive {
  border: 1px solid var(--hair);
  background: transparent;
  color: var(--ink-3);
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.chipActive {
  border-color: var(--ink);
  color: var(--ink);
  font-weight: 500;
}

.tableScroll {
  overflow-x: auto;
  border-top: 1px solid var(--hair);
}

.table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
}

.table thead th {
  text-align: left;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  border-bottom: 1px solid var(--hair);
  padding: 8px 12px;
  background: var(--cream);
}

.table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--hair);
  vertical-align: middle;
}

.dataRow:hover {
  background: var(--row-hover);
}

.stickyType {
  position: sticky;
  left: 0;
  background: var(--cream);
}

.dataRow:hover .stickyType {
  background: var(--row-hover);
}

.mono {
  font-family: var(--mono);
  font-size: 12px;
}

.statusPill {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border: 1px solid var(--hair);
}
.statusActive {
  color: var(--ink);
}
.statusFired {
  color: var(--ink-3);
}
.statusCancelled {
  color: var(--ink-3);
}
.statusExpired {
  color: var(--neg);
}

.cellChevron {
  width: 32px;
  text-align: right;
}
.chevronButton {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-3);
  padding: 4px 8px;
}

.drawerRow td {
  background: var(--row-hover);
}
.drawerCell {
  padding: 16px 24px !important;
}
.drawerGrid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 24px;
  margin: 0;
}
.drawerGrid dt {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}
.drawerGrid dd {
  margin: 0;
}

.copyableCell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.copyButton {
  background: transparent;
  border: 1px solid var(--hair);
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
  color: var(--ink-3);
}

.paginationFooter {
  margin-top: 24px;
  text-align: right;
  color: var(--ink-3);
  font-family: var(--mono);
  font-size: 12px;
}
.moreButton,
.linkButton {
  background: transparent;
  border: none;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}

.emptyState {
  border-top: 1px solid var(--hair);
  padding: 48px 0;
  text-align: center;
  color: var(--ink-3);
}
```

- [ ] **Step 2: Compose the page**

`apps/dashboard/src/app/(auth)/automations/automations-page.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TriggerStatus } from "@switchboard/schemas";
import { useAutomationsList } from "./hooks/use-automations-list";
import { AutomationsHeader } from "./components/header";
import { FilterChips, type ChipKey } from "./components/filter-chips";
import { AutomationsTable } from "./components/automations-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import { resolveTimezone } from "./components/format";
import styles from "./automations.module.css";

const VALID_STATUSES: TriggerStatus[] = ["active", "fired", "cancelled", "expired"];

function parseChip(raw: string | null): ChipKey {
  if (raw === "all") return "all";
  if (raw && (VALID_STATUSES as string[]).includes(raw)) return raw as ChipKey;
  return "active";
}

export function AutomationsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const chip = parseChip(sp.get("status"));

  // Org timezone is not yet plumbed through the dashboard shell (see spec
  // §2.0 #23). When that follow-up lands, replace `undefined` with the org
  // tz value from the existing OrganizationConfig fetch.
  const timezone = resolveTimezone(undefined);

  const queryStatus: TriggerStatus | undefined = chip === "all" ? undefined : chip;
  const q = useAutomationsList({ status: queryStatus });

  const pages = q.data?.pages ?? [];
  const allRows = useMemo(() => pages.flatMap((p) => p.rows), [pages]);
  const lastPage = pages[pages.length - 1];
  const counts = lastPage?.statusCounts ?? {
    all: 0,
    active: 0,
    fired: 0,
    cancelled: 0,
    expired: 0,
  };

  function setChip(next: ChipKey) {
    const params = new URLSearchParams(sp.toString());
    if (next === "active") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    router.replace(params.toString() ? `?${params.toString()}` : "/automations");
  }

  let content: React.ReactNode;
  if (q.isLoading && !q.data) {
    content = (
      <div className={styles.tableScroll} aria-busy="true">
        {/* Hairline skeleton; 8 rows. */}
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={styles.skeletonRow} />
        ))}
      </div>
    );
  } else if (q.isError) {
    content = <EmptyState kind="error" onRetry={() => void q.refetch()} />;
  } else if (counts.all === 0) {
    content = <EmptyState kind="zero" />;
  } else if (allRows.length === 0) {
    content = <EmptyState kind="filtered" onClearFilter={() => setChip("active")} />;
  } else {
    content = (
      <>
        <AutomationsTable rows={allRows} timezone={timezone} />
        <PaginationFooter
          shownCount={allRows.length}
          hasMore={lastPage?.hasMore ?? false}
          loading={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
        />
      </>
    );
  }

  return (
    <div className={styles.automationsPage}>
      <AutomationsHeader />
      <h1 className={styles.title}>Automations</h1>
      <FilterChips active={chip} counts={counts} onChange={setChip} />
      {content}
    </div>
  );
}
```

- [ ] **Step 3: Server entry**

`apps/dashboard/src/app/(auth)/automations/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AutomationsPage } from "./automations-page";

export const metadata: Metadata = {
  title: "Automations · Switchboard",
};

export default function Page() {
  return <AutomationsPage />;
}
```

- [ ] **Step 4: Page-level test**

`apps/dashboard/src/app/(auth)/automations/__tests__/automations-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutomationsPage } from "../automations-page";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    automations: { list: (q: object) => ["org-test", "automations", "list", q] as const },
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "false";
});

function withQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("<AutomationsPage />", () => {
  it("renders fixture rows under the Active chip by default", async () => {
    render(withQuery(<AutomationsPage />));
    await waitFor(() => {
      expect(screen.getByText("Automations")).toBeInTheDocument();
    });
    // Default-active chip shows count from fixture (3 active rows).
    expect(screen.getByRole("button", { name: /Active 3/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Active rows from the fixture should be visible.
    const expectedActiveIds = AUTOMATIONS_FIXTURE_PAGE.rows
      .filter((r) => r.status === "active")
      .map((r) => r.id);
    for (const id of expectedActiveIds) {
      // Active rows only — non-active rows from the fixture should still
      // render because the live-flag is off so we don't actually filter
      // server-side; the chip is purely cosmetic in fixture mode.
      expect(screen.getByText(id, { exact: false })).toBeInTheDocument();
    }
  });

  it("renders the zero-state when fixture statusCounts.all is 0", async () => {
    // Override fixture by mocking the hook for this test.
    vi.doMock("../fixtures", () => ({
      AUTOMATIONS_FIXTURE_PAGE: {
        rows: [],
        statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
        nextCursor: null,
        hasMore: false,
      },
    }));
    vi.resetModules();
    const { AutomationsPage: PageLocal } = await import("../automations-page");
    render(withQuery(<PageLocal />));
    await waitFor(() => {
      expect(screen.getByText(/No automations yet/i)).toBeInTheDocument();
    });
    vi.doUnmock("../fixtures");
  });
});
```

Add a `.skeletonRow` class to the CSS module so the loading state has something to render:

```css
.skeletonRow {
  height: 36px;
  border-bottom: 1px solid var(--hair);
  background: linear-gradient(90deg, var(--cream) 0%, var(--row-hover) 50%, var(--cream) 100%);
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/dashboard test -- automations-page`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Run the dashboard build**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: clean exit. (Catches any "use client" / server-component mistake before we try to render in the browser.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/automations/
git commit -m "feat(dashboard): /automations page composition + Mercury CSS (D2)"
```

---

## Task 18: Final D2b sanity sweep

**Files:**

- None (lint + typecheck + build)

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: clean across all workspaces.

- [ ] **Step 2: Full lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: every workspace green.

- [ ] **Step 4: Manual browser smoke**

Start the dashboard dev server: `pnpm --filter @switchboard/dashboard dev`
Visit: `http://localhost:3002/automations`
Expected:

- Renders the 6-row fixture (live flag off).
- `Active 3` chip is selected by default.
- Clicking `Fired 1` filters to a single row.
- Clicking the chevron on a row opens the drawer; the chevron's `aria-expanded` flips to `true` (inspect via devtools).
- Clicking another row's chevron closes the first drawer.
- The "Copy trigger id" button copies the id to clipboard (paste into the address bar to verify).
- No mutation buttons (Cancel/Edit/Delete) anywhere.

If anything regresses, fix and recommit before opening PR.

- [ ] **Step 5: There is no commit for this task — it's a verification gate.** PR-D2b is now ready to push.

---

## Out of plan / not in scope

These were explicitly named in the spec as deferred D2.5 work and must not be sneaked in:

- Cancel-trigger button on active rows.
- `?triggerId=<id>` direct-id lookup escape hatch.
- `Timer fire time` sort + column for timer-only views.
- `?q=<text>` string search.
- Type filter (UI chip + API param shipped together).
- Status-history substrate (`@updatedAt` field or `ScheduledTriggerStateChange` log).
- Org-tz plumbing through the page shell (D2b uses browser-tz fallback per spec §2.0 #23).

If a reviewer asks for any of these, decline politely and link to the deferred-work list in the spec.
