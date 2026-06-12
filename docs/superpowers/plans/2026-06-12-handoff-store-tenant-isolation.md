# Handoff store tenant isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-scope `HandoffStore.getById` / `getBySessionId` / `updateStatus` so a leaked or guessed handoff id or sessionId cannot read another tenant's lead PII or mutate another tenant's handoff status.

**Architecture:** Add `organizationId` as the first parameter of the three methods (mirroring the already-scoped `listPending` and the `creative-job-store` / `contact-store` / `owner-task-store` convention). Reads scope with `findFirst({ where: { ..., organizationId } })` and return `null` on a miss (no cross-tenant oracle); the mutation uses `updateMany({ where: { id, organizationId } })` plus a `count === 0` throw so a wrong-org or missing update fails loudly instead of no-op-succeeding. Thread `organizationId` through the single production caller (`escalate.ts`, where `ctx.orgId` is already in scope).

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma, Vitest. db store tests run against a mocked Prisma client (CI has no Postgres).

---

## Background and full design

See the spec: `docs/superpowers/specs/2026-06-12-handoff-store-tenant-isolation-design.md`. It records the verified finding (origin/main `60a6bb49`), the exhaustive caller audit, and the rationale for each decision.

## File Structure

This is an atomic signature change. The interface and its two implementers and the one caller must move together to keep `pnpm typecheck` green, so they live in a single commit (a partial change would leave the repo red at typecheck). TDD evidence comes from running the db store test after editing the test but before editing the impl (it goes red), then green after.

Files touched (6):

- Modify `packages/core/src/handoff/types.ts`: the `HandoffStore` interface (3 signatures gain `organizationId` first).
- Modify `packages/db/src/stores/handoff-store.ts`: `PrismaHandoffStore` impl, scope reads, `updateMany` + `count===0` throw, delete the `#643` self-flag comment.
- Modify `packages/db/src/stores/__tests__/handoff-store.test.ts`: new arity + per-method tenant-denial tests (the security proof).
- Modify `apps/api/src/__tests__/test-stores.ts`: `TestHandoffStore` in-memory fake, new arity + faithful org filtering.
- Modify `packages/core/src/skill-runtime/tools/escalate.ts`: pass `ctx.orgId` to `getBySessionId` (line 61).
- Modify `packages/core/src/skill-runtime/tools/escalate.test.ts`: assert `getBySessionId` is called with `(orgId, sessionId)`.

**Cross-package build note (important):** db/api typecheck against core's BUILT `dist`, and api/chat vitest load core from `dist`. After editing core's interface and `escalate.ts`, run a full `pnpm build` before `pnpm typecheck` and before the api/chat test steps so they see the new interface and the new runtime call. The db and core packages' own vitest runs resolve their own `src`, so steps that run only `--filter @switchboard/db` / `--filter @switchboard/core` tests do not need a rebuild first.

---

## Task 1: Org-scope the three HandoffStore methods (atomic TDD change)

**Files:**

- Test (red first): `packages/db/src/stores/__tests__/handoff-store.test.ts`
- Modify: `packages/core/src/handoff/types.ts`
- Modify: `packages/db/src/stores/handoff-store.ts`
- Modify: `apps/api/src/__tests__/test-stores.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.test.ts`

- [ ] **Step 1: Rewrite the db store test with new arity + tenant-denial cases (the failing test)**

Replace the entire contents of `packages/db/src/stores/__tests__/handoff-store.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
```

- [ ] **Step 2: Run the db store test to verify it fails**

Run: `pnpm --filter @switchboard/db test handoff-store`
Expected: FAIL. The current impl calls `findUnique`/`update` (the mock now exposes `findFirst`/`updateMany`), binds `organizationId` as `id`, and never throws on `count:0`, so the new arity, where-clause, null-on-wrong-org, and the `updateStatus` throw assertions all fail.

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
    const data: Record<string, unknown> = { status };
    if (acknowledgedAt) {
      data["acknowledgedAt"] = acknowledgedAt;
    }
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
    for (const r of this.rows.values()) {
      if (r.sessionId === sessionId && r.organizationId === organizationId) return r;
    }
    return null;
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

(Note: TypeScript does NOT flag the old fewer-param methods against the widened interface, because fewer-param methods stay assignable, so this update is deliberate for correctness, not compiler-forced.)

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
Expected: PASS (all getById/getBySessionId/updateStatus cases including the three tenant-denial cases).

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

(Commit subject is lowercase-first per commitlint. The body should note: closes the F8 cross-tenant PII read / status-mutation hole, threads `organizationId` through `escalate.ts`, `updateMany` + `count===0` guard, no migration, `#643` self-flag removed. End the body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer on its own line after a blank line.)

---

## Task 2: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: PASS (0 errors). The new `updateMany` comment and the `as any` eslint-disable in the test mirror existing patterns.

- [ ] **Step 2: Prettier format check (CI runs this; local lint does not)**

Run: `pnpm format:check`
Expected: PASS. If it reports diffs, run `pnpm format` (or `npx prettier --write` on the six files), then `git add -u` and amend the Task 1 commit (`git commit --amend --no-edit`).

- [ ] **Step 3: Confirm no migration and no stray scope creep**

Run: `git diff origin/main...HEAD --stat`
Expected: exactly the six source files above plus the spec and this plan doc. No `packages/db/prisma/migrations/**` entry (the schema already has `organizationId` + `@@index([organizationId, status])`). No change to `listPending` or any other store.

- [ ] **Step 4: Grep-confirm the self-flag is gone and no unscoped handoff read remains**

Run: `grep -rn "#643\|store-mutation-deferred" packages/db/src/stores/handoff-store.ts`
Expected: no matches.

Run: `grep -n "findUnique\|\.update(" packages/db/src/stores/handoff-store.ts`
Expected: no matches (reads use `findFirst`, the mutation uses `updateMany`; `save` uses `upsert`).

---

## Self-Review (completed by author)

- **Spec coverage:** all three methods scoped (Task 1 steps 3-4), single caller threaded (step 6), both implementers updated (steps 4-5), per-method tenant-denial tests including the `count===0` throw (step 1), four-package test gate + build + lint + format (Task 1 steps 8-11, Task 2), no migration and self-flag removal verified (Task 2 steps 3-4). No spec requirement is unaddressed.
- **Placeholder scan:** none; every code step shows the full replacement code and exact command + expected output.
- **Type consistency:** the interface signatures in step 3 match the impl in step 4, the fake in step 5, the caller in step 6, and the test assertions in steps 1 and 7 (`getBySessionId(organizationId, sessionId)`, `updateStatus(organizationId, id, status, acknowledgedAt?)`). Error message string is identical in the real store, the fake, and the denial test: `Handoff not found or does not belong to organization: <id>`.
