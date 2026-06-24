# S8a — DeploymentMemory provenance + valid-time + invalidate-not-delete (Implementation Plan)

> **For agentic workers:** TDD-shaped, executed via the build-loop EXECUTE phase (RED proof per step). Steps use checkbox (`- [ ]`) syntax. This is `.claude/` scratch (uncommitted), per the build-loop (plans live in scratch, not on the impl branch).

**Goal:** Add nullable provenance (`source`) + bi-temporal valid-time (`validFrom`/`validTo`/`invalidatedAt`) to `DeploymentMemory`, and switch the conversation-compounding **evict** + **decay** paths from hard-delete to **invalidate** (soft-remove, preserving history), with all store reads filtering `invalidatedAt IS NULL`.

**Architecture:** Schemas (Zod enum + optional fields) → Prisma schema + hand-authored migration → db store (invalidate + read-filters + decay 2-pass + create provenance + tombstone-resurrection) → core interface (`invalidate` + `source?`) → core service rewire (evict→invalidate, populate source). `delete()` is KEPT (live out-of-scope consumers: the operator forget route + 2 creative-loop crons, which use their own narrower interfaces).

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turbo), Prisma (Postgres), Zod, Vitest (mocked Prisma — CI has no Postgres).

## Global Constraints (verbatim, every task)

- ESM only; `.js` extensions on relative imports. No `console.log`. No `any`. Prettier: semi, double quotes, 2-space, trailing commas, 100 width. No em-dashes anywhere.
- Co-located `*.test.ts` for every module touched. `pnpm test` + `pnpm typecheck` before commit; per-package `pnpm --filter X exec tsc --noEmit` (pre-commit hook is eslint+prettier only, NOT tsc).
- Layers: schemas → sdk → core → db → apps; no cycles. db may import from core (StaleVersionError) + schemas. core may import from schemas.
- Schema change requires a migration in the SAME commit; hand-author it (Postgres is down) and let CI `db:check-drift` validate. Lowercase commit subjects (Conventional Commits).
- Invariant context: this is slice 1 of S8 (govern memory writes through PlatformIngress). S8a is PURE schemas+db+core (NO ingress/actor work — that is S8c). Do NOT touch the creative-loop crons, the operator route, or the owner-memory store.

**baseline_sha:** captured at worktree creation (origin/main @ ea7a30cdd).

---

### Task 1: Zod source enum + optional valid-time fields (schemas, Layer 1)

**Files:**

- Modify: `packages/schemas/src/deployment-memory.ts` (enum after line 23; fields in `DeploymentMemorySchema` after line 67)
- Test: `packages/schemas/src/__tests__/deployment-memory.test.ts`

**Interfaces:**

- Produces: `DeploymentMemorySourceSchema` (z.enum) + `type DeploymentMemorySource = "conversation-compounding" | "pattern-merge" | "operator" | "decay"`; `DeploymentMemorySchema` gains optional nullable `source`/`validFrom`/`validTo`/`invalidatedAt`. Consumed by Tasks 3-5 (the `DeploymentMemorySource` type) and S8b (parameterSchema).

- [ ] **Step 1: Write the failing test.** Append to `__tests__/deployment-memory.test.ts` (ensure `DeploymentMemorySourceSchema` is added to the existing import from `"../deployment-memory.js"`):

```ts
describe("DeploymentMemorySourceSchema", () => {
  it("enumerates the four provenance sources in order", () => {
    expect(DeploymentMemorySourceSchema.options).toEqual([
      "conversation-compounding",
      "pattern-merge",
      "operator",
      "decay",
    ]);
  });
  it("rejects an unknown source", () => {
    expect(DeploymentMemorySourceSchema.safeParse("magic").success).toBe(false);
  });
});

describe("DeploymentMemorySchema provenance + valid-time", () => {
  const base = {
    id: "m1",
    organizationId: "o1",
    deploymentId: "d1",
    category: "fact",
    content: "c",
    confidence: 0.5,
    sourceCount: 1,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  it("parses without the new optional fields (backward compatible)", () => {
    expect(DeploymentMemorySchema.safeParse(base).success).toBe(true);
  });
  it("parses with source + valid-time populated", () => {
    expect(
      DeploymentMemorySchema.safeParse({
        ...base,
        source: "conversation-compounding",
        validFrom: new Date(),
        validTo: null,
        invalidatedAt: null,
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify RED.** `pnpm --filter @switchboard/schemas test -- deployment-memory` → FAIL (`DeploymentMemorySourceSchema` is not exported / not defined).
- [ ] **Step 3: Implement.** In `deployment-memory.ts`, after `DeploymentMemoryCategorySchema`'s type export (line ~23) add:

```ts
/**
 * Provenance of a DeploymentMemory write — who/what asserted the fact. Set at
 * create time (and on resurrection of a tombstoned row); reinforcement never
 * mutates it. "operator" + "decay" are reserved for the governed writers landing
 * in S8b/S8c. Mirrors `category`: a Prisma String validated by a Zod enum (the
 * Prisma column is `source String?`).
 */
export const DeploymentMemorySourceSchema = z.enum([
  "conversation-compounding",
  "pattern-merge",
  "operator",
  "decay",
]);
export type DeploymentMemorySource = z.infer<typeof DeploymentMemorySourceSchema>;
```

Then inside `DeploymentMemorySchema`, after `updatedAt: z.coerce.date(),` (line 67) add:

```ts
  // Provenance + bi-temporal valid-time (S8a). All nullable/optional: legacy
  // rows + non-compounding writers leave them null. invalidatedAt IS NULL is the
  // liveness predicate; validTo is the valid-time end (set together in the
  // automatic evict/decay paths).
  source: DeploymentMemorySourceSchema.nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  invalidatedAt: z.coerce.date().nullable().optional(),
```

- [ ] **Step 4: Run, verify GREEN.** `pnpm --filter @switchboard/schemas test -- deployment-memory` → PASS. Then `pnpm --filter @switchboard/schemas build` (downstream db/core consume the built dist).
- [ ] **Step 5: Commit.** `git add packages/schemas/src/deployment-memory.ts packages/schemas/src/__tests__/deployment-memory.test.ts && git commit -m "feat(schemas): add DeploymentMemory source enum + valid-time fields (S8a)"`

---

### Task 2: Prisma columns + hand-authored migration (db)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `DeploymentMemory`, lines 769-787)
- Create: `packages/db/prisma/migrations/20260622120000_deployment_memory_provenance_valid_time/migration.sql`

**Interfaces:**

- Produces: 4 nullable Prisma columns `source String?`, `validFrom DateTime?`, `validTo DateTime?`, `invalidatedAt DateTime?` on `DeploymentMemory`. Consumed by Tasks 3-4 (the generated Prisma client types).

- [ ] **Step 1: Add the columns to the model.** In `schema.prisma`, in `model DeploymentMemory`, insert after the `lastDecayedAt  DateTime?` line and before `createdAt`:

```prisma
  source         String?
  validFrom      DateTime?
  validTo        DateTime?
  invalidatedAt  DateTime?
```

- [ ] **Step 2: Hand-author the migration** at `packages/db/prisma/migrations/20260622120000_deployment_memory_provenance_valid_time/migration.sql`:

```sql
-- S8a: provenance (`source`) + bi-temporal valid-time (`validFrom`/`validTo`/`invalidatedAt`)
-- on DeploymentMemory. Enables invalidate-not-delete (decay/evict soft-remove, preserving
-- history + the provenance of "who asserted this fact"). All nullable: legacy rows stay NULL
-- (honest absence); the store populates source/validFrom on create and validTo/invalidatedAt
-- on invalidation. Purely additive — no backfill, no index change (the existing
-- [organizationId, deploymentId] index covers the read predicate; invalidatedAt IS NULL is a
-- cheap residual on the <=500-row-per-deployment cap).
ALTER TABLE "DeploymentMemory" ADD COLUMN "source" TEXT,
ADD COLUMN "validFrom" TIMESTAMP(3),
ADD COLUMN "validTo" TIMESTAMP(3),
ADD COLUMN "invalidatedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Regenerate + validate (the RED/GREEN for a schema task).** `pnpm --filter @switchboard/db exec prisma validate` → "schema is valid". `pnpm db:generate` → succeeds. (Drift is validated in CI `db:check-drift`; Postgres is down locally. If a local PG is reachable, run `pnpm db:check-drift` → no drift.)
- [ ] **Step 4: Confirm the generated client carries the fields.** `grep -n "invalidatedAt" packages/db/node_modules/.prisma/client/index.d.ts | head` (or the generated client path) → the `DeploymentMemory` type includes `source`/`validFrom`/`validTo`/`invalidatedAt`.
- [ ] **Step 5: Commit.** `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260622120000_deployment_memory_provenance_valid_time && git commit -m "feat(db): add DeploymentMemory provenance + valid-time columns + migration (S8a)"`

---

### Task 3: Store invalidate() + read-filters + decay 2-pass + interface (db + core)

**Files:**

- Modify: `packages/core/src/memory/compounding-service.ts` (interface `CompoundingDeploymentMemoryStore`, lines 36-80)
- Modify: `packages/db/src/stores/prisma-deployment-memory-store.ts` (reads, decayStale; add `invalidate`)
- Modify: `packages/core/src/memory/__tests__/compounding-service-fixtures.ts:31-39` (mock)
- Test: `packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts`

**Interfaces:**

- Consumes: the Prisma columns (Task 2).
- Produces: `CompoundingDeploymentMemoryStore.invalidate(organizationId: string, id: string): Promise<void>` + the same method on `PrismaDeploymentMemoryStore`; all 6 reads filter `invalidatedAt: null`; `decayStale` invalidates at-floor stale rows. `delete()` UNCHANGED (kept).

- [ ] **Step 1: Write failing store tests.** In `prisma-deployment-memory-store.test.ts`: (a) add `invalidate` tests; (b) update the read where-clause assertions to include `invalidatedAt: null`; (c) update `decayStale` to expect two `updateMany` calls + a pass-2 invalidation. New `invalidate` block:

```ts
describe("invalidate", () => {
  it("soft-removes by setting invalidatedAt + validTo, scoped to live rows", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    await store.invalidate("org-1", "mem-1");
    const arg = prisma.deploymentMemory.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "mem-1", organizationId: "org-1", invalidatedAt: null });
    expect(arg.data.invalidatedAt).toBeInstanceOf(Date);
    expect(arg.data.validTo).toBeInstanceOf(Date);
  });
  it("throws StaleVersionError when the row is already gone/invalidated", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 0 });
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    await expect(store.invalidate("org-1", "mem-1")).rejects.toBeInstanceOf(StaleVersionError);
  });
});
```

Update each existing read assertion to add `invalidatedAt: null` to the expected `where` (listHighConfidence ~123-129, listByDeployment ~183-186, findByCategory ~192-194, findEvictionCandidate ~233-237, findByCategoryAndCanonicalKey ~262-269, and countByDeployment ~215-222 — add `invalidatedAt: null` to its expected where too). Replace the `decayStale` test body to assert two passes:

```ts
it("decays above-floor stale rows and invalidates at-floor stale rows (2-pass)", async () => {
  const prisma = createMockPrisma();
  prisma.deploymentMemory.updateMany
    .mockResolvedValueOnce({ count: 4 }) // pass 1: decrement
    .mockResolvedValueOnce({ count: 2 }); // pass 2: invalidate
  const store = new PrismaDeploymentMemoryStore(prisma as never);
  const cutoffDate = new Date("2026-01-01");
  const startOfDay = new Date("2026-06-22");
  const count = await store.decayStale({ cutoffDate, decayAmount: 0.1, floor: 0.3, startOfDay });
  expect(count).toBe(4); // returns the DECREMENTED count (metric meaning preserved)
  expect(prisma.deploymentMemory.updateMany).toHaveBeenCalledTimes(2);
  // Pin the FULL where on BOTH passes (toEqual, not toMatchObject) — the
  // staleness predicate lastSeenAt:{lt:cutoffDate} is safety-critical on pass 2
  // (it is the ONLY thing scoping decay; omitting it would invalidate
  // recently-seen low-confidence rows). This assertion is the RED guard.
  const pass1 = prisma.deploymentMemory.updateMany.mock.calls[0][0];
  expect(pass1.where).toEqual({
    lastSeenAt: { lt: cutoffDate },
    confidence: { gt: 0.3 },
    invalidatedAt: null,
    OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: startOfDay } }],
  });
  expect(pass1.data.confidence).toEqual({ decrement: 0.1 });
  const pass2 = prisma.deploymentMemory.updateMany.mock.calls[1][0];
  expect(pass2.where).toEqual({
    lastSeenAt: { lt: cutoffDate },
    confidence: { lte: 0.3 },
    invalidatedAt: null,
  });
  expect(pass2.data).toEqual({ invalidatedAt: expect.any(Date), validTo: expect.any(Date) });
});
```

- [ ] **Step 2: Run, verify RED.** `pnpm --filter @switchboard/db test -- prisma-deployment-memory-store` → FAIL (`store.invalidate is not a function`; read where mismatches; decayStale single-call mismatch).
- [ ] **Step 3: Implement the store.** In `prisma-deployment-memory-store.ts`: add `invalidatedAt: null` to the `where` of `listByDeployment`, `listHighConfidence`, `findByCategory`, `findByCategoryAndCanonicalKey`, `countByDeployment`, `findEvictionCandidate`. Add `invalidate` after `delete`:

```ts
  async invalidate(organizationId: string, id: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.deploymentMemory.updateMany({
      where: { id, organizationId, invalidatedAt: null },
      data: { invalidatedAt: now, validTo: now },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }
```

Replace `decayStale` with this exact 2-pass body:

```ts
  async decayStale(input: {
    cutoffDate: Date;
    decayAmount: number;
    floor: number;
    startOfDay: Date;
  }): Promise<number> {
    // route-governance: store-mutation-global — cross-org confidence decay batch.
    // Pass 1: decrement live, stale, above-floor rows (idempotent per UTC day via
    // the lastDecayedAt guard). invalidatedAt:null skips already soft-removed rows.
    const decremented = await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: input.cutoffDate },
        confidence: { gt: input.floor },
        invalidatedAt: null,
        OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
      },
      data: {
        confidence: { decrement: input.decayAmount },
        lastDecayedAt: new Date(),
      },
    });
    // Pass 2: invalidate-not-delete. A STALE row that has decayed to/below the
    // floor is spent; soft-remove it (frees a cap slot, preserves history) rather
    // than leaving a zombie. lastSeenAt < cutoffDate is SAFETY-CRITICAL here: it is
    // the only thing scoping decay, so omitting it would wrongly invalidate a
    // recently-seen low-confidence row. We deliberately do NOT carry pass-1's
    // lastDecayedAt OR-guard: invalidatedAt:null already makes this idempotent, and
    // the guard would defer invalidating a row decremented-to-floor THIS run by a
    // full cycle.
    const now = new Date();
    await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: input.cutoffDate },
        confidence: { lte: input.floor },
        invalidatedAt: null,
      },
      data: { invalidatedAt: now, validTo: now },
    });
    // Return the DECREMENTED count to preserve the existing outcomePatternsDecayed
    // metric's meaning (rows decayed this run). Invalidations are a side effect.
    return decremented.count;
  }
```

Note: `decayStale` is declared on the SEPARATE `PatternDecayMemoryStore` interface (inngest-functions.ts:8-15); its signature is unchanged (still `Promise<number>`), so that interface needs NO edit.

- [ ] **Step 4: Add `invalidate` to the interface + mock.** In `compounding-service.ts`, add to `CompoundingDeploymentMemoryStore` (after `delete`):

```ts
  /**
   * Soft-remove (invalidate) a memory: set invalidatedAt + validTo, never
   * physically delete, so an evicted/decayed row frees a cap slot while its
   * history + provenance survive. Throws StaleVersionError when already gone
   * (drop-in for the eviction path's existing delete() error handling).
   */
  invalidate(organizationId: string, id: string): Promise<void>;
```

In `compounding-service-fixtures.ts` (the `createMockDeps` deploymentMemoryStore literal, after the `delete:` line ~38) add: `invalidate: vi.fn().mockResolvedValue(undefined),`.

- [ ] **Step 5: Run, verify GREEN + typecheck.** `pnpm --filter @switchboard/db test -- prisma-deployment-memory-store` → PASS. `pnpm --filter @switchboard/db exec tsc --noEmit` + `pnpm --filter @switchboard/core exec tsc --noEmit` → clean. `pnpm --filter @switchboard/db build` (so apps see the new method).
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(db): invalidate-not-delete reads + invalidate() + decay floor-invalidation (S8a)"`

---

### Task 4: create() provenance + tombstone-resurrection (db + core interface)

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-memory-store.ts` (`CreateDeploymentMemoryInput`, `create`, add a local P2002 helper)
- Modify: `packages/core/src/memory/compounding-service.ts` (the `create` input shape in `CompoundingDeploymentMemoryStore`)
- Test: `packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts`

**Interfaces:**

- Consumes: `DeploymentMemorySource` (Task 1), columns (Task 2).
- Produces: `create` accepts optional `source?: DeploymentMemorySource | null`, persists `source` + `validFrom`, and on a P2002 against an INVALIDATED row resurrects it (clears invalidatedAt/validTo, resets confidence/sourceCount/validFrom). A LIVE collision rethrows P2002 unchanged.

- [ ] **Step 1: Write failing tests.** Add to the store test:

```ts
describe("create provenance + resurrection", () => {
  it("persists source + validFrom on a fresh create", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.create.mockResolvedValue({ id: "m1" });
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    await store.create({
      organizationId: "o1",
      deploymentId: "d1",
      category: "fact",
      content: "c",
      source: "conversation-compounding",
    });
    const data = prisma.deploymentMemory.create.mock.calls[0][0].data;
    expect(data.source).toBe("conversation-compounding");
    expect(data.validFrom).toBeInstanceOf(Date);
  });
  it("resurrects an invalidated colliding row on P2002", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
    prisma.deploymentMemory.findFirst.mockResolvedValue({ id: "old", invalidatedAt: new Date() });
    prisma.deploymentMemory.update.mockResolvedValue({ id: "old" });
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    const r = await store.create({
      organizationId: "o1",
      deploymentId: "d1",
      category: "fact",
      content: "c",
      source: "conversation-compounding",
    });
    expect(prisma.deploymentMemory.findFirst).toHaveBeenCalled();
    const upd = prisma.deploymentMemory.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "old" });
    expect(upd.data.invalidatedAt).toBeNull();
    expect(upd.data.validTo).toBeNull();
    expect(upd.data.sourceCount).toBe(1);
    expect(r).toEqual({ id: "old" });
  });
  it("rethrows P2002 when the colliding row is LIVE (no resurrection)", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
    prisma.deploymentMemory.findFirst.mockResolvedValue({ id: "live", invalidatedAt: null });
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    await expect(
      store.create({ organizationId: "o1", deploymentId: "d1", category: "fact", content: "c" }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(prisma.deploymentMemory.findFirst).toHaveBeenCalled();
    expect(prisma.deploymentMemory.update).not.toHaveBeenCalled();
  });
  it("rethrows P2002 when no colliding row is found (race)", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
    prisma.deploymentMemory.findFirst.mockResolvedValue(null);
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    await expect(
      store.create({ organizationId: "o1", deploymentId: "d1", category: "fact", content: "c" }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
```

- [ ] **Step 2: Run, verify RED.** `pnpm --filter @switchboard/db test -- prisma-deployment-memory-store` → FAIL (source/validFrom not set; no resurrection — create rethrows before findFirst, so `findFirst toHaveBeenCalled` fails).
- [ ] **Step 3: Implement.** Add `import type { DeploymentMemorySource } from "@switchboard/schemas";` to the store + `source?: DeploymentMemorySource | null;` to `CreateDeploymentMemoryInput`. Add the same `source?: DeploymentMemorySource | null;` to the `create` input shape in the `CompoundingDeploymentMemoryStore` interface (and import the type into compounding-service.ts). Rewrite `create` to this exact body:

```ts
  async create(input: CreateDeploymentMemoryInput) {
    const now = new Date();
    const data = {
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      category: input.category,
      content: input.content,
      canonicalKey: input.canonicalKey ?? null,
      confidence: input.confidence ?? 0.5,
      sourceCount: 1,
      lastSeenAt: now,
      source: input.source ?? null,
      validFrom: now,
    };
    try {
      return await this.prisma.deploymentMemory.create({ data });
    } catch (err) {
      // The unique is on CONTENT (org, deployment, category, content). With
      // invalidate-not-delete, an evicted/decayed row physically remains and
      // blocks re-creating the same content (P2002). Deterministic resolution:
      // if the colliding row is INVALIDATED, resurrect it (a fresh assertion
      // supersedes the tombstone, taking the NEW write's canonicalKey/confidence/
      // source); if it is LIVE, rethrow so the caller's existing duplicate
      // handling runs unchanged (the taste/revenue_proven crons + the pattern
      // P2002 recovery only ever collide with LIVE rows, so they are unaffected).
      if (!isPrismaUniqueConstraintError(err)) throw err;
      const colliding = await this.prisma.deploymentMemory.findFirst({
        where: {
          organizationId: input.organizationId,
          deploymentId: input.deploymentId,
          category: input.category,
          content: input.content,
        },
      });
      if (!colliding || colliding.invalidatedAt === null) throw err;
      return this.prisma.deploymentMemory.update({
        where: { id: colliding.id },
        data: {
          invalidatedAt: null,
          validTo: null,
          validFrom: now,
          lastDecayedAt: null,
          confidence: input.confidence ?? 0.5,
          sourceCount: 1,
          lastSeenAt: now,
          canonicalKey: input.canonicalKey ?? null,
          source: input.source ?? null,
        },
      });
    }
  }
```

Add this local helper at the bottom of the store file (the db layer has no shared P2002 export — every store hand-rolls one, e.g. prisma-receipted-booking-store.ts:42; this matches that precedent):

```ts
/** P2002 (unique-constraint) classifier — matches Prisma's error code, not its message. */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

Return-type note: both branches return a full Prisma `DeploymentMemory` row; the union is structurally compatible with the interface's `Promise<{ id: string }>`, and the only return-reading caller is `trackPattern` (compounding-service.ts:519, reads `.id` only) — so the union is safe.

- [ ] **Step 4: Run, verify GREEN + typecheck.** `pnpm --filter @switchboard/db test -- prisma-deployment-memory-store` → PASS. `pnpm --filter @switchboard/db exec tsc --noEmit` + `pnpm --filter @switchboard/core exec tsc --noEmit` → clean. `pnpm --filter @switchboard/db build`.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(db): create provenance + tombstone-resurrection on invalidated collision (S8a)"`

---

### Task 5: Service rewire — evict→invalidate + populate source (core)

**Files:**

- Modify: `packages/core/src/memory/compounding-service.ts` (line 372 evict; create calls 386, 441, 509)
- Test: `packages/core/src/memory/__tests__/compounding-service.test.ts` (mirror existing eviction/create tests)

**Interfaces:**

- Consumes: `invalidate` (Task 3), `source?` on create (Task 4).
- Produces: the compounding evict path soft-invalidates; facts/FAQs are tagged `source: "conversation-compounding"`, patterns `source: "pattern-merge"`.

- [ ] **Step 1: Write the failing test.** In `compounding-service.test.ts`, add (mirroring the existing at-cap eviction test + mock from `compounding-service-fixtures.ts`): a test that when `countByDeployment >= MAX_DEPLOYMENT_MEMORY_ENTRIES` and the newcomer outranks the eviction candidate, `deps.deploymentMemoryStore.invalidate` is called with the candidate id (and `delete` is NOT), then `create` runs; and a test that when `invalidate` rejects with `new StaleVersionError(...)`, `create` is NOT called (fact dropped). Also assert the fact create is called with `source: "conversation-compounding"` (in `compounding-service.test.ts`) and the pattern create with `source: "pattern-merge"` (add this assertion in `compounding-service-patterns.test.ts`, where the pattern flow is exercised) — and confirm the P2002-recovery `incrementConfidence` at ~540 is NOT given a source.
- [ ] **Step 2: Run, verify RED.** `pnpm --filter @switchboard/core test -- compounding-service` → FAIL (`invalidate` not called — service still calls `delete`; source not present on create args).
- [ ] **Step 3: Implement.** In `compounding-service.ts`: line 372 `await this.memoryStore.delete(organizationId, candidate.id);` → `await this.memoryStore.invalidate(organizationId, candidate.id);`. Update the catch comment (374-381) to say "invalidated by a concurrent writer" instead of "deleted". Add `source: "conversation-compounding",` to the fact create (386) and FAQ create (441); add `source: "pattern-merge",` to the pattern create (509).
- [ ] **Step 4: Run, verify GREEN + typecheck.** `pnpm --filter @switchboard/core test -- compounding-service` → PASS. `pnpm --filter @switchboard/core exec tsc --noEmit` → clean. `pnpm --filter @switchboard/core build`.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(core): route compounding evict through invalidate + tag write provenance (S8a)"`

---

## Self-review (against the S8 design + FRAME pressure-test)

- **Spec coverage:** schema 4 cols (T2) ✓; invalidate-not-delete evict (T5) + decay (T3) ✓; reads filter invalidatedAt (T3) ✓; source populated from existing writers (T5) ✓; Zod updated (T1) ✓; dedup/idempotency: tombstone-resurrection reuses the P2002 catch deterministically (T4) ✓; count===0 guard on invalidate (T3) ✓.
- **Scope boundary (documented, NOT changed) — runtime-accurate:** `delete()` is KEPT. Its callers (operator forget route deployment-memory.ts:85; the `revenue-proven-promotion` + `creative-taste-sweep` crons) are TYPED against narrower interfaces (`RevenueProvenMemoryStore`/`TasteSweepMemoryStore` + the route uses the impl class), so adding `invalidate`/`source?` to `CompoundingDeploymentMemoryStore` causes them NO typecheck impact. BUT at runtime they are injected the SAME `PrismaDeploymentMemoryStore` instance, so the read-filter + create changes DO apply to their calls. This is SAFE by construction: (a) those crons hard-DELETE and never create tombstones, so their `create` collisions are always against LIVE rows → `create` rethrows P2002 → their existing P2002 handling fires unchanged; (b) CORRECTION (review caught my earlier wrong claim): the decay cron is category-AGNOSTIC, so a 180-day-stale at-floor `taste`/`revenue_proven` row IS now soft-invalidated by decay pass-2 (it was NOT before S8a — decay only decremented). This is faithful to the design ("decay sets invalidatedAt at floor", no category scope) and SAFE: a re-asserting cron's `create()` hits the resurrection branch (revives the tombstone, no lost write/overflow), and ≤0.3 rows are below the 0.66 surfacing threshold so the only visible effect is freeing cap pressure. Deliberate decision (do NOT scope pass-2 by category — that would invent scope AND create a decrement-but-never-invalidate inconsistency); flagged in the PR for the human merge call; (c) `countByDeployment` (counts ALL categories) now excludes invalidated rows — correct, it relieves cap pressure rather than corrupting it. The operator forget route now sees only live rows (its `listByDeployment` ownership check filters invalidatedAt:null), so it can still delete any LIVE memory; it just 404s on an already-invalidated row — true erasure of soft-invalidated rows is the separate erasure path, not this route. Creative-loop crons still hard-delete-evict (different workstream); extending invalidate to them is a possible future slice, NOT S8a.
- **Test-coverage decision (push-back on a plan-grade suggestion):** the read-filter behavior change lives in the STORE and is pinned by the store's OWN unit test (Task 3, exact-`toEqual` where-clause assertions). The creative-loop cron tests correctly mock the store at its (unchanged) interface contract, so they stay green by construction — that is the right layering, NOT a coverage gap. We do NOT add cron-level integration tests for the store internals (that would couple the crons' tests to store implementation detail). `pnpm --filter @switchboard/api test` still runs in VERIFY as a guard.
- **Type consistency:** `invalidate(organizationId, id): Promise<void>` identical across interface + impl + mock; `source?: DeploymentMemorySource | null` identical across schemas type, db input, core interface input; literals `"conversation-compounding"`/`"pattern-merge"` are enum members.
- **No placeholders:** every code step shows the code. RED proof per TDD task; the migration task (T2) is verified by `prisma validate` + `db:generate` + CI drift (no unit RED exists for a pure schema add — honest).
- **VERIFY must additionally run** `pnpm --filter @switchboard/api test` (store-tightening lesson) + `pnpm db:check-drift` (CI) + full `pnpm build` + `pnpm typecheck` + `pnpm lint` + `pnpm format:check` + `pnpm arch:check` + `CI=1 npx tsx scripts/local-verify-fast.ts` (the only gate that catches new route/env-allowlist debt — should be a no-op here since S8a adds neither) + `pnpm test`. S8a does NOT touch the decision engine, so no workstream eval is required.
