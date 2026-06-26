# Riley Capability-Flag Audit Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each Riley capability-flag flip (`pauseSelfExecutionEnabled`, `reallocateKillSwitch`, `reallocateSelfExecutionEnabled`) to its audit-ledger row inside a single Postgres transaction, so a ledger failure can never leave a money-move capability armed or disarmed with no audit row.

**Architecture:** The three audited capability toggles in `packages/db/src/seed/` (`setRileyPauseSelfExecution` + the shared `setRileyReallocateFlag` behind `setRileyReallocateKillSwitch` / `setRileyReallocateSelfExecution`) currently run `agentDeployment.update` (the flip) and then `await ledger.record(...)` (the audit row) with NO transaction. If the chain-hashing ledger write throws, the flag is already flipped but no audit row exists. The fix wraps the flip + the audit write in one interactive `prisma.$transaction(async (tx) => { ... })`, threading `tx` through `ledger.record(params, { tx })`. `AuditLedger.record` already accepts `{ tx }` and forwards it to `PrismaLedgerStorage.appendAtomic({ externalTx })`, which runs the audit-chain advisory lock + append on the parent transaction. That is the same true-atomic binding the platform uses for WorkTrace + AuditEntry, and it mirrors `provisionOrgAgentDeployments`. Result: flip and audit row commit together or roll back together.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma (mocked in unit tests via `vi.fn`), Vitest, pnpm + Turborepo.

## Global Constraints

- Source of truth: `docs/audits/2026-06-22-second-wave-gap-eval/README.md` row P3-2.
- **Design decision (recorded):** wrap the flip + `ledger.record` in one interactive `$transaction`, threading `{ tx }` into `ledger.record` (the already-built true-atomic path: `record({ tx })` -> `appendAtomic({ externalTx })`). The audit row's advisory lock is per-transaction, held until the parent commits, so the flip + audit chain-append are one atomic unit.
  - **Rejected: "ledger-first / reorder"** (write the audit row, then flip). It closes the dangerous direction but, if the flip then fails, leaves an audit row asserting a capability change that never happened. That is a different audit-integrity lie, so it is strictly worse than a real transaction.
  - **Rejected: "wrap in `$transaction` but DO NOT pass `{ tx }`"** (let the ledger keep its own connection). Not atomic (the audit row commits independently on a separate connection) and it risks a connection-pool stall: the outer interactive transaction holds one connection while `appendAtomic` opens its own nested `$transaction` on another. Passing `{ tx }` is free here because core + the Prisma storage already support it.
  - **Rejected: threading `tx` through a new core API.** Unnecessary: `AuditLedger.record(params, { tx })` and `PrismaLedgerStorage.appendAtomic(buildEntry, { externalTx })` already exist for exactly this.
- **Scope = all three toggles, this slice.** The gap-eval row names the pause toggle and directs checking "sibling reallocate/kill-switch toggle scripts for the same shape." They share the identical flip-then-record shape via `setRileyReallocateFlag`; fixing only the pause toggle would leave the known twin (the reallocate flags gate higher-stakes real-money self-execution). "Ship clean, do not defer."
- **Interface widening:** widen the structural `CapabilityAuditRecorder.record` (defined in `riley-pause-flag-toggle.ts`, consumed by both files) to `record(params, options?: { tx?: unknown }): Promise<unknown>`. This matches `AuditLedger.record`'s actual signature and `appendAtomic`'s `externalTx?: unknown`, and keeps `@switchboard/db` from importing `@switchboard/core` (the tx stays `unknown`). Adding an OPTIONAL param is backward-compatible: the three CLI callers (`scripts/riley-pause-flag.ts`, `scripts/riley-reallocate-flag.ts`, `scripts/riley-reallocate-kill-switch.ts`) pass a real `AuditLedger`, which remains assignable, and they are not modified.
- **Reads stay outside the transaction.** The listing + deployment `findUnique` lookups are unchanged and remain before the `$transaction`; only the flip + audit write are wrapped. The pre-existing read-modify-write window on `governanceSettings` is out of scope for this audit-atomicity fix and is not introduced or widened by it.
- No `any`; no `console.log`; ESM `.js` import suffixes; Prettier (semi, double quotes, 2-space, trailing commas, 100-col); Conventional Commits lowercase subject.
- NO em-dashes anywhere in the diff (prose, comments, strings). Scan `git diff --cached` before every commit.
- db unit tests mock Prisma (no CI Postgres). Mock `$transaction` with `vi.fn(async (cb) => cb(tx))` so the callback runs against a tx client carrying `agentDeployment.update` (mirror `provision-org-agents.test.ts` / `prisma-booking-store.test.ts`).
- Gates before EACH commit: `pnpm --filter @switchboard/db exec tsc --noEmit` + `pnpm --filter @switchboard/db test` + `pnpm eval:riley`. Cross-layer insurance once before the PR: `pnpm --filter @switchboard/api exec tsc --noEmit` (apps/api consumes the `@switchboard/db` barrel). The "Eval - Claim Classifier" CI job is a known unrelated `ANTHROPIC_API_KEY` flake; judge its conclusion, do not be blocked by it.

---

### Task 1: Transactional flip + audit for the pause toggle (+ interface widening)

**Files:**

- Modify: `packages/db/src/seed/riley-pause-flag-toggle.ts` (widen the `CapabilityAuditRecorder.record` signature at `:7-16`; wrap the flip + `ledger.record` in `prisma.$transaction` at `:57-81`)
- Test: `packages/db/src/seed/riley-pause-flag-toggle.test.ts` (add `$transaction` + a `tx` client to the harness; add two atomicity guards)

**Interfaces:**

- Consumes: `prisma.$transaction(async (tx) => ...)` (Prisma interactive transaction); `AuditLedger.record(params, { tx })` -> `PrismaLedgerStorage.appendAtomic(buildEntry, { externalTx })` (both already exist).
- Produces: widened `CapabilityAuditRecorder.record(params, options?: { tx?: unknown }): Promise<unknown>` (consumed by Task 2's file). `setRileyPauseSelfExecution(prisma, ledger, args): Promise<{ previous: boolean; current: boolean }>` is unchanged in signature and return.

- [ ] **Step 1: Update the harness for `$transaction`, then add two atomicity guard tests (red)**

In `packages/db/src/seed/riley-pause-flag-toggle.test.ts`, replace the `harness` function with one that routes `update` through a transaction client and widens the ledger mock to accept the options arg:

```typescript
function harness(opts?: {
  listing?: { id: string } | null;
  deployment?: { id: string; governanceSettings: Record<string, unknown> | null } | null;
}) {
  const update = vi.fn(
    async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({}),
  );
  const tx = { agentDeployment: { update } };
  const prisma = {
    agentListing: {
      findUnique: vi.fn(async () =>
        opts?.listing === undefined ? { id: "listing_1" } : opts.listing,
      ),
    },
    agentDeployment: {
      findUnique: vi.fn(async () =>
        opts?.deployment === undefined
          ? { id: "dep_1", governanceSettings: { trustLevelOverride: "autonomous" } }
          : opts.deployment,
      ),
    },
    $transaction: vi.fn(async (cb: (txc: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const record = vi.fn(
    async (_params: Record<string, unknown>, _options?: { tx?: unknown }) => ({}),
  );
  return { prisma, update, tx, ledger: { record } };
}
```

Then add, at the end of the `describe("setRileyPauseSelfExecution (audited capability toggle)", ...)` block (before its closing `});`):

```typescript
it("wraps the flip + audit write in one transaction and threads the tx into ledger.record", async () => {
  // True atomicity: the audit chain-append joins the same transaction as the
  // flag flip (ledger.record({ tx }) -> appendAtomic({ externalTx })), so the
  // capability flip and its audit row commit or roll back together.
  const h = harness();
  await setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
    organizationId: "org_1",
    enabled: true,
    actor: "jason",
  });
  expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.ledger.record).toHaveBeenCalledTimes(1);
  expect(h.ledger.record.mock.calls[0]![1]?.tx).toBe(h.tx);
});

it("rejects out of the transaction when the audit write fails (flip rolls back, never armed without an audit row)", async () => {
  // A mock cannot prove a real Postgres rollback, but proving the ledger error
  // is NOT swallowed - it escapes setRileyPauseSelfExecution - proves the flip
  // + audit are bound in one $transaction, so a ledger failure can never leave
  // pauseSelfExecutionEnabled flipped with no audit row.
  const h = harness();
  h.ledger.record.mockRejectedValueOnce(new Error("ledger chain write failed"));
  await expect(
    setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "jason",
    }),
  ).rejects.toThrow(/ledger chain write failed/);
  expect(h.update).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test file to verify the new guards fail (red)**

Run: `pnpm --filter @switchboard/db test -- riley-pause-flag-toggle`
Expected: the two new tests FAIL. `$transaction` is `undefined` on the current mock (the impl calls `prisma.agentDeployment.update` directly, never `$transaction`), so `h.prisma.$transaction` is never called and `record.mock.calls[0]![1]` is `undefined`. The existing four tests still PASS.

- [ ] **Step 3: Widen the `CapabilityAuditRecorder.record` signature**

In `packages/db/src/seed/riley-pause-flag-toggle.ts`, change the interface from:

```typescript
export interface CapabilityAuditRecorder {
  record(params: {
    eventType: "policy.updated";
    actorType: "user";
    actorId: string;
    entityType: string;
    entityId: string;
    riskCategory: "high";
    summary: string;
    snapshot: Record<string, unknown>;
  }): Promise<unknown>;
}
```

to (add the optional `options` param + a one-line note):

```typescript
export interface CapabilityAuditRecorder {
  record(
    params: {
      eventType: "policy.updated";
      actorType: "user";
      actorId: string;
      entityType: string;
      entityId: string;
      riskCategory: "high";
      summary: string;
      snapshot: Record<string, unknown>;
    },
    // When set, the audit chain-append joins the caller's transaction
    // (AuditLedger.record -> appendAtomic({ externalTx })), binding the audit
    // row to the capability flip so neither can commit without the other.
    options?: { tx?: unknown },
  ): Promise<unknown>;
}
```

- [ ] **Step 4: Wrap the flip + audit write in `prisma.$transaction`**

In the same file, replace the body from the `await prisma.agentDeployment.update({...})` call through the `await ledger.record({...})` call (currently `:57-81`) with:

```typescript
// Flip + audit row commit or roll back together: the audit chain-append joins
// this transaction (ledger.record({ tx }) -> appendAtomic({ externalTx })), so
// a ledger failure can never leave a money-move capability armed or disarmed
// with no audit row. Mirrors provisionOrgAgentDeployments + the platform's
// WorkTrace + AuditEntry binding.
await prisma.$transaction(async (tx) => {
  await tx.agentDeployment.update({
    where: { id: deployment.id },
    data: {
      // Read-modify-write preserving every other governanceSettings key
      // (trustLevelOverride, spendAutonomy, ...).
      governanceSettings: { ...settings, pauseSelfExecutionEnabled: args.enabled },
    },
  });
  await ledger.record(
    {
      eventType: "policy.updated",
      actorType: "user",
      actorId: args.actor,
      entityType: "deployment",
      entityId: deployment.id,
      riskCategory: "high",
      summary: `riley pauseSelfExecutionEnabled: ${previous} -> ${args.enabled} (org ${args.organizationId}, by ${args.actor})`,
      snapshot: {
        flag: "pauseSelfExecutionEnabled",
        previous,
        current: args.enabled,
        organizationId: args.organizationId,
        deploymentId: deployment.id,
      },
    },
    { tx },
  );
});
return { previous, current: args.enabled };
```

(The `const settings = ...` and `const previous = ...` lines immediately above the old `update` call stay exactly as they are, before the `$transaction`.)

- [ ] **Step 5: Run the test file to verify all tests pass (green)**

Run: `pnpm --filter @switchboard/db test -- riley-pause-flag-toggle`
Expected: PASS. All six tests green (four originals + two new guards).

- [ ] **Step 6: Run the per-commit gates**

Run, expecting each to pass:

- `pnpm --filter @switchboard/db exec tsc --noEmit`
- `pnpm --filter @switchboard/db test`
- `pnpm eval:riley`

- [ ] **Step 7: Scan the diff for em-dashes, then commit**

Run: `git diff --cached | perl -ne 'print "em-dash at line $.: $_" if /\x{2014}/'` (prints nothing when clean; rephrase any hit before committing).

```bash
git add packages/db/src/seed/riley-pause-flag-toggle.ts \
        packages/db/src/seed/riley-pause-flag-toggle.test.ts
git commit -m "fix(db): bind riley pause-flag flip to its audit row in one transaction (P3-2)"
```

---

### Task 2: Transactional flip + audit for the reallocate toggles (shared helper)

**Files:**

- Modify: `packages/db/src/seed/riley-reallocate-flag-toggle.ts` (wrap the flip + `ledger.record` in `prisma.$transaction` inside the shared `setRileyReallocateFlag` helper at `:50-74`)
- Test: `packages/db/src/seed/riley-reallocate-flag-toggle.test.ts` (add `$transaction` + a `tx` client to `mockPrisma`; widen `fakeLedger`; add an atomicity describe block)

**Interfaces:**

- Consumes: the widened `CapabilityAuditRecorder.record(params, options?: { tx?: unknown })` from Task 1 (imported via `import type { CapabilityAuditRecorder } from "./riley-pause-flag-toggle.js"`); `prisma.$transaction`; `ledger.record(params, { tx })`.
- Produces: no signature change. `setRileyReallocateKillSwitch` / `setRileyReallocateSelfExecution` keep `(prisma, ledger, args): Promise<{ previous: boolean; current: boolean }>`.

- [ ] **Step 1: Update `mockPrisma` + `fakeLedger`, then add the atomicity describe block (red)**

In `packages/db/src/seed/riley-reallocate-flag-toggle.test.ts`, replace `mockPrisma` and `fakeLedger` with:

```typescript
function mockPrisma(governanceSettings: Record<string, unknown> | null) {
  const update = vi.fn(async (_a: { where: unknown; data: unknown }) => ({}));
  const tx = { agentDeployment: { update } };
  const transaction = vi.fn(async (cb: (txc: typeof tx) => Promise<unknown>) => cb(tx));
  const prisma = {
    agentListing: { findUnique: vi.fn(async () => ({ id: "listing_1" })) },
    agentDeployment: {
      findUnique: vi.fn(async () => ({ id: "dep_1", governanceSettings })),
    },
    $transaction: transaction,
  };
  return { prisma: prisma as unknown as PrismaClient, update, tx, transaction };
}

function fakeLedger() {
  const record = vi.fn(
    async (_entry: Record<string, unknown>, _options?: { tx?: unknown }) => ({}),
  );
  return { ledger: { record }, record };
}
```

Then add a new describe block at the end of the file (after the `describe("setRileyReallocate* error paths", ...)` block):

```typescript
describe("setRileyReallocate* audit atomicity (P3-2)", () => {
  it("wraps the flip + audit write in one transaction and threads the tx into ledger.record", async () => {
    // Both reallocate toggles share setRileyReallocateFlag, so the kill switch
    // exercises the same transactional path the canary enable flag uses.
    const { prisma, update, tx, transaction } = mockPrisma({ trustLevelOverride: "autonomous" });
    const { ledger, record } = fakeLedger();
    await setRileyReallocateKillSwitch(prisma, ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "ops@x",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![1]?.tx).toBe(tx);
  });

  it("rejects out of the transaction when the audit write fails (flip rolls back)", async () => {
    // Proving the ledger error escapes setRileyReallocateSelfExecution proves
    // the flip + audit are bound: a ledger failure can never leave a reallocate
    // self-execution flag flipped with no audit row.
    const { prisma, update } = mockPrisma(null);
    const { ledger, record } = fakeLedger();
    record.mockRejectedValueOnce(new Error("ledger chain write failed"));
    await expect(
      setRileyReallocateSelfExecution(prisma, ledger, {
        organizationId: "org_1",
        enabled: true,
        actor: "ops@x",
      }),
    ).rejects.toThrow(/ledger chain write failed/);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test file to verify the new guards fail (red)**

Run: `pnpm --filter @switchboard/db test -- riley-reallocate-flag-toggle`
Expected: the two new tests FAIL (the current impl never calls `$transaction`, so `transaction` is uncalled and `record.mock.calls[0]![1]` is `undefined`). The existing tests still PASS.

- [ ] **Step 3: Wrap the flip + audit write in `prisma.$transaction` inside the shared helper**

In `packages/db/src/seed/riley-reallocate-flag-toggle.ts`, in `setRileyReallocateFlag`, replace the block from `await prisma.agentDeployment.update({...})` through the `await ledger.record({...})` call (currently `:50-74`) with:

```typescript
// Flip + audit row commit or roll back together: the audit chain-append joins
// this transaction (ledger.record({ tx }) -> appendAtomic({ externalTx })), so
// a ledger failure can never leave a money-move capability armed or disarmed
// with no audit row. Mirrors provisionOrgAgentDeployments + the platform's
// WorkTrace + AuditEntry binding.
await prisma.$transaction(async (tx) => {
  await tx.agentDeployment.update({
    where: { id: deployment.id },
    // Read-modify-write preserving every other governanceSettings key. The computed-key spread
    // widens to Record<string, unknown>; the stored governanceSettings is already JSON, so the cast
    // to the Prisma JSON input is sound (a literal-key spread would not need it, but the shared
    // helper does).
    data: {
      governanceSettings: { ...settings, [args.key]: args.enabled } as Prisma.InputJsonValue,
    },
  });
  await ledger.record(
    {
      eventType: "policy.updated",
      actorType: "user",
      actorId: args.actor,
      entityType: "deployment",
      entityId: deployment.id,
      riskCategory: "high",
      summary: `riley ${args.key}: ${previous} -> ${args.enabled} (org ${args.organizationId}, by ${args.actor})`,
      snapshot: {
        flag: args.key,
        previous,
        current: args.enabled,
        organizationId: args.organizationId,
        deploymentId: deployment.id,
      },
    },
    { tx },
  );
});
return { previous, current: args.enabled };
```

(The `const settings = ...` and `const previous = ...` lines immediately above stay as they are, before the `$transaction`. `Prisma` is already imported at the top of this file.)

- [ ] **Step 4: Run the test file to verify all tests pass (green)**

Run: `pnpm --filter @switchboard/db test -- riley-reallocate-flag-toggle`
Expected: PASS. All tests green (originals + the two new atomicity guards).

- [ ] **Step 5: Run the per-commit gates + cross-layer insurance**

Run, expecting each to pass:

- `pnpm --filter @switchboard/db exec tsc --noEmit`
- `pnpm --filter @switchboard/db test`
- `pnpm --filter @switchboard/api exec tsc --noEmit` (apps/api consumes the `@switchboard/db` barrel; confirms the widened interface is non-breaking)
- `pnpm eval:riley`

- [ ] **Step 6: Scan the diff for em-dashes, then commit**

Run: `git diff --cached | perl -ne 'print "em-dash at line $.: $_" if /\x{2014}/'` (prints nothing when clean; rephrase any hit before committing).

```bash
git add packages/db/src/seed/riley-reallocate-flag-toggle.ts \
        packages/db/src/seed/riley-reallocate-flag-toggle.test.ts
git commit -m "fix(db): bind riley reallocate-flag flips to their audit rows in one transaction (P3-2)"
```

---

## Self-Review

**1. Spec coverage:** Row P3-2 requires the capability-flag toggle to write its audit row atomically with the flip (no flip without an audit row). Task 1 binds the pause toggle; Task 2 binds both reallocate toggles via their shared helper. The gap-eval's directive to check the sibling reallocate/kill-switch toggles is satisfied by including them. Covered.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every step shows exact code and exact commands. Clean.

**3. Type consistency:** `CapabilityAuditRecorder.record` is widened once (Task 1) with an OPTIONAL `options?: { tx?: unknown }`; Task 2 consumes that exact signature. The real `AuditLedger.record(params, options?: { tx?: unknown })` and `PrismaLedgerStorage.appendAtomic(buildEntry, { externalTx })` already match, so the three CLI callers stay assignable without changes. `tx` is typed `unknown` end-to-end, so `@switchboard/db` does not import `@switchboard/core`. No public function signature changes; `setRiley*` return types are unchanged.
