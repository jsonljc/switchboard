# Handoff store tenant isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-scope `HandoffStore.getById` / `getBySessionId` / `updateStatus` so a leaked or guessed handoff id or sessionId cannot read another tenant's lead PII or mutate another tenant's handoff status.

**Architecture:** Add `organizationId` as the first parameter of the three methods (mirroring the already-scoped `listPending` and the `creative-job-store` / `contact-store` / `owner-task-store` convention). Reads scope with `findFirst({ where: { ..., organizationId } })` and return `null` on a miss (no cross-tenant oracle); the mutation uses `updateMany({ where: { id, organizationId } })` plus a `count === 0` throw so a wrong-org or missing update fails loudly instead of no-op-succeeding. Thread `organizationId` through the single production caller (`escalate.ts`, where `ctx.orgId` is already in scope). `save()` is audited as out-of-threat-model (server-generated ids, org-immutable update branch) and pinned by a regression test rather than changed.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma, Vitest. db store tests run against a mocked Prisma client (CI has no Postgres).

---

## Background and full design

See the spec: `docs/superpowers/specs/2026-06-12-handoff-store-tenant-isolation-design.md`. It records the verified finding (origin/main `60a6bb49`), the exhaustive caller audit, the `save()` safety audit, and the rationale for each decision (including the four review amendments folded in here).

## File Structure

This is an atomic signature change. The interface and its two implementers and the one caller must move together to keep `pnpm typecheck` green, so they live in a single commit (a partial change would leave the repo red at typecheck). TDD evidence comes from running the db store test after editing the test but before editing the impl (it goes red), then green after.

Files touched (6):

- Modify `packages/core/src/handoff/types.ts`: the `HandoffStore` interface (3 signatures gain `organizationId` first).
- Modify `packages/db/src/stores/handoff-store.ts`: `PrismaHandoffStore` impl, scope reads, `updateMany` + inferred-data + `count===0` throw, delete the `#643` self-flag comment.
- Modify `packages/db/src/stores/__tests__/handoff-store.test.ts`: new arity + per-method tenant-denial + behavioral-isolation + `save()` immutability tests (the security proof).
- Modify `apps/api/src/__tests__/test-stores.ts`: `TestHandoffStore` in-memory fake, new arity + faithful org filtering + newest-first `getBySessionId`.
- Modify `packages/core/src/skill-runtime/tools/escalate.ts`: pass `ctx.orgId` to `getBySessionId` (line 61).
- Modify `packages/core/src/skill-runtime/tools/escalate.test.ts`: assert `getBySessionId` is called with `(orgId, sessionId)`.

**Cross-package build note (important):** db/api typecheck against core's BUILT `dist`, and api/chat vitest load core from `dist`. After editing core's interface and `escalate.ts`, run a full `pnpm build` before `pnpm typecheck` and before the api/chat test steps so they see the new interface and the new runtime call. The db and core packages' own vitest runs resolve their own `src`, so steps that run only `--filter @switchboard/db` / `--filter @switchboard/core` tests do not need a rebuild first.

**Coverage delta (no loss):** the original db test covered `listPending` (x2), `updateStatus` (with/without ack), and `getById` (null + row-mapping). The rewrite preserves all of those (the row-mapping assertions live in the new `getById` scoped+maps test) and adds: per-method cross-tenant-denial, a behavioral isolation test, and a `save()` ownership-immutability guard.

---

## Task 1: Org-scope the three HandoffStore methods (atomic TDD change)

**Files:**

- Test (red first): `packages/db/src/stores/__tests__/handoff-store.test.ts`
- Modify: `packages/core/src/handoff/types.ts`
- Modify: `packages/db/src/stores/handoff-store.ts`
- Modify: `apps/api/src/__tests__/test-stores.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.test.ts`

- [ ] **Step 1: Rewrite the db store test with new arity + tenant-denial + behavioral-isolation + save tests (the failing test)**

Replace the entire contents of `packages/db/src/stores/__tests__/handoff-store.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Handoff } from "@switchboard/core";
import { PrismaHandoffStore } from "../handoff-store.js";

describe("PrismaHandoffStore", () => {
  const mockUpsert = vi.fn();
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockUpdateMany = vi.fn();

  const mockPrisma = {
    handoff: {
      upsert: mockUpsert,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  let store: PrismaHandoffStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PrismaHandoffStore(mockPrisma);
  });

  function sampleRow(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      id: "h1",
      sessionId: "s1",
      organizationId: "org_1",
      status: "pending",
      reason: "human_requested",
      leadSnapshot: { name: "Alice", channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "mql" },
      conversationSummary: {
        turnCount: 5,
        keyTopics: [],
        objectionHistory: [],
        sentiment: "neutral",
      },
      slaDeadlineAt: now,
      acknowledgedAt: null,
      createdAt: now,
      ...overrides,
    };
  }

  describe("listPending()", () => {
    it("queries for pending/assigned/active handoffs ordered by slaDeadlineAt", async () => {
      const now = new Date();
      mockFindMany.mockResolvedValue([
        sampleRow({ id: "h1", status: "pending" }),
        sampleRow({ id: "h2", status: "active", slaDeadlineAt: new Date(now.getTime() + 60_000) }),
      ]);

      const result = await store.listPending("org_1");

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          status: { in: ["pending", "assigned", "active"] },
        },
        orderBy: { slaDeadlineAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("h1");
      expect(result[1]!.id).toBe("h2");
    });

    it("returns empty array when no pending handoffs exist", async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await store.listPending("org_empty");
      expect(result).toEqual([]);
    });
  });

  describe("getById()", () => {
    it("scopes the query to organizationId and id, and maps the row", async () => {
      mockFindFirst.mockResolvedValue(sampleRow());
      const result = await store.getById("org_1", "h1");
      expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: "h1", organizationId: "org_1" } });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("h1");
      expect(result!.acknowledgedAt).toBeUndefined();
      expect(result!.leadSnapshot.name).toBe("Alice");
    });

    it("returns null when not found", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getById("org_1", "nonexistent");
      expect(result).toBeNull();
    });

    it("denies cross-tenant read: a wrong org yields null and the where-clause carries that org", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getById("org_OTHER", "h1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_OTHER" },
      });
      expect(result).toBeNull();
    });
  });

  describe("getBySessionId()", () => {
    it("scopes the query to organizationId and sessionId, newest first", async () => {
      mockFindFirst.mockResolvedValue(sampleRow());
      const result = await store.getBySessionId("org_1", "s1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { sessionId: "s1", organizationId: "org_1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result!.sessionId).toBe("s1");
    });

    it("denies cross-tenant read: a wrong org yields null and the where-clause carries that org", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await store.getBySessionId("org_OTHER", "s1");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { sessionId: "s1", organizationId: "org_OTHER" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("updateStatus()", () => {
    it("updates status with an org-scoped updateMany (no acknowledgedAt)", async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      await store.updateStatus("org_1", "h1", "released");
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_1" },
        data: { status: "released" },
      });
    });

    it("updates status with acknowledgedAt", async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      const ackDate = new Date("2026-03-18T12:00:00Z");
      await store.updateStatus("org_1", "h1", "assigned", ackDate);
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_1" },
        data: { status: "assigned", acknowledgedAt: ackDate },
      });
    });

    it("denies cross-tenant mutation: count===0 throws instead of silently succeeding", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateStatus("org_OTHER", "h1", "released")).rejects.toThrow(
        "Handoff not found or does not belong to organization: h1",
      );
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "h1", organizationId: "org_OTHER" },
        data: { status: "released" },
      });
    });
  });

  describe("tenant isolation (behavioral: the where-clause actually isolates)", () => {
    // An honest in-memory stand-in for Prisma.findFirst that APPLIES the
    // where-clause and orderBy the store builds, so these tests prove the store
    // isolates tenants, not merely that we asserted a clause shape.
    function seedFindFirst(rows: ReturnType<typeof sampleRow>[]) {
      mockFindFirst.mockImplementation(
        (args: {
          where?: { id?: string; sessionId?: string; organizationId?: string };
          orderBy?: { createdAt?: "asc" | "desc" };
        }) => {
          const where = args.where ?? {};
          let matched = rows.filter(
            (r) =>
              (where.id === undefined || r.id === where.id) &&
              (where.sessionId === undefined || r.sessionId === where.sessionId) &&
              (where.organizationId === undefined || r.organizationId === where.organizationId),
          );
          if (args.orderBy?.createdAt === "desc") {
            matched = [...matched].sort(
              (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
            );
          }
          return Promise.resolve(matched[0] ?? null);
        },
      );
    }

    it("getBySessionId returns only the caller-org row when two orgs share a sessionId", async () => {
      const t0 = new Date("2026-06-01T00:00:00Z");
      seedFindFirst([
        sampleRow({
          id: "hA",
          organizationId: "org_A",
          sessionId: "s1",
          leadSnapshot: { name: "AliceA", channel: "whatsapp" },
          createdAt: t0,
        }),
        sampleRow({
          id: "hB",
          organizationId: "org_B",
          sessionId: "s1",
          leadSnapshot: { name: "BobB", channel: "whatsapp" },
          createdAt: t0,
        }),
      ]);

      const a = await store.getBySessionId("org_A", "s1");
      const b = await store.getBySessionId("org_B", "s1");
      const c = await store.getBySessionId("org_C", "s1");

      expect(a!.id).toBe("hA");
      expect(a!.leadSnapshot.name).toBe("AliceA");
      expect(b!.id).toBe("hB");
      expect(c).toBeNull();
    });

    it("getBySessionId returns the newest matching row within the caller org", async () => {
      seedFindFirst([
        sampleRow({
          id: "old",
          organizationId: "org_A",
          sessionId: "s1",
          createdAt: new Date("2026-06-01T00:00:00Z"),
        }),
        sampleRow({
          id: "new",
          organizationId: "org_A",
          sessionId: "s1",
          createdAt: new Date("2026-06-02T00:00:00Z"),
        }),
      ]);

      const result = await store.getBySessionId("org_A", "s1");
      expect(result!.id).toBe("new");
    });

    it("getById returns only the caller-org row for a shared id", async () => {
      seedFindFirst([sampleRow({ id: "h1", organizationId: "org_A" })]);
      expect((await store.getById("org_A", "h1"))!.organizationId).toBe("org_A");
      expect(await store.getById("org_B", "h1")).toBeNull();
    });
  });

  describe("save()", () => {
    it("persists organizationId on create but never on update (ownership is immutable)", async () => {
      mockUpsert.mockResolvedValue({});
      const now = new Date();
      const pkg: Handoff = {
        id: "h1",
        sessionId: "s1",
        organizationId: "org_1",
        reason: "human_requested",
        status: "pending",
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 1,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: now,
        createdAt: now,
      };

      await store.save(pkg);

      const arg = mockUpsert.mock.calls[0]![0] as {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: "h1" });
      expect(arg.create.organizationId).toBe("org_1");
      // A colliding-id save must not be able to move a handoff to another tenant.
      expect(arg.update).not.toHaveProperty("organizationId");
      expect(arg.update).not.toHaveProperty("sessionId");
    });
  });
});
```

- [ ] **Step 2: Run the db store test to verify it fails**

Run: `pnpm --filter @switchboard/db test handoff-store`
Expected: FAIL. The current impl calls `findUnique`/`update` (the mock now exposes `findFirst`/`updateMany`), binds `organizationId` as `id`, and never throws on `count:0`, so the new arity, where-clause, null-on-wrong-org, behavioral-isolation, and `updateStatus`-throw assertions fail. (The `save()` test may already pass, since `save()` is unchanged; that is fine, it is a regression guard.)

- [ ] **Step 3: Update the `HandoffStore` interface**

In `packages/core/src/handoff/types.ts`, replace the interface body (lines 22-28) with:

```ts
export interface HandoffStore {
  save(pkg: Handoff): Promise<void>;
  getById(organizationId: string, id: string): Promise<Handoff | null>;
  getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null>;
  updateStatus(
    organizationId: string,
    id: string,
    status: HandoffStatus,
    acknowledgedAt?: Date,
  ): Promise<void>;
  listPending(organizationId: string): Promise<Handoff[]>;
}
```

- [ ] **Step 4: Update the `PrismaHandoffStore` impl**

In `packages/db/src/stores/handoff-store.ts`, replace the `getById`, `getBySessionId`, and `updateStatus` methods (lines 46-68, including the `#643` self-flag comment) with:

```ts
  async getById(organizationId: string, id: string): Promise<Handoff | null> {
    const row = await this.prisma.handoff.findFirst({ where: { id, organizationId } });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null> {
    const row = await this.prisma.handoff.findFirst({
      where: { sessionId, organizationId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: HandoffStatus,
    acknowledgedAt?: Date,
  ): Promise<void> {
    const data = acknowledgedAt ? { status, acknowledgedAt } : { status };
    // Org-scoped mutation: updateMany so a wrong-org id matches no row. updateMany
    // drops Prisma's P2025 not-found throw and returns { count: 0 }, so guard it
    // explicitly to fail loudly on a missing or cross-tenant target.
    const result = await this.prisma.handoff.updateMany({
      where: { id, organizationId },
      data,
    });
    if (result.count === 0) {
      throw new Error(`Handoff not found or does not belong to organization: ${id}`);
    }
  }
```

- [ ] **Step 5: Update the `TestHandoffStore` in-memory fake**

In `apps/api/src/__tests__/test-stores.ts`, replace the `getById`, `getBySessionId`, and `updateStatus` methods of `TestHandoffStore` (lines 365-378) with:

```ts
  async getById(organizationId: string, id: string): Promise<Handoff | null> {
    const r = this.rows.get(id);
    return r && r.organizationId === organizationId ? r : null;
  }

  async getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null> {
    // Mirror the real store: newest matching row by createdAt, scoped to the org.
    return (
      [...this.rows.values()]
        .filter((r) => r.organizationId === organizationId && r.sessionId === sessionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: HandoffStatus,
    acknowledgedAt?: Date,
  ): Promise<void> {
    const r = this.rows.get(id);
    if (!r || r.organizationId !== organizationId) {
      throw new Error(`Handoff not found or does not belong to organization: ${id}`);
    }
    this.rows.set(id, { ...r, status, ...(acknowledgedAt ? { acknowledgedAt } : {}) });
  }
```

(Note: TypeScript does NOT flag the old fewer-param methods against the widened interface, because fewer-param methods stay assignable, so this update is deliberate for correctness, not compiler-forced. `Handoff.createdAt` is a `Date`, so `.getTime()` is valid.)

- [ ] **Step 6: Thread `organizationId` through the one production caller**

In `packages/core/src/skill-runtime/tools/escalate.ts`, change line 61 from:

```ts
const existing = await deps.handoffStore.getBySessionId(ctx.sessionId);
```

to:

```ts
const existing = await deps.handoffStore.getBySessionId(ctx.orgId, ctx.sessionId);
```

(The `Pick<HandoffStore, "save" | "getBySessionId">` dep type stays valid; this call site is the one place `pnpm typecheck` would otherwise error with "Expected 2 arguments, but got 1".)

- [ ] **Step 7: Assert the org is threaded, in the escalate tool test**

In `packages/core/src/skill-runtime/tools/escalate.test.ts`, in the test `"creates a handoff package using request context IDs"` (after the existing `expect(baseDeps.handoffStore.save).toHaveBeenCalled();` at line 81), add:

```ts
expect(baseDeps.handoffStore.getBySessionId).toHaveBeenCalledWith("org_1", "sess_1");
```

And in the test `"uses different IDs for different request contexts"` (after the `expect(baseDeps.assembler.assemble)...` block ending at line 111), add:

```ts
expect(baseDeps.handoffStore.getBySessionId).toHaveBeenCalledWith("org_2", "sess_2");
```

- [ ] **Step 8: Run the db and core package tests (their own src, no rebuild needed)**

Run: `pnpm --filter @switchboard/db test handoff-store`
Expected: PASS (all getById/getBySessionId/updateStatus cases, the behavioral-isolation block, and the save guard).

Run: `pnpm --filter @switchboard/core test escalate`
Expected: PASS (the two new `getBySessionId` org assertions hold).

- [ ] **Step 9: Rebuild so cross-package consumers see the new interface + runtime**

Run: `pnpm build`
Expected: all tasks successful. This refreshes `packages/core/dist` so db/api typecheck and api/chat vitest resolve the widened interface and the updated `escalate.ts`.

- [ ] **Step 10: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS (21/21). If it reports missing exports from `@switchboard/core`/`@switchboard/db`, run `pnpm reset` then re-run (stale lower-layer dist).

- [ ] **Step 11: Run the api and chat suites (they load core from dist)**

Run: `pnpm --filter @switchboard/api test`
Expected: PASS. (No api test calls the three methods directly; `TestHandoffStore` now scopes by org, which only sharpens the fake.)

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS. (chat only constructs `PrismaHandoffStore` and wires it; the escalate path runs through core dist.)

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/handoff/types.ts \
        packages/db/src/stores/handoff-store.ts \
        packages/db/src/stores/__tests__/handoff-store.test.ts \
        apps/api/src/__tests__/test-stores.ts \
        packages/core/src/skill-runtime/tools/escalate.ts \
        packages/core/src/skill-runtime/tools/escalate.test.ts
git commit -m "fix(db): tenant-scope the handoff store reads and status mutation (alex audit f8)"
```

(Commit subject is lowercase-first per commitlint. The body should note: closes the F8 cross-tenant PII read / status-mutation hole, threads `organizationId` through `escalate.ts`, `updateMany` + `count===0` guard, `save()` audited safe + ownership pinned, no migration, `#643` self-flag removed. End the body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer on its own line after a blank line.)

---

## Task 2: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: PASS (0 errors). The new `updateMany` comment and the `as any` eslint-disable in the test mirror existing patterns.

- [ ] **Step 2: Prettier format check (CI runs this; local lint does not)**

Run: `pnpm format:check`
Expected: PASS. If it reports diffs, run `pnpm format` (or `npx prettier --write` on the six files), then `git add -u` and amend the Task 1 commit (`git commit --amend --no-edit`).

- [ ] **Step 3: Repo-wide caller grep gate (catches weakly-typed / fake / any paths typecheck misses)**

Run: `rg "\.getById\(|\.getBySessionId\(|\.updateStatus\(" packages apps -g '*.ts' -g '*.tsx'`
Expected: every call on a handoff store passes `organizationId` first. `getBySessionId` is handoff-unique, so all of its call sites must be org-first. `getById`/`updateStatus` are shared method names (scheduler/task/connection/etc.), so filter by hand and confirm only the handoff ones changed; non-handoff stores are untouched. The sole production handoff caller is `escalate.ts`.

- [ ] **Step 4: Confirm no migration and no stray scope creep**

Run: `git diff origin/main...HEAD --stat`
Expected: exactly the six source files above plus the spec and this plan doc. No `packages/db/prisma/migrations/**` entry (the schema already has `organizationId` + `@@index([organizationId, status])`). No change to `listPending`, `save()` behavior, or any other store.

- [ ] **Step 5: Grep-confirm the self-flag is gone and no unscoped handoff read remains**

Run: `grep -rn "#643\|store-mutation-deferred" packages/db/src/stores/handoff-store.ts`
Expected: no matches.

Run: `grep -n "findUnique\|\.update(" packages/db/src/stores/handoff-store.ts`
Expected: no matches (reads use `findFirst`, the mutation uses `updateMany`; `save` uses `upsert`).

---

## Self-Review (completed by author)

- **Spec coverage:** all three methods scoped (Task 1 steps 3-4), single caller threaded (step 6), both implementers updated (steps 4-5), per-method tenant-denial + behavioral-isolation tests including the `count===0` throw (step 1), `save()` ownership-immutability guard (step 1), four-package test gate + build + lint + format + caller-grep gate (Task 1 steps 8-11, Task 2), no migration and self-flag removal verified (Task 2 steps 4-5). No spec requirement is unaddressed.
- **Placeholder scan:** none; every code step shows the full replacement code and exact command + expected output.
- **Type consistency:** the interface signatures in step 3 match the impl in step 4, the fake in step 5, the caller in step 6, and the test assertions in steps 1 and 7 (`getBySessionId(organizationId, sessionId)`, `updateStatus(organizationId, id, status, acknowledgedAt?)`). Error message string is identical in the real store, the fake, and the denial test: `Handoff not found or does not belong to organization: <id>`. The inferred `data` object in step 4 produces exactly the `{ status }` / `{ status, acknowledgedAt }` payloads the step-1 `updateStatus` tests assert.
