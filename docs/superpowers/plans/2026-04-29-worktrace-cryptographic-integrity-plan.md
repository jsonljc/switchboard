# WorkTrace cryptographic integrity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pair every WorkTrace persist and update with an anchoring AuditEntry on the same Prisma transaction so tampering is detectable on read; fail closed at execution-admission boundaries.

**Architecture:** Approach D — anchored content-hash via AuditLedger. SHA-256 over canonical-JSON of WorkTrace fields (excluding `contentHash`, `traceVersion`, `lockedAt`); paired AuditEntry written transactionally via a new `externalTx` parameter on `LedgerStorage.appendAtomic`; new `AuditLedger.findAnchor` for deterministic version-exact anchor lookup. Reads return `WorkTraceReadResult = { trace, integrity }`; execution admission is fail-closed via `assertExecutionAdmissible`.

**Tech Stack:** TypeScript (ESM), pnpm + Turborepo, Prisma + PostgreSQL, vitest. Hashes via Node `crypto.createHash`. Canonical-JSON via existing `packages/core/src/audit/canonical-json.ts`.

**Spec:** `docs/superpowers/specs/2026-04-29-worktrace-cryptographic-integrity-design.md`

## Plan amendments to spec (discovered during exploration)

These are deviations from the spec discovered while reading the code. They are folded into the tasks below; the spec should be updated post-implementation:

1. **`NoopOperatorAlerter` already exists** at `packages/core/src/observability/operator-alerter.ts:23`. No new file. Spec said "NEW `src/observability/noop-operator-alerter.ts`" — that's already done. Tasks reference the existing class.
2. **Alert payload extends `InfrastructureErrorType`**, not a separate `kind: "work_trace_integrity"`. The existing `OperatorAlerter.alert(InfrastructureFailureAlert)` interface uses an `errorType` enum. Two new values: `"work_trace_integrity_mismatch"` and `"work_trace_integrity_missing_anchor"`. Reuses the existing alert plumbing.
3. **App bootstrap is single-site.** Only `apps/api/src/app.ts:416` constructs `PrismaWorkTraceStore`, and it already passes `auditLedger` + `operatorAlerter`. No app code change needed — only the constructor signature change ripples through. Test mocks need updating.

---

## Phase A — Foundations (additive, no callers broken)

### Task 1: Add new audit event types

**Files:**

- Modify: `packages/schemas/src/audit.ts`
- Modify: `packages/schemas/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing test**

In `packages/schemas/src/__tests__/schemas.test.ts`, add at the end (before the final closing of the relevant describe block, or in a new describe):

```ts
import { AuditEventTypeSchema } from "../audit.js";

describe("AuditEventTypeSchema — work trace integrity events", () => {
  it("accepts work_trace.persisted", () => {
    const result = AuditEventTypeSchema.safeParse("work_trace.persisted");
    expect(result.success).toBe(true);
  });
  it("accepts work_trace.updated", () => {
    const result = AuditEventTypeSchema.safeParse("work_trace.updated");
    expect(result.success).toBe(true);
  });
  it("accepts work_trace.integrity_override", () => {
    const result = AuditEventTypeSchema.safeParse("work_trace.integrity_override");
    expect(result.success).toBe(true);
  });
  it("still accepts an existing event type", () => {
    const result = AuditEventTypeSchema.safeParse("action.executed");
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- audit`
Expected: 3 new tests fail with safeParse `success: false`.

- [ ] **Step 3: Add the new event types to the enum**

In `packages/schemas/src/audit.ts`, extend `AuditEventTypeSchema`:

```ts
export const AuditEventTypeSchema = z.enum([
  "action.proposed",
  "action.resolved",
  "action.enriched",
  "action.evaluated",
  "action.approved",
  "action.partially_approved",
  "action.rejected",
  "action.patched",
  "action.queued",
  "action.executing",
  "action.snapshot",
  "action.executed",
  "action.failed",
  "action.denied",
  "action.expired",
  "action.cancelled",
  "action.undo_requested",
  "action.undo_executed",
  "action.approval_expired",
  "identity.created",
  "identity.updated",
  "overlay.activated",
  "overlay.deactivated",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "connection.established",
  "connection.revoked",
  "connection.degraded",
  "competence.promoted",
  "competence.demoted",
  "competence.updated",
  "delegation.chain_resolved",
  "entity.linked",
  "entity.unlinked",
  "entity.resolved",
  "event.published",
  "event.reaction.triggered",
  "event.reaction.created",
  "agent.activated",
  "agent.emergency-halted",
  "agent.resumed",
  "work_trace.persisted",
  "work_trace.updated",
  "work_trace.integrity_override",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- audit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/audit.ts packages/schemas/src/__tests__/schemas.test.ts
git commit -m "feat(schemas): add work_trace integrity audit event types"
```

---

### Task 2: Add new infrastructure error types

**Files:**

- Modify: `packages/core/src/observability/operator-alerter.ts`
- Modify: `packages/core/src/observability/__tests__/operator-alerter.test.ts` (only if a `errorType` enum test exists; otherwise no test change needed — the type is structural)

- [ ] **Step 1: Extend `InfrastructureErrorType`**

In `packages/core/src/observability/operator-alerter.ts`, replace lines 1-4:

```ts
export type InfrastructureErrorType =
  | "governance_eval_exception"
  | "trace_persist_failed"
  | "work_trace_locked_violation"
  | "work_trace_integrity_mismatch"
  | "work_trace_integrity_missing_anchor"
  | "integrity_check_unavailable";
```

- [ ] **Step 2: Run typecheck to confirm no breakage**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/observability/operator-alerter.ts
git commit -m "feat(core): add work_trace integrity infrastructure error types"
```

---

### Task 3: Extend `WorkTrace` interface with `contentHash` and `traceVersion`

**Files:**

- Modify: `packages/core/src/platform/work-trace.ts`

- [ ] **Step 1: Add fields to interface**

In `packages/core/src/platform/work-trace.ts`, append two fields after `lockedAt`:

```ts
export interface WorkTrace {
  workUnitId: string;
  traceId: string;
  parentWorkUnitId?: string;
  deploymentId?: string;
  intent: string;
  mode: ExecutionModeName;
  organizationId: string;
  actor: Actor;
  trigger: Trigger;
  idempotencyKey?: string;

  parameters?: Record<string, unknown>;
  deploymentContext?: DeploymentContext;

  governanceOutcome: "execute" | "require_approval" | "deny";
  riskScore: number;
  matchedPolicies: string[];
  governanceConstraints?: ExecutionConstraints;

  approvalId?: string;
  approvalOutcome?: "approved" | "rejected" | "patched" | "expired";
  approvalRespondedBy?: string;
  approvalRespondedAt?: string;

  outcome: WorkOutcome;
  durationMs: number;
  error?: ExecutionError;
  executionSummary?: string;
  executionOutputs?: Record<string, unknown>;

  modeMetrics?: Record<string, unknown>;
  requestedAt: string;
  governanceCompletedAt: string;
  executionStartedAt?: string;
  completedAt?: string;
  /**
   * Set automatically by the store when outcome transitions into a terminal value.
   * Once non-null, the trace is sealed: see work-trace-lock.ts for invariants.
   */
  lockedAt?: string;
  /**
   * SHA-256 of canonical-JSON of hash-included WorkTrace fields.
   * Set by the store on persist (v1) and every hash-relevant update (v+1).
   * Optional only because pre-migration reads return rows without it.
   */
  contentHash?: string;
  /**
   * Monotonic per workUnitId. 1 on persist; +1 per hash-relevant update.
   * 0 on pre-migration rows (treated as missing_anchor when contentHash is non-null).
   */
  traceVersion?: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS (additive, optional fields).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/platform/work-trace.ts
git commit -m "feat(core): add contentHash + traceVersion to WorkTrace interface"
```

---

### Task 4: Implement `work-trace-hash.ts`

**Files:**

- Create: `packages/core/src/platform/work-trace-hash.ts`
- Create: `packages/core/src/platform/__tests__/work-trace-hash.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/platform/__tests__/work-trace-hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WORK_TRACE_HASH_VERSION,
  WORK_TRACE_HASH_EXCLUDED_FIELDS,
  buildWorkTraceHashInput,
  computeWorkTraceContentHash,
} from "../work-trace-hash.js";
import type { WorkTrace } from "../work-trace.js";

function baseTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu_1",
    traceId: "tr_1",
    intent: "digital-ads.pause",
    mode: "cartridge",
    organizationId: "org_1",
    actor: { id: "user_1", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 10,
    matchedPolicies: ["P1"],
    outcome: "completed",
    durationMs: 100,
    requestedAt: "2026-04-29T10:00:00.000Z",
    governanceCompletedAt: "2026-04-29T10:00:00.050Z",
    ...overrides,
  };
}

describe("work-trace-hash", () => {
  it("WORK_TRACE_HASH_VERSION is 1", () => {
    expect(WORK_TRACE_HASH_VERSION).toBe(1);
  });

  it("excludes contentHash, traceVersion, lockedAt", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS).toEqual(
      expect.arrayContaining(["contentHash", "traceVersion", "lockedAt"]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS.length).toBe(3);
  });

  it("identical traces produce identical hashes", () => {
    const t = baseTrace();
    expect(computeWorkTraceContentHash(t, 1)).toBe(computeWorkTraceContentHash(t, 1));
  });

  it("hash input omits excluded fields even when present on the trace", () => {
    const t = baseTrace({
      contentHash: "ABC",
      traceVersion: 99,
      lockedAt: "2026-04-29T10:00:01.000Z",
    });
    const input = buildWorkTraceHashInput(t, 1);
    expect(input).not.toHaveProperty("contentHash");
    expect(input).not.toHaveProperty("traceVersion");
    expect(input).not.toHaveProperty("lockedAt");
  });

  it("changing contentHash does not change the hash (excluded)", () => {
    const a = baseTrace({ contentHash: "AAA" });
    const b = baseTrace({ contentHash: "BBB" });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });

  it("changing lockedAt does not change the hash (excluded)", () => {
    const a = baseTrace({ lockedAt: "2026-04-29T10:00:01.000Z" });
    const b = baseTrace({ lockedAt: "2026-04-29T10:00:02.000Z" });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });

  it("different traceVersion with same content produces different hash", () => {
    const t = baseTrace();
    expect(computeWorkTraceContentHash(t, 1)).not.toBe(computeWorkTraceContentHash(t, 2));
  });

  it("changing intent changes the hash", () => {
    const a = baseTrace({ intent: "x" });
    const b = baseTrace({ intent: "y" });
    expect(computeWorkTraceContentHash(a, 1)).not.toBe(computeWorkTraceContentHash(b, 1));
  });

  it("changing executionOutputs changes the hash", () => {
    const a = baseTrace({ executionOutputs: { foo: 1 } });
    const b = baseTrace({ executionOutputs: { foo: 2 } });
    expect(computeWorkTraceContentHash(a, 1)).not.toBe(computeWorkTraceContentHash(b, 1));
  });

  it("changing approvalOutcome changes the hash", () => {
    const a = baseTrace({ approvalOutcome: "approved" });
    const b = baseTrace({ approvalOutcome: "rejected" });
    expect(computeWorkTraceContentHash(a, 1)).not.toBe(computeWorkTraceContentHash(b, 1));
  });

  it("changing actor.id changes the hash (deep field)", () => {
    const a = baseTrace({ actor: { id: "u1", type: "user" } });
    const b = baseTrace({ actor: { id: "u2", type: "user" } });
    expect(computeWorkTraceContentHash(a, 1)).not.toBe(computeWorkTraceContentHash(b, 1));
  });

  it("undefined optional fields hash same as omitted", () => {
    const a = baseTrace();
    const b = baseTrace({ approvalId: undefined });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });

  it("buildWorkTraceHashInput includes hashVersion field", () => {
    const input = buildWorkTraceHashInput(baseTrace(), 1);
    expect(input).toHaveProperty("hashVersion", WORK_TRACE_HASH_VERSION);
  });

  it("buildWorkTraceHashInput includes traceVersion field", () => {
    const input = buildWorkTraceHashInput(baseTrace(), 7);
    expect(input).toHaveProperty("traceVersionForHash", 7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- work-trace-hash`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/platform/work-trace-hash.ts`:

```ts
import { canonicalizeSync } from "../audit/canonical-json.js";
import { sha256 } from "../audit/canonical-hash.js";
import type { WorkTrace } from "./work-trace.js";

export const WORK_TRACE_HASH_VERSION = 1;

export const WORK_TRACE_HASH_EXCLUDED_FIELDS = [
  "contentHash",
  "traceVersion",
  "lockedAt",
] as const satisfies readonly (keyof WorkTrace)[];

const EXCLUDED = new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS);

/**
 * Build the canonical-ready object hashed by computeWorkTraceContentHash.
 * Explicitly omits excluded fields rather than relying on canonicalizeSync's
 * undefined-skip — the exclusion is auditable from this one place.
 *
 * Includes `hashVersion` and `traceVersionForHash` so the hash binds the
 * algorithm version and the row version respectively. `traceVersionForHash`
 * is a separate name so it cannot collide with the WorkTrace.traceVersion
 * field that we're explicitly excluding.
 */
export function buildWorkTraceHashInput(
  trace: WorkTrace,
  traceVersion: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    hashVersion: WORK_TRACE_HASH_VERSION,
    traceVersionForHash: traceVersion,
  };
  for (const [key, value] of Object.entries(trace) as Array<[keyof WorkTrace, unknown]>) {
    if (EXCLUDED.has(key as string)) continue;
    out[key as string] = value;
  }
  return out;
}

export function computeWorkTraceContentHash(trace: WorkTrace, traceVersion: number): string {
  return sha256(canonicalizeSync(buildWorkTraceHashInput(trace, traceVersion)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- work-trace-hash`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/work-trace-hash.ts packages/core/src/platform/__tests__/work-trace-hash.test.ts
git commit -m "feat(core): add work-trace-hash module with deterministic content hashing"
```

---

### Task 5: Implement `work-trace-integrity.ts` (verifier + admission)

**Files:**

- Create: `packages/core/src/platform/work-trace-integrity.ts`
- Create: `packages/core/src/platform/__tests__/work-trace-integrity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/platform/__tests__/work-trace-integrity.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { AuditEntry } from "@switchboard/schemas";
import type { WorkTrace } from "../work-trace.js";
import { computeWorkTraceContentHash } from "../work-trace-hash.js";
import {
  verifyWorkTraceIntegrity,
  WorkTraceIntegrityError,
  assertExecutionAdmissible,
} from "../work-trace-integrity.js";

const CUTOFF = "2026-04-29T00:00:00.000Z";

function baseTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu_1",
    traceId: "tr_1",
    intent: "digital-ads.pause",
    mode: "cartridge",
    organizationId: "org_1",
    actor: { id: "u1", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 10,
    matchedPolicies: ["P1"],
    outcome: "completed",
    durationMs: 100,
    requestedAt: "2026-04-29T12:00:00.000Z",
    governanceCompletedAt: "2026-04-29T12:00:00.050Z",
    ...overrides,
  };
}

function makeAnchor(workUnitId: string, contentHash: string, traceVersion: number): AuditEntry {
  return {
    id: "audit_1",
    eventType: traceVersion === 1 ? "work_trace.persisted" : "work_trace.updated",
    timestamp: new Date(),
    actorType: "system",
    actorId: "store",
    entityType: "work_trace",
    entityId: workUnitId,
    riskCategory: "low",
    visibilityLevel: "system",
    summary: "x",
    snapshot: { workUnitId, traceVersion, contentHash, hashAlgorithm: "sha256", hashVersion: 1 },
    evidencePointers: [],
    redactionApplied: false,
    redactedFields: [],
    chainHashVersion: 1,
    schemaVersion: 1,
    entryHash: "hash",
    previousEntryHash: null,
    envelopeId: null,
    organizationId: null,
    traceId: null,
  };
}

describe("verifyWorkTraceIntegrity", () => {
  it("returns ok when hash recomputes correctly and anchor matches", () => {
    const trace = baseTrace();
    const hash = computeWorkTraceContentHash(trace, 1);
    const anchor = makeAnchor(trace.workUnitId, hash, 1);
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: hash,
      rowTraceVersion: 1,
      rowRequestedAt: trace.requestedAt,
      anchor,
      cutoffAt: CUTOFF,
    });
    expect(v.status).toBe("ok");
  });

  it("returns mismatch when stored hash differs from recomputed", () => {
    const trace = baseTrace();
    const hash = computeWorkTraceContentHash(trace, 1);
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: "deadbeef",
      rowTraceVersion: 1,
      rowRequestedAt: trace.requestedAt,
      anchor: makeAnchor(trace.workUnitId, hash, 1),
      cutoffAt: CUTOFF,
    });
    expect(v).toEqual({ status: "mismatch", expected: "deadbeef", actual: hash });
  });

  it("returns skipped pre_migration when contentHash null and requestedAt < cutoff", () => {
    const trace = baseTrace({ requestedAt: "2026-04-28T12:00:00.000Z" });
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: null,
      rowTraceVersion: 0,
      rowRequestedAt: trace.requestedAt,
      anchor: null,
      cutoffAt: CUTOFF,
    });
    expect(v).toEqual({ status: "skipped", reason: "pre_migration" });
  });

  it("returns missing_anchor when contentHash null and requestedAt >= cutoff", () => {
    const trace = baseTrace({ requestedAt: "2026-04-30T12:00:00.000Z" });
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: null,
      rowTraceVersion: 0,
      rowRequestedAt: trace.requestedAt,
      anchor: null,
      cutoffAt: CUTOFF,
    });
    expect(v.status).toBe("missing_anchor");
  });

  it("returns missing_anchor when contentHash present but anchor is null", () => {
    const trace = baseTrace();
    const hash = computeWorkTraceContentHash(trace, 1);
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: hash,
      rowTraceVersion: 1,
      rowRequestedAt: trace.requestedAt,
      anchor: null,
      cutoffAt: CUTOFF,
    });
    expect(v).toEqual({ status: "missing_anchor", expectedAtVersion: 1 });
  });

  it("returns missing_anchor when anchor.snapshot.contentHash differs from row.contentHash", () => {
    const trace = baseTrace();
    const hash = computeWorkTraceContentHash(trace, 1);
    const v = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: hash,
      rowTraceVersion: 1,
      rowRequestedAt: trace.requestedAt,
      anchor: makeAnchor(trace.workUnitId, "different-hash", 1),
      cutoffAt: CUTOFF,
    });
    expect(v.status).toBe("missing_anchor");
  });

  describe("traceVersion <= 0 invariant", () => {
    it.each([0, -1])(
      "returns missing_anchor when traceVersion is %i and contentHash is present",
      (v) => {
        const trace = baseTrace();
        const hash = computeWorkTraceContentHash(trace, 1);
        const verdict = verifyWorkTraceIntegrity({
          trace,
          rowContentHash: hash,
          rowTraceVersion: v,
          rowRequestedAt: trace.requestedAt,
          anchor: makeAnchor(trace.workUnitId, hash, 1),
          cutoffAt: CUTOFF,
        });
        expect(verdict.status).toBe("missing_anchor");
      },
    );
  });
});

describe("assertExecutionAdmissible", () => {
  const trace = baseTrace();

  it("returns when verdict is ok", async () => {
    await expect(
      assertExecutionAdmissible({ trace, integrity: { status: "ok" } }),
    ).resolves.toBeUndefined();
  });

  it("throws WorkTraceIntegrityError on mismatch without override", async () => {
    await expect(
      assertExecutionAdmissible({
        trace,
        integrity: { status: "mismatch", expected: "a", actual: "b" },
      }),
    ).rejects.toThrow(WorkTraceIntegrityError);
  });

  it("throws on missing_anchor without override", async () => {
    await expect(
      assertExecutionAdmissible({
        trace,
        integrity: { status: "missing_anchor", expectedAtVersion: 1 },
      }),
    ).rejects.toThrow(WorkTraceIntegrityError);
  });

  it("throws on skipped without override", async () => {
    await expect(
      assertExecutionAdmissible({
        trace,
        integrity: { status: "skipped", reason: "pre_migration" },
      }),
    ).rejects.toThrow(WorkTraceIntegrityError);
  });

  it("admits with override and records work_trace.integrity_override AuditEntry", async () => {
    const ledger = { record: vi.fn().mockResolvedValue({}) };
    await assertExecutionAdmissible({
      trace,
      integrity: { status: "mismatch", expected: "a", actual: "b" },
      override: {
        actorId: "alice",
        reason: "manual review",
        overrideAt: "2026-04-29T13:00:00.000Z",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auditLedger: ledger as any,
    });
    expect(ledger.record).toHaveBeenCalledTimes(1);
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "work_trace.integrity_override",
        actorType: "user",
        actorId: "alice",
        entityType: "work_trace",
        entityId: trace.workUnitId,
        snapshot: expect.objectContaining({
          workUnitId: trace.workUnitId,
          integrityStatus: "mismatch",
          reason: "manual review",
        }),
      }),
    );
  });

  it("throws when override is provided but auditLedger is missing", async () => {
    await expect(
      assertExecutionAdmissible({
        trace,
        integrity: { status: "mismatch", expected: "a", actual: "b" },
        override: { actorId: "alice", reason: "x", overrideAt: "2026-04-29T13:00:00.000Z" },
      }),
    ).rejects.toThrow(/auditLedger/);
  });

  it("ok verdict with override does not record an override audit", async () => {
    const ledger = { record: vi.fn().mockResolvedValue({}) };
    await assertExecutionAdmissible({
      trace,
      integrity: { status: "ok" },
      override: { actorId: "alice", reason: "x", overrideAt: "2026-04-29T13:00:00.000Z" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auditLedger: ledger as any,
    });
    expect(ledger.record).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- work-trace-integrity`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/platform/work-trace-integrity.ts`:

```ts
import type { AuditEntry } from "@switchboard/schemas";
import type { WorkTrace } from "./work-trace.js";
import { computeWorkTraceContentHash } from "./work-trace-hash.js";
import type { AuditLedger } from "../audit/ledger.js";

export type IntegrityVerdict =
  | { status: "ok" }
  | { status: "mismatch"; expected: string; actual: string }
  | { status: "missing_anchor"; expectedAtVersion: number }
  | { status: "skipped"; reason: "pre_migration" };

export interface IntegrityOverride {
  actorId: string;
  reason: string;
  overrideAt: string;
}

export class WorkTraceIntegrityError extends Error {
  constructor(
    public readonly verdict: IntegrityVerdict,
    public readonly workUnitId: string,
  ) {
    super(`WorkTrace integrity check failed for ${workUnitId}: ${verdict.status}`);
    this.name = "WorkTraceIntegrityError";
  }
}

export function getString(snapshot: Record<string, unknown>, key: string): string | undefined {
  const v = snapshot[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(snapshot: Record<string, unknown>, key: string): number | undefined {
  const v = snapshot[key];
  return typeof v === "number" ? v : undefined;
}

export interface VerifyParams {
  trace: WorkTrace;
  rowContentHash: string | null;
  rowTraceVersion: number;
  rowRequestedAt: string;
  anchor: AuditEntry | null;
  cutoffAt: string;
}

export function verifyWorkTraceIntegrity(params: VerifyParams): IntegrityVerdict {
  const { trace, rowContentHash, rowTraceVersion, rowRequestedAt, anchor, cutoffAt } = params;

  if (rowContentHash === null) {
    if (rowRequestedAt < cutoffAt) {
      return { status: "skipped", reason: "pre_migration" };
    }
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  // Invariant: contentHash present but version <= 0 — never trust as ok.
  if (rowTraceVersion <= 0) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  const recomputed = computeWorkTraceContentHash(trace, rowTraceVersion);
  if (recomputed !== rowContentHash) {
    return { status: "mismatch", expected: rowContentHash, actual: recomputed };
  }

  if (!anchor) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  const anchorHash = getString(anchor.snapshot, "contentHash");
  const anchorVersion = getNumber(anchor.snapshot, "traceVersion");
  if (anchorHash !== rowContentHash || anchorVersion !== rowTraceVersion) {
    return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
  }

  return { status: "ok" };
}

export interface AssertParams {
  trace: WorkTrace;
  integrity: IntegrityVerdict;
  override?: IntegrityOverride;
  auditLedger?: AuditLedger;
}

export async function assertExecutionAdmissible(params: AssertParams): Promise<void> {
  const { trace, integrity, override, auditLedger } = params;
  if (integrity.status === "ok") return;

  if (!override) {
    throw new WorkTraceIntegrityError(integrity, trace.workUnitId);
  }
  if (!auditLedger) {
    throw new Error(
      "assertExecutionAdmissible: override path requires auditLedger to record decision",
    );
  }

  await auditLedger.record({
    eventType: "work_trace.integrity_override",
    actorType: "user",
    actorId: override.actorId,
    entityType: "work_trace",
    entityId: trace.workUnitId,
    riskCategory: "high",
    visibilityLevel: "admin",
    summary: `Integrity override (${integrity.status}) by ${override.actorId}: ${override.reason}`,
    organizationId: trace.organizationId,
    traceId: trace.traceId,
    snapshot: {
      workUnitId: trace.workUnitId,
      integrityStatus: integrity.status,
      reason: override.reason,
      overrideAt: override.overrideAt,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- work-trace-integrity`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/work-trace-integrity.ts packages/core/src/platform/__tests__/work-trace-integrity.test.ts
git commit -m "feat(core): add work-trace-integrity verifier and admission helper"
```

---

### Task 6: Add `externalTx` parameter to `LedgerStorage.appendAtomic`

**Files:**

- Modify: `packages/core/src/audit/ledger.ts`
- Create: `packages/core/src/audit/__tests__/ledger-external-tx.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/audit/__tests__/ledger-external-tx.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AuditLedger, InMemoryLedgerStorage } from "../ledger.js";

describe("AuditLedger external-tx forwarding", () => {
  it("forwards options.tx to appendAtomic", async () => {
    const externalTx = { marker: "outer" };
    const storage = new InMemoryLedgerStorage();
    const spy = vi.spyOn(storage, "appendAtomic");
    const ledger = new AuditLedger(storage);

    await ledger.record(
      {
        eventType: "action.executed",
        actorType: "system",
        actorId: "x",
        entityType: "test",
        entityId: "e1",
        riskCategory: "low",
        summary: "s",
        snapshot: {},
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { tx: externalTx as any },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), { externalTx });
  });

  it("InMemoryLedgerStorage.appendAtomic ignores externalTx and behaves identically", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    await ledger.record({
      eventType: "action.executed",
      actorType: "system",
      actorId: "x",
      entityType: "test",
      entityId: "e1",
      riskCategory: "low",
      summary: "s",
      snapshot: {},
    });
    await ledger.record(
      {
        eventType: "action.executed",
        actorType: "system",
        actorId: "x",
        entityType: "test",
        entityId: "e2",
        riskCategory: "low",
        summary: "s",
        snapshot: {},
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { tx: { irrelevant: true } as any },
    );

    const all = storage.getAll();
    expect(all).toHaveLength(2);
    expect(all[1]!.previousEntryHash).toBe(all[0]!.entryHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- ledger-external-tx`
Expected: FAIL — `record(..., options)` not yet supported.

- [ ] **Step 3: Update `ledger.ts` to plumb `externalTx`**

In `packages/core/src/audit/ledger.ts`:

Replace the `LedgerStorage` interface:

```ts
export interface LedgerStorage {
  append(entry: AuditEntry): Promise<void>;
  getLatest(): Promise<AuditEntry | null>;
  getById(id: string): Promise<AuditEntry | null>;
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
  /**
   * Optional: atomically get latest + append within a serialized lock.
   * Prevents race conditions on previousEntryHash in multi-instance deployments.
   * If options.externalTx is provided, the storage MUST run the chain append
   * on that transaction rather than opening its own. This lets callers join
   * the audit write to a parent transaction (e.g. WorkTrace + AuditEntry).
   * If not implemented, AuditLedger falls back to non-atomic getLatest() + append().
   */
  appendAtomic?(
    buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>,
    options?: { externalTx?: unknown },
  ): Promise<AuditEntry>;
}
```

Replace the `record` method on `AuditLedger`:

```ts
  async record(
    params: {
      eventType: AuditEventType;
      actorType: ActorType;
      actorId: string;
      entityType: string;
      entityId: string;
      riskCategory: RiskCategory;
      summary: string;
      snapshot: Record<string, unknown>;
      evidence?: unknown[];
      envelopeId?: string;
      organizationId?: string;
      visibilityLevel?: VisibilityLevel;
      /** Optional correlation id; not part of chain hash. */
      traceId?: string | null;
    },
    options?: { tx?: unknown },
  ): Promise<AuditEntry> {
    if (this.storage.appendAtomic) {
      return this.storage.appendAtomic(
        (previousEntryHash) => this.buildEntry(params, previousEntryHash),
        options?.tx !== undefined ? { externalTx: options.tx } : undefined,
      );
    }

    const latest = await this.storage.getLatest();
    const previousEntryHash = latest?.entryHash ?? null;
    const entry = await this.buildEntry(params, previousEntryHash);
    await this.storage.append(entry);
    return entry;
  }
```

Update `InMemoryLedgerStorage` to add `appendAtomic` (currently absent):

```ts
  async appendAtomic(
    buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>,
    _options?: { externalTx?: unknown },
  ): Promise<AuditEntry> {
    const latest = this.entries[this.entries.length - 1] ?? null;
    const entry = await buildEntry(latest?.entryHash ?? null);
    this.entries.push(entry);
    return entry;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- ledger-external-tx`
Expected: All tests pass.

- [ ] **Step 5: Run full audit-related tests for regression check**

Run: `pnpm --filter @switchboard/core test -- audit`
Expected: All existing audit tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/audit/ledger.ts packages/core/src/audit/__tests__/ledger-external-tx.test.ts
git commit -m "feat(core): add externalTx option to AuditLedger.record / appendAtomic"
```

---

### Task 7: Add `AuditLedger.findAnchor` + `LedgerStorage.findBySnapshotField`

**Files:**

- Modify: `packages/core/src/audit/ledger.ts`
- Create: `packages/core/src/audit/__tests__/ledger-find-anchor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/audit/__tests__/ledger-find-anchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AuditLedger, InMemoryLedgerStorage } from "../ledger.js";

async function recordAnchor(
  ledger: AuditLedger,
  workUnitId: string,
  contentHash: string,
  traceVersion: number,
  eventType: "work_trace.persisted" | "work_trace.updated",
) {
  return ledger.record({
    eventType,
    actorType: "system",
    actorId: "store",
    entityType: "work_trace",
    entityId: workUnitId,
    riskCategory: "low",
    summary: `WorkTrace ${workUnitId} v${traceVersion}`,
    snapshot: { workUnitId, traceVersion, contentHash, hashAlgorithm: "sha256", hashVersion: 1 },
  });
}

describe("AuditLedger.findAnchor", () => {
  it("returns the entry whose snapshot.traceVersion matches", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    await recordAnchor(ledger, "wu_1", "h2", 2, "work_trace.updated");
    await recordAnchor(ledger, "wu_1", "h3", 3, "work_trace.updated");

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["contentHash"]).toBe("h2");
    expect(anchor!.snapshot["traceVersion"]).toBe(2);
  });

  it("returns null when no entry has the requested traceVersion", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 5,
    });
    expect(anchor).toBeNull();
  });

  it("disambiguates entries with same entityId but different eventType", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    await recordAnchor(ledger, "wu_1", "h2", 2, "work_trace.updated");

    const persistAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(persistAnchor!.snapshot["contentHash"]).toBe("h1");

    const updateAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(updateAnchor!.snapshot["contentHash"]).toBe("h2");
  });

  it("locates traceVersion 1 even after 200 sequential updates", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    for (let v = 2; v <= 200; v++) {
      await recordAnchor(ledger, "wu_1", `h${v}`, v, "work_trace.updated");
    }

    const persistAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(persistAnchor).not.toBeNull();
    expect(persistAnchor!.snapshot["traceVersion"]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- ledger-find-anchor`
Expected: FAIL — `findAnchor` is not a method.

- [ ] **Step 3: Add `findAnchor` to `AuditLedger` and storage interfaces**

In `packages/core/src/audit/ledger.ts`:

Extend the `LedgerStorage` interface:

```ts
export interface LedgerStorage {
  append(entry: AuditEntry): Promise<void>;
  getLatest(): Promise<AuditEntry | null>;
  getById(id: string): Promise<AuditEntry | null>;
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
  appendAtomic?(
    buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>,
    options?: { externalTx?: unknown },
  ): Promise<AuditEntry>;
  /**
   * Optional capability: deterministic version-exact anchor lookup.
   * Returns the AuditEntry matching entityType + entityId + eventType
   * whose snapshot has the specified field set to the specified value.
   * Implementations MUST NOT impose an arbitrary result limit — the
   * lookup must succeed regardless of how many entries exist for the
   * (entityType, entityId, eventType) tuple.
   */
  findBySnapshotField?(params: {
    entityType: string;
    entityId: string;
    eventType: string;
    field: string;
    value: unknown;
  }): Promise<AuditEntry | null>;
}
```

Add a `findAnchor` method on `AuditLedger`:

```ts
  async findAnchor(params: {
    entityType: string;
    entityId: string;
    eventType: AuditEventType;
    traceVersion: number;
  }): Promise<AuditEntry | null> {
    if (this.storage.findBySnapshotField) {
      return this.storage.findBySnapshotField({
        entityType: params.entityType,
        entityId: params.entityId,
        eventType: params.eventType,
        field: "traceVersion",
        value: params.traceVersion,
      });
    }
    // Fallback: query then in-memory filter. No arbitrary limit.
    const entries = await this.storage.query({
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
    });
    return (
      entries.find((e) => {
        const v = e.snapshot["traceVersion"];
        return typeof v === "number" && v === params.traceVersion;
      }) ?? null
    );
  }
```

Add `findBySnapshotField` to `InMemoryLedgerStorage`:

```ts
  async findBySnapshotField(params: {
    entityType: string;
    entityId: string;
    eventType: string;
    field: string;
    value: unknown;
  }): Promise<AuditEntry | null> {
    return (
      this.entries.find(
        (e) =>
          e.entityType === params.entityType &&
          e.entityId === params.entityId &&
          e.eventType === params.eventType &&
          e.snapshot[params.field] === params.value,
      ) ?? null
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- ledger-find-anchor`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/audit/ledger.ts packages/core/src/audit/__tests__/ledger-find-anchor.test.ts
git commit -m "feat(core): add AuditLedger.findAnchor for version-exact anchor lookup"
```

---

## Phase B — Schema migration

### Task 8: Add `contentHash` and `traceVersion` to Prisma `WorkTrace` model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_worktrace_integrity/migration.sql`

- [ ] **Step 1: Edit the Prisma schema**

In `packages/db/prisma/schema.prisma`, in the `WorkTrace` model (around line 1611), add the two columns immediately after `lockedAt`:

```prisma
  lockedAt              DateTime?
  contentHash           String?
  traceVersion          Int       @default(0)

  @@index([organizationId, intent])
  @@index([traceId])
  @@index([requestedAt])
  @@index([approvalId])
}
```

- [ ] **Step 2: Generate the migration**

Ensure your local Postgres is running and `DATABASE_URL` is set, then:

Run: `cd packages/db && pnpm prisma migrate dev --name add_worktrace_integrity --create-only`
Expected: A new directory `prisma/migrations/<timestamp>_add_worktrace_integrity/migration.sql` is created with `ALTER TABLE "WorkTrace"` adding `contentHash TEXT` and `traceVersion INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 3: Inspect the generated SQL**

Open the new `migration.sql`. Confirm it contains roughly:

```sql
ALTER TABLE "WorkTrace" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "WorkTrace" ADD COLUMN "traceVersion" INTEGER NOT NULL DEFAULT 0;
```

If the diff includes anything else, abort and inspect the schema for unrelated drift.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: migration applies cleanly.

- [ ] **Step 5: Regenerate Prisma client and rebuild lower-layer artifacts**

Run: `pnpm reset`
Expected: Clean build of schemas → core → db.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add contentHash + traceVersion columns to WorkTrace"
```

---

### Task 9: Add `WORK_TRACE_INTEGRITY_CUTOFF_AT` constant

**Files:**

- Create: `packages/db/src/integrity-cutoff.ts`
- Modify: `packages/db/src/index.ts` (re-export)

- [ ] **Step 1: Create the constant**

Create `packages/db/src/integrity-cutoff.ts`. Use the migration timestamp from Task 8 as the literal value (replace `<TIMESTAMP_FROM_MIGRATION_DIR>` with the actual `YYYYMMDDhhmmss` portion of the directory name, formatted as ISO):

```ts
/**
 * The instant at which WorkTrace integrity hashing went live.
 *
 * This is the **migration commit timestamp**, baked in as a literal string,
 * not derived at runtime from when the migration ran. That makes the cutoff
 * deterministic across dev / staging / prod regardless of when each
 * environment migrates.
 *
 * Verification semantics:
 * - Rows with `requestedAt < CUTOFF_AT` AND `contentHash IS NULL`
 *   → integrity verdict "skipped" reason "pre_migration"
 * - Rows with `requestedAt >= CUTOFF_AT` AND `contentHash IS NULL`
 *   → integrity verdict "missing_anchor" + alert
 *
 * Execution admission rejects "skipped" unconditionally. Pre-migration
 * traces are read-visible but cannot drive new external effects.
 */
export const WORK_TRACE_INTEGRITY_CUTOFF_AT = "<TIMESTAMP_FROM_MIGRATION_DIR_AS_ISO>";
```

Determine the ISO value: if the migration directory is `20260429T143000_add_worktrace_integrity`, the constant is `"2026-04-29T14:30:00.000Z"`.

- [ ] **Step 2: Re-export from db package index**

In `packages/db/src/index.ts`, add:

```ts
export { WORK_TRACE_INTEGRITY_CUTOFF_AT } from "./integrity-cutoff.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/integrity-cutoff.ts packages/db/src/index.ts
git commit -m "feat(db): add WORK_TRACE_INTEGRITY_CUTOFF_AT constant"
```

---

## Phase C — Store rewrite (interface change + Prisma implementation)

### Task 10: Change `WorkTraceStore` read interface to return `WorkTraceReadResult`

This task introduces the breaking interface change. Subsequent tasks update implementations and callers.

**Files:**

- Modify: `packages/core/src/platform/work-trace-recorder.ts`
- Modify: `packages/core/src/platform/index.ts` (re-export new types)

- [ ] **Step 1: Update the interface**

In `packages/core/src/platform/work-trace-recorder.ts`, replace the `WorkTraceStore` interface and add the new result type:

```ts
import type { WorkTrace } from "./work-trace.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { IntegrityVerdict } from "./work-trace-integrity.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
}

export type WorkTraceUpdateResult =
  | { ok: true; trace: WorkTrace }
  | { ok: false; code: "WORK_TRACE_LOCKED"; traceUnchanged: true; reason: string };

export interface WorkTraceReadResult {
  trace: WorkTrace;
  integrity: IntegrityVerdict;
}

export interface WorkTraceStore {
  persist(trace: WorkTrace): Promise<void>;
  getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null>;
  update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string },
  ): Promise<WorkTraceUpdateResult>;
  getByIdempotencyKey(key: string): Promise<WorkTraceReadResult | null>;
}

// buildWorkTrace unchanged — keep the existing function body below.
```

- [ ] **Step 2: Re-export new types from platform index**

In `packages/core/src/platform/index.ts`, add re-exports for `WorkTraceReadResult`, `IntegrityVerdict`, `WorkTraceIntegrityError`, `assertExecutionAdmissible`, `IntegrityOverride`. Locate the existing re-exports and add:

```ts
export type { WorkTraceReadResult } from "./work-trace-recorder.js";
export {
  WorkTraceIntegrityError,
  assertExecutionAdmissible,
  verifyWorkTraceIntegrity,
} from "./work-trace-integrity.js";
export type { IntegrityVerdict, IntegrityOverride } from "./work-trace-integrity.js";
export {
  WORK_TRACE_HASH_VERSION,
  WORK_TRACE_HASH_EXCLUDED_FIELDS,
  computeWorkTraceContentHash,
  buildWorkTraceHashInput,
} from "./work-trace-hash.js";
```

- [ ] **Step 3: Run typecheck — expect failures across callers**

Run: `pnpm typecheck`
Expected: TYPE ERRORS in:

- `packages/db/src/stores/prisma-work-trace-store.ts` (`getByWorkUnitId` / `getByIdempotencyKey` return type mismatch)
- `packages/core/src/platform/platform-lifecycle.ts:87, :285` (consumes the old shape)
- `packages/core/src/platform/platform-ingress.ts:95` (idempotency check)
- `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` (mocks)
- `packages/core/src/platform/__tests__/*.test.ts` (test mocks of WorkTraceStore)
- `packages/core/src/__tests__/*.test.ts` (test mocks)
- `apps/api/src/app.ts:489-491` (null-fallback mock)
- `apps/api/src/routes/approvals.ts:343` (read consumer)

**Do not commit yet.** The failures are the contract — Tasks 11-15 fix them.

---

### Task 11: PrismaWorkTraceStore — required deps + atomic persist

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`

- [ ] **Step 1: Tighten the constructor signature and update `persist`**

Replace the top of `packages/db/src/stores/prisma-work-trace-store.ts` through the end of `persist()`:

```ts
import type { PrismaClient } from "@prisma/client";
import type {
  WorkTrace,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceLockDiagnostic,
  WorkTraceReadResult,
} from "@switchboard/core/platform";
import {
  validateUpdate,
  WorkTraceLockedError,
  computeWorkTraceContentHash,
  verifyWorkTraceIntegrity,
} from "@switchboard/core/platform";
import type { AuditLedger, OperatorAlerter } from "@switchboard/core";
import {
  buildInfrastructureFailureAuditParams,
  safeAlert,
} from "@switchboard/core";
import type { InfrastructureFailureAlert } from "@switchboard/core";
import { WORK_TRACE_INTEGRITY_CUTOFF_AT } from "../integrity-cutoff.js";

export interface PrismaWorkTraceStoreConfig {
  auditLedger: AuditLedger;
  operatorAlerter: OperatorAlerter;
}

export class PrismaWorkTraceStore implements WorkTraceStore {
  private readonly auditLedger: AuditLedger;
  private readonly operatorAlerter: OperatorAlerter;

  constructor(
    private readonly prisma: PrismaClient,
    config: PrismaWorkTraceStoreConfig,
  ) {
    if (!config || !config.auditLedger || !config.operatorAlerter) {
      throw new Error(
        "PrismaWorkTraceStore requires auditLedger and operatorAlerter",
      );
    }
    this.auditLedger = config.auditLedger;
    this.operatorAlerter = config.operatorAlerter;
  }

  async persist(trace: WorkTrace): Promise<void> {
    const traceVersion = 1;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workTrace.create({
          data: {
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
            deploymentContext: trace.deploymentContext
              ? JSON.stringify(trace.deploymentContext)
              : null,

            governanceOutcome: trace.governanceOutcome,
            riskScore: trace.riskScore,
            matchedPolicies: JSON.stringify(trace.matchedPolicies),
            governanceConstraints: trace.governanceConstraints
              ? JSON.stringify(trace.governanceConstraints)
              : null,

            approvalId: trace.approvalId ?? null,
            approvalOutcome: trace.approvalOutcome ?? null,
            approvalRespondedBy: trace.approvalRespondedBy ?? null,
            approvalRespondedAt: trace.approvalRespondedAt
              ? new Date(trace.approvalRespondedAt)
              : null,

            outcome: trace.outcome,
            durationMs: trace.durationMs,
            errorCode: trace.error?.code ?? null,
            errorMessage: trace.error?.message ?? null,
            executionSummary: trace.executionSummary ?? null,
            executionOutputs: trace.executionOutputs
              ? JSON.stringify(trace.executionOutputs)
              : null,

            modeMetrics: trace.modeMetrics ? JSON.stringify(trace.modeMetrics) : null,
            requestedAt: new Date(trace.requestedAt),
            governanceCompletedAt: new Date(trace.governanceCompletedAt),
            executionStartedAt: trace.executionStartedAt
              ? new Date(trace.executionStartedAt)
              : null,
            idempotencyKey: trace.idempotencyKey ?? null,
            completedAt: trace.completedAt ? new Date(trace.completedAt) : null,
            contentHash,
            traceVersion,
          },
        });

        await this.auditLedger.record(
          {
            eventType: "work_trace.persisted",
            actorType: trace.actor.type,
            actorId: trace.actor.id,
            entityType: "work_trace",
            entityId: trace.workUnitId,
            riskCategory: "low",
            visibilityLevel: "system",
            summary: `WorkTrace ${trace.workUnitId} persisted at v${traceVersion}`,
            organizationId: trace.organizationId,
            traceId: trace.traceId,
            snapshot: {
              workUnitId: trace.workUnitId,
              traceId: trace.traceId,
              contentHash,
              traceVersion,
              hashAlgorithm: "sha256",
              hashVersion: 1,
            },
          },
          { tx },
        );
      });
    } catch (err: unknown) {
      if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
        return;
      }
      throw err;
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    );
  }
```

Keep the existing `mapRowToTrace` function below, but extend it to populate `contentHash` and `traceVersion` (next task wires the read methods, but we update the mapper now since it's used by `update` too):

In the existing `mapRowToTrace` (around the bottom of the existing file), append the two new fields just before the closing `};`:

```ts
      lockedAt: row.lockedAt?.toISOString(),
      contentHash: row.contentHash ?? undefined,
      traceVersion: row.traceVersion ?? undefined,
    };
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: Still failing on `getByWorkUnitId`, `getByIdempotencyKey`, `update` — those are the next tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/prisma-work-trace-store.ts
git commit -m "feat(db): WorkTraceStore persist writes paired AuditEntry atomically"
```

---

### Task 12: PrismaWorkTraceStore — atomic update with paired anchor

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`

- [ ] **Step 1: Replace the `update` method**

In `packages/db/src/stores/prisma-work-trace-store.ts`, replace the entire `update` method:

```ts
  async update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string },
  ): Promise<WorkTraceUpdateResult> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.workTrace.findUnique({ where: { workUnitId } });
      if (!row) {
        throw new Error(`WorkTrace not found: ${workUnitId}`);
      }
      const current = this.mapRowToTrace(row);
      const validation = validateUpdate({
        current,
        update: fields,
        caller: options?.caller,
      });
      if (!validation.ok) {
        await this.handleViolation(validation.diagnostic);
        if (process.env.NODE_ENV !== "production") {
          throw new WorkTraceLockedError(validation.diagnostic);
        }
        return {
          ok: false as const,
          code: "WORK_TRACE_LOCKED" as const,
          traceUnchanged: true as const,
          reason: validation.diagnostic.reason,
        };
      }

      const data: Record<string, unknown> = {};
      if (fields.outcome !== undefined) data.outcome = fields.outcome;
      if (fields.durationMs !== undefined) data.durationMs = fields.durationMs;
      if (fields.error !== undefined) {
        data.errorCode = fields.error?.code ?? null;
        data.errorMessage = fields.error?.message ?? null;
      }
      if (fields.executionSummary !== undefined) data.executionSummary = fields.executionSummary;
      if (fields.executionOutputs !== undefined)
        data.executionOutputs = JSON.stringify(fields.executionOutputs);
      if (fields.executionStartedAt !== undefined)
        data.executionStartedAt = new Date(fields.executionStartedAt);
      if (fields.completedAt !== undefined) data.completedAt = new Date(fields.completedAt);
      if (fields.approvalId !== undefined) data.approvalId = fields.approvalId;
      if (fields.approvalOutcome !== undefined) data.approvalOutcome = fields.approvalOutcome;
      if (fields.approvalRespondedBy !== undefined)
        data.approvalRespondedBy = fields.approvalRespondedBy;
      if (fields.approvalRespondedAt !== undefined)
        data.approvalRespondedAt = new Date(fields.approvalRespondedAt);
      if (fields.modeMetrics !== undefined) data.modeMetrics = JSON.stringify(fields.modeMetrics);
      if (fields.parameters !== undefined) data.parameters = JSON.stringify(fields.parameters);

      if (validation.computedLockedAt !== null) {
        data.lockedAt = new Date(validation.computedLockedAt);
      }

      // Hash-relevance check: lockedAt is excluded from the hash, so a
      // lockedAt-only write does not bump version or anchor.
      const hashRelevantKeys = Object.keys(data).filter(
        (k) => k !== "lockedAt" && k !== "contentHash" && k !== "traceVersion",
      );

      if (hashRelevantKeys.length === 0) {
        if (Object.keys(data).length === 0) {
          // No-op: caller passed no actionable fields.
          return { ok: true as const, trace: this.mapRowToTrace(row) };
        }
        // lockedAt-only: persist the lock, skip version bump + anchor.
        const updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });
        return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
      }

      const previousVersion = row.traceVersion ?? 0;
      const nextVersion = previousVersion + 1;

      // Build merged trace to compute the new hash. Apply update fields onto
      // current, then recompute. lockedAt is excluded by the hash function.
      const merged: WorkTrace = { ...current, ...fields };
      const nextHash = computeWorkTraceContentHash(merged, nextVersion);

      data.contentHash = nextHash;
      data.traceVersion = nextVersion;

      const updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });

      await this.auditLedger.record(
        {
          eventType: "work_trace.updated",
          actorType: "system",
          actorId: options?.caller ?? "unknown",
          entityType: "work_trace",
          entityId: workUnitId,
          riskCategory: "low",
          visibilityLevel: "system",
          summary: `WorkTrace ${workUnitId} updated to v${nextVersion}`,
          organizationId: current.organizationId,
          traceId: current.traceId,
          snapshot: {
            workUnitId,
            traceId: current.traceId,
            contentHash: nextHash,
            traceVersion: nextVersion,
            previousHash: row.contentHash ?? null,
            previousVersion,
            changedFields: hashRelevantKeys,
            hashAlgorithm: "sha256",
            hashVersion: 1,
          },
        },
        { tx },
      );

      return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: Still failing on `getByWorkUnitId` / `getByIdempotencyKey` (next task).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/prisma-work-trace-store.ts
git commit -m "feat(db): WorkTraceStore update writes paired AuditEntry atomically"
```

---

### Task 13: PrismaWorkTraceStore — verifying read path

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`

- [ ] **Step 1: Replace the read methods**

Replace `getByWorkUnitId` and `getByIdempotencyKey` in `packages/db/src/stores/prisma-work-trace-store.ts`:

```ts
  async getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { workUnitId } });
    if (!row) return null;
    return this.verifyAndWrap(row);
  }

  async getByIdempotencyKey(key: string): Promise<WorkTraceReadResult | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return this.verifyAndWrap(row);
  }

  private async verifyAndWrap(
    row: NonNullable<Awaited<ReturnType<typeof this.prisma.workTrace.findUnique>>>,
  ): Promise<WorkTraceReadResult> {
    const trace = this.mapRowToTrace(row);
    let anchor = null;
    try {
      if (row.contentHash !== null && (row.traceVersion ?? 0) > 0) {
        anchor = await this.auditLedger.findAnchor({
          entityType: "work_trace",
          entityId: row.workUnitId,
          eventType: row.traceVersion === 1 ? "work_trace.persisted" : "work_trace.updated",
          traceVersion: row.traceVersion,
        });
      }
    } catch (err) {
      console.error("[PrismaWorkTraceStore] findAnchor failed", err);
      await safeAlert(this.operatorAlerter, this.buildIntegrityAlert(
        "integrity_check_unavailable",
        trace,
        null,
        null,
      ));
      return {
        trace,
        integrity: { status: "missing_anchor", expectedAtVersion: row.traceVersion ?? 0 },
      };
    }

    const integrity = verifyWorkTraceIntegrity({
      trace,
      rowContentHash: row.contentHash,
      rowTraceVersion: row.traceVersion ?? 0,
      rowRequestedAt: row.requestedAt.toISOString(),
      anchor,
      cutoffAt: WORK_TRACE_INTEGRITY_CUTOFF_AT,
    });

    if (integrity.status === "mismatch" || integrity.status === "missing_anchor") {
      const errorType =
        integrity.status === "mismatch"
          ? "work_trace_integrity_mismatch"
          : "work_trace_integrity_missing_anchor";
      await safeAlert(
        this.operatorAlerter,
        this.buildIntegrityAlert(errorType, trace, row.contentHash, integrity),
      );
    }

    return { trace, integrity };
  }

  private buildIntegrityAlert(
    errorType:
      | "work_trace_integrity_mismatch"
      | "work_trace_integrity_missing_anchor"
      | "integrity_check_unavailable",
    trace: WorkTrace,
    storedHash: string | null,
    integrity: import("@switchboard/core/platform").IntegrityVerdict | null,
  ): InfrastructureFailureAlert {
    const message =
      integrity && integrity.status === "mismatch"
        ? `WorkTrace contentHash mismatch (expected ${integrity.expected}, got ${integrity.actual})`
        : integrity && integrity.status === "missing_anchor"
          ? `WorkTrace anchor missing at version ${integrity.expectedAtVersion}`
          : "WorkTrace integrity check unavailable";
    return {
      errorType,
      severity: errorType === "work_trace_integrity_mismatch" ? "critical" : "warning",
      errorMessage: message,
      intent: trace.intent,
      traceId: trace.traceId,
      organizationId: trace.organizationId,
      retryable: false,
      occurredAt: new Date().toISOString(),
      source: "platform_ingress",
    };
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PrismaWorkTraceStore compiles. Other callers (lifecycle, ingress, app, tests) still fail until Tasks 14-19.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/prisma-work-trace-store.ts
git commit -m "feat(db): WorkTraceStore reads return verified WorkTraceReadResult"
```

---

### Task 14: PrismaWorkTraceStore construction tests

**Files:**

- Create: `packages/db/src/stores/__tests__/prisma-work-trace-store-construction.test.ts`

- [ ] **Step 1: Write the tests**

Create `packages/db/src/stores/__tests__/prisma-work-trace-store-construction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

const fakePrisma = {} as never;

describe("PrismaWorkTraceStore — construction", () => {
  it("throws when config is missing entirely", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new PrismaWorkTraceStore(fakePrisma, undefined as any)).toThrow(
      /requires auditLedger and operatorAlerter/,
    );
  });

  it("throws when auditLedger is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      () =>
        new PrismaWorkTraceStore(fakePrisma, { operatorAlerter: new NoopOperatorAlerter() } as any),
    ).toThrow(/requires auditLedger and operatorAlerter/);
  });

  it("throws when operatorAlerter is missing", () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new PrismaWorkTraceStore(fakePrisma, { auditLedger: ledger } as any)).toThrow(
      /requires auditLedger and operatorAlerter/,
    );
  });

  it("constructs cleanly when both deps are present (real ledger + noop alerter)", () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(fakePrisma, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
    expect(store).toBeInstanceOf(PrismaWorkTraceStore);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @switchboard/db test -- prisma-work-trace-store-construction`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/__tests__/prisma-work-trace-store-construction.test.ts
git commit -m "test(db): assert PrismaWorkTraceStore requires auditLedger + operatorAlerter"
```

---

### Task 15: Migrate existing PrismaWorkTraceStore mock-based tests

**Files:**

- Modify: `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts`

- [ ] **Step 1: Update the existing persist/update mock tests**

In `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`, the `mockPrisma` needs `$transaction` support. Replace the `mockPrisma` and `beforeEach`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

// ... existing makeTrace function unchanged ...

describe("PrismaWorkTraceStore", () => {
  const workTraceCreate = vi.fn().mockResolvedValue({});
  const mockPrisma = {
    workTrace: { create: workTraceCreate },
    $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma)),
  };

  let store: PrismaWorkTraceStore;
  let ledger: AuditLedger;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger = new AuditLedger(new InMemoryLedgerStorage());
    store = new PrismaWorkTraceStore(mockPrisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
  });

  // ... existing it("persists a work trace with all fields") and other persist tests ...
  // The existing tests asserting workTrace.create was called still apply — they
  // run inside the $transaction mock. No further behavioral change needed here.
});
```

For tests that previously asserted on `getByWorkUnitId` returning a `WorkTrace`, update assertions to read `result?.trace` and check `result?.integrity.status` separately. Search the file for `getByWorkUnitId` / `getByIdempotencyKey` invocations and update each.

- [ ] **Step 2: Update the lock test**

In `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts`, similarly:

1. Add `$transaction` to the mock prisma object.
2. Construct the store with `{ auditLedger, operatorAlerter }` config.
3. Update any read-result assertions to use the new shape.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @switchboard/db test`
Expected: All db package tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts
git commit -m "test(db): adapt existing PrismaWorkTraceStore tests to new contract"
```

---

## Phase D — Caller integration (admission + read shape)

### Task 16: Update `platform-lifecycle.ts` read sites for new shape + admission

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`

- [ ] **Step 1: Update `:87` read site**

Locate the read at `platform-lifecycle.ts:87` (`const trace = await this.config.traceStore.getByWorkUnitId(approval.envelopeId);`). Replace with:

```ts
const readResult = await this.config.traceStore.getByWorkUnitId(approval.envelopeId);
if (!readResult) {
  // existing not-found behavior unchanged
  // (preserve original handling — return / throw as the existing code did)
  return /* ...existing path... */;
}
const { trace, integrity } = readResult;
await assertExecutionAdmissible({
  trace,
  integrity,
  auditLedger: this.config.auditLedger,
});
// continue with existing logic using `trace`
```

Add `assertExecutionAdmissible` to the imports at the top of the file:

```ts
import { assertExecutionAdmissible } from "./work-trace-integrity.js";
```

- [ ] **Step 2: Update `:285` read site**

Locate `const trace = await traceStore.getByWorkUnitId(workUnitId);`. Replace:

```ts
const readResult = await traceStore.getByWorkUnitId(workUnitId);
if (!readResult) {
  // existing not-found behavior
}
const { trace, integrity } = readResult;
await assertExecutionAdmissible({
  trace,
  integrity,
  auditLedger: this.config.auditLedger,
});
// continue with existing logic using `trace`
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: `platform-lifecycle.ts` is clean. `platform-ingress.ts` and `lifecycle-service.ts` still failing (next tasks).

- [ ] **Step 4: Run lifecycle tests**

Run: `pnpm --filter @switchboard/core test -- platform-lifecycle`
Expected: Existing tests likely fail because their mock `traceStore.getByWorkUnitId` returns the old shape. Tests will be updated in Task 20. **Skip this expectation if all tests pass.** If they fail, that's expected — continue to commit.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/platform-lifecycle.ts
git commit -m "feat(core): platform-lifecycle reads use WorkTraceReadResult + admission"
```

---

### Task 17: Update `platform-ingress.ts:95` idempotency read

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts`

- [ ] **Step 1: Update the idempotency check**

Locate the call at `platform-ingress.ts:95` (`const existingTrace = await traceStore.getByIdempotencyKey(request.idempotencyKey);`). The idempotency check is a dedup before any execution — admission is NOT required. Update to consume the new shape:

```ts
const existingResult = await traceStore.getByIdempotencyKey(request.idempotencyKey);
if (existingResult) {
  // existing dedup behavior, but now extract .trace
  const existingTrace = existingResult.trace;
  // Note: integrity check intentionally skipped here — this is dedup,
  // not execution. The trace will be re-read with admission at execution sites.
  // ... existing handling using existingTrace ...
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: `platform-ingress.ts` is clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/platform/platform-ingress.ts
git commit -m "fix(core): platform-ingress idempotency consumes WorkTraceReadResult"
```

---

### Task 18: Update `approval/lifecycle-service.ts:147` admission

**Files:**

- Modify: `packages/core/src/approval/lifecycle-service.ts`

- [ ] **Step 1: Find the read-before-update**

Locate the function containing `await params.traceStore.update(lifecycle.actionEnvelopeId, ...)` at `lifecycle-service.ts:147`. Read upward to find where the trace is loaded before this update.

If a trace is loaded earlier in the same function, change it to consume `WorkTraceReadResult` and call `assertExecutionAdmissible` immediately after the load.

If no prior load exists in this function, add one immediately before the update:

```ts
import { assertExecutionAdmissible } from "@switchboard/core/platform";

// ... before the update call ...
const readResult = await params.traceStore.getByWorkUnitId(lifecycle.actionEnvelopeId);
if (!readResult) {
  throw new Error(`WorkTrace not found for lifecycle ${lifecycle.actionEnvelopeId}`);
}
await assertExecutionAdmissible({
  trace: readResult.trace,
  integrity: readResult.integrity,
  auditLedger: params.auditLedger,
});

// existing update call follows
await params.traceStore.update(lifecycle.actionEnvelopeId, {
  // ... existing fields ...
});
```

If `params` does not yet expose `auditLedger`, thread it through the `LifecycleServiceParams` interface (add an optional `auditLedger?: AuditLedger` field, or pass it explicitly via the service constructor — match the existing pattern).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS for production code. Tests still pending (Task 20).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/approval/lifecycle-service.ts
git commit -m "feat(core): approval-lifecycle reads + asserts admission before update"
```

---

### Task 19: Update `apps/api` consumers of WorkTraceStore reads

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/approvals.ts`

- [ ] **Step 1: Update the null-fallback mock store in app.ts**

In `apps/api/src/app.ts` around lines 487-492, the fallback mock declares `getByWorkUnitId` and `getByIdempotencyKey` returning `null`. The signature now returns `WorkTraceReadResult | null`, so `null` is still valid — but TypeScript needs the function signature to match. Update:

```ts
    traceStore: workTraceStore ?? {
      persist: async () => {},
      getByWorkUnitId: async () => null,
      update: async () => ({ ok: true, trace: {} as never }),
      getByIdempotencyKey: async () => null,
    },
```

(No code change in practice — `async () => null` already satisfies `Promise<WorkTraceReadResult | null>`. Verify with typecheck.)

- [ ] **Step 2: Update the read consumer in routes/approvals.ts**

In `apps/api/src/routes/approvals.ts:343`:

```ts
async function loadWorkTrace(app: FastifyInstance, workUnitId: string) {
  if (!app.workTraceStore) return null;
  const result = await app.workTraceStore.getByWorkUnitId(workUnitId);
  if (!result) return null;
  // Surface the integrity verdict alongside the trace so the API can render
  // it; do not fail the route on mismatch (UI is read-only display).
  return { trace: result.trace, integrity: result.integrity };
}
```

If callers of `loadWorkTrace` previously expected a flat `WorkTrace`, update them to read `.trace` and optionally include `.integrity` in the response payload. Search for callers:

Run: `grep -n "loadWorkTrace\|workTraceStore.getByWorkUnitId" apps/api/src/routes/approvals.ts`

Update each call site as needed.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switchboard/api typecheck` (or `pnpm typecheck` for the whole monorepo)
Expected: PASS.

- [ ] **Step 4: Run api tests**

Run: `pnpm --filter @switchboard/api test`
Expected: PASS. Adjust any test that asserted on the flat WorkTrace shape.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/routes/approvals.ts
git commit -m "feat(api): consume WorkTraceReadResult shape from store reads"
```

---

### Task 20: Sweep remaining test mocks of WorkTraceStore

**Files:**

- Modify: every `*.test.ts` that mocks `WorkTraceStore` and asserts on a flat `WorkTrace` from `getByWorkUnitId` / `getByIdempotencyKey`

Identified call sites (from spec):

- `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`
- `packages/core/src/approval/__tests__/lifecycle-service.test.ts`
- `packages/core/src/platform/__tests__/convergence-e2e.test.ts`
- `packages/core/src/platform/__tests__/runtime-first-response.test.ts`
- `packages/core/src/platform/__tests__/work-trace-recorder.test.ts`

- [ ] **Step 1: Run the full test suite and read the failures**

Run: `pnpm test 2>&1 | tee /tmp/work-trace-test-failures.log`
Expected: A list of failures. Most will say "Type 'WorkTrace' is not assignable to 'WorkTraceReadResult'" or actual runtime failures where mocks return the old shape.

- [ ] **Step 2: Mechanically update each failing mock**

For every test that builds a mock store, change the read-method return value:

```ts
// before
const mockStore = {
  getByWorkUnitId: vi.fn().mockResolvedValue(makeTrace()),
  // ...
};
// after
const mockStore = {
  getByWorkUnitId: vi.fn().mockResolvedValue({
    trace: makeTrace(),
    integrity: { status: "ok" as const },
  }),
  // ...
};
```

For mocks that returned `null`, no change needed.

For tests that read `.trace` after the call, update assertions accordingly.

- [ ] **Step 3: Re-run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src
git commit -m "test(core): adapt WorkTraceStore mocks to WorkTraceReadResult shape"
```

---

## Phase E — Behavioral integration tests

### Task 21: Integration test — atomic persist + tampering detection

**Files:**

- Create: `packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts`

This test runs against a real Postgres. If the project uses an integration-test setup separate from unit tests (e.g. a dedicated `vitest.integration.config.ts`), place the file accordingly. Otherwise, gate the file with `describe.skipIf(!process.env.DATABASE_URL)`.

- [ ] **Step 1: Write the tests**

Create `packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { PrismaLedgerStorage } from "../../storage/prisma-ledger-storage.js";
import { AuditLedger, NoopOperatorAlerter } from "@switchboard/core";
import { WORK_TRACE_INTEGRITY_CUTOFF_AT } from "../../integrity-cutoff.js";
import type { WorkTrace } from "@switchboard/core/platform";

const SKIP = !process.env.DATABASE_URL;

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: `wu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    traceId: "tr_int_1",
    intent: "digital-ads.pause",
    mode: "cartridge",
    organizationId: "org_int",
    actor: { id: "user_int", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 10,
    matchedPolicies: ["P_INT"],
    outcome: "completed",
    durationMs: 100,
    requestedAt: new Date().toISOString(),
    governanceCompletedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe.skipIf(SKIP)("PrismaWorkTraceStore — integrity (Postgres)", () => {
  const prisma = new PrismaClient();
  let store: PrismaWorkTraceStore;
  let ledger: AuditLedger;

  beforeAll(async () => {
    ledger = new AuditLedger(new PrismaLedgerStorage(prisma));
    store = new PrismaWorkTraceStore(prisma, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persist writes WorkTrace + paired anchor at v1", async () => {
    const t = makeTrace();
    await store.persist(t);

    const row = await prisma.workTrace.findUnique({ where: { workUnitId: t.workUnitId } });
    expect(row?.contentHash).toBeTruthy();
    expect(row?.traceVersion).toBe(1);

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: t.workUnitId,
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["contentHash"]).toBe(row!.contentHash);
  });

  it("getByWorkUnitId on freshly-persisted trace returns ok", async () => {
    const t = makeTrace();
    await store.persist(t);
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("ok");
  });

  it("tampering with executionOutputs is detected as mismatch", async () => {
    const t = makeTrace();
    await store.persist(t);
    await prisma.workTrace.update({
      where: { workUnitId: t.workUnitId },
      data: { executionOutputs: JSON.stringify({ tampered: true }) },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("mismatch");
  });

  it("deleting the anchor surfaces missing_anchor", async () => {
    const t = makeTrace();
    await store.persist(t);
    await prisma.auditEntry.deleteMany({
      where: { entityType: "work_trace", entityId: t.workUnitId },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("missing_anchor");
  });

  it("post-cutoff row with traceVersion=0 returns missing_anchor (invariant guard)", async () => {
    const t = makeTrace();
    await store.persist(t);
    await prisma.workTrace.update({
      where: { workUnitId: t.workUnitId },
      data: { traceVersion: 0 },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("missing_anchor");
  });

  it("update bumps traceVersion and writes paired anchor", async () => {
    const t = makeTrace();
    await store.persist(t);
    const updateResult = await store.update(t.workUnitId, { executionSummary: "updated" });
    expect(updateResult.ok).toBe(true);

    const row = await prisma.workTrace.findUnique({ where: { workUnitId: t.workUnitId } });
    expect(row?.traceVersion).toBe(2);

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: t.workUnitId,
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["previousVersion"]).toBe(1);
    expect(anchor!.snapshot["changedFields"]).toEqual(expect.arrayContaining(["executionSummary"]));
    expect(anchor!.snapshot["changedFields"]).not.toContain("contentHash");
    expect(anchor!.snapshot["changedFields"]).not.toContain("traceVersion");
    expect(anchor!.snapshot["changedFields"]).not.toContain("lockedAt");
  });

  it("pre-migration row (requestedAt < cutoff, contentHash null) returns skipped", async () => {
    const wuId = `wu_pre_${Date.now()}`;
    // Insert a row directly bypassing the store, simulating a pre-migration row.
    await prisma.workTrace.create({
      data: {
        workUnitId: wuId,
        traceId: "tr_pre",
        intent: "x",
        mode: "cartridge",
        organizationId: "org_pre",
        actorId: "u",
        actorType: "user",
        trigger: "api",
        matchedPolicies: "[]",
        governanceOutcome: "execute",
        riskScore: 0,
        outcome: "completed",
        durationMs: 0,
        requestedAt: new Date(new Date(WORK_TRACE_INTEGRITY_CUTOFF_AT).getTime() - 86_400_000),
        governanceCompletedAt: new Date(
          new Date(WORK_TRACE_INTEGRITY_CUTOFF_AT).getTime() - 86_400_000,
        ),
        contentHash: null,
        traceVersion: 0,
      },
    });
    const result = await store.getByWorkUnitId(wuId);
    expect(result?.integrity).toEqual({ status: "skipped", reason: "pre_migration" });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `DATABASE_URL=<your-test-db> pnpm --filter @switchboard/db test -- prisma-work-trace-store-integrity`
Expected: All tests pass against real Postgres.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts
git commit -m "test(db): integration tests for WorkTrace integrity (atomic + tampering)"
```

---

### Task 22: Lifecycle integrity admission tests

**Files:**

- Create: `packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts`
- Create: `packages/core/src/approval/__tests__/lifecycle-service-integrity.test.ts`

- [ ] **Step 1: Write platform-lifecycle integrity test**

Create `packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkTraceIntegrityError } from "../work-trace-integrity.js";
// Import the construct-under-test (PlatformLifecycle or whatever class wraps the
// admission sites at :87 and :285).
// import { PlatformLifecycle } from "../platform-lifecycle.js";

// NOTE: This test exercises the admission integration. The exact construction
// of PlatformLifecycle depends on its constructor — mirror the pattern used
// in the existing platform-lifecycle.test.ts. The intent of THIS test is:
//   1. mock traceStore.getByWorkUnitId to return a verdict
//   2. confirm the lifecycle either proceeds (ok) or throws (mismatch/missing_anchor/skipped)
//   3. confirm no execute/update occurs when admission fails

describe("PlatformLifecycle — integrity admission", () => {
  it.todo("ok verdict → lifecycle proceeds");
  it.todo("mismatch verdict (no override) → throws WorkTraceIntegrityError, no update");
  it.todo("missing_anchor verdict (no override) → throws, no update");
  it.todo("skipped verdict (no override) → throws, no update");
  it.todo("mismatch verdict + override → admits, records override audit, lifecycle proceeds");
});
```

Replace the `it.todo` placeholders with concrete test bodies that mirror the existing `platform-lifecycle.test.ts` setup. For each case:

- Mock `traceStore.getByWorkUnitId` to return `{ trace, integrity: <verdict> }`.
- Spy on `traceStore.update`.
- Call the lifecycle method that triggers the read at line 87 or 285.
- Assert: throws or proceeds as described; `update` was/wasn't called.

(Use the existing `platform-lifecycle.test.ts` as the template for setup and helper functions.)

- [ ] **Step 2: Write approval-lifecycle integrity test**

Create `packages/core/src/approval/__tests__/lifecycle-service-integrity.test.ts` with the same shape, exercising the admission added in Task 18.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @switchboard/core test -- lifecycle-integrity`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts packages/core/src/approval/__tests__/lifecycle-service-integrity.test.ts
git commit -m "test(core): admission integration tests for lifecycle + approval"
```

---

### Task 23: Caller-rule structural test

**Files:**

- Create: `packages/core/src/__tests__/work-trace-update-caller-rule.test.ts`

- [ ] **Step 1: Write the structural test**

Create `packages/core/src/__tests__/work-trace-update-caller-rule.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { WorkTrace, WorkTraceStore, WorkTraceReadResult } from "../platform/index.js";

/**
 * Caller rule (load-bearing): every existing update() call site that drives an
 * external effect MUST first call getByWorkUnitId AND assertExecutionAdmissible
 * on the result before invoking update.
 *
 * This test wraps a mock store and asserts read-before-update ordering for
 * each known call site.
 */

interface CallLog {
  reads: string[];
  updates: string[];
}

function instrumentedStore(log: CallLog, baseTrace: WorkTrace): WorkTraceStore {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByWorkUnitId: vi.fn(async (id: string): Promise<WorkTraceReadResult | null> => {
      log.reads.push(id);
      return { trace: { ...baseTrace, workUnitId: id }, integrity: { status: "ok" } };
    }),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    update: vi.fn(async (id: string) => {
      log.updates.push(id);
      return { ok: true, trace: { ...baseTrace, workUnitId: id } };
    }),
  };
}

const baseTrace: WorkTrace = {
  workUnitId: "wu_caller_rule",
  traceId: "tr_cr",
  intent: "x",
  mode: "cartridge",
  organizationId: "org",
  actor: { id: "u", type: "user" },
  trigger: "api",
  governanceOutcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
  outcome: "completed",
  durationMs: 0,
  requestedAt: "2026-04-29T12:00:00.000Z",
  governanceCompletedAt: "2026-04-29T12:00:00.050Z",
};

describe("WorkTrace update caller rule — read-before-update ordering", () => {
  it.todo("platform-lifecycle.ts:360 reads before updating");
  it.todo("platform-lifecycle.ts:558 reads before updating");
  it.todo("platform-lifecycle.ts:573 reads before updating");
  it.todo("approval/lifecycle-service.ts:147 reads before updating");

  it("a deliberately-broken caller (no read) is detected by the spy", async () => {
    const log: CallLog = { reads: [], updates: [] };
    const store = instrumentedStore(log, baseTrace);
    await store.update("wu_broken", { executionSummary: "x" });
    // Caller did not read first — assert ordering is violated.
    expect(log.reads).not.toContain("wu_broken");
    expect(log.updates).toContain("wu_broken");
  });
});
```

Replace each `it.todo` with a concrete test that drives the actual call site (using the lifecycle/service constructs the same way the corresponding behavioral test does), then asserts:

```ts
// for each call site:
expect(log.reads).toContain(workUnitId);
expect(log.updates).toContain(workUnitId);
const readIndex = log.reads.indexOf(workUnitId);
const updateIndex = log.updates.indexOf(workUnitId);
expect(readIndex).toBeGreaterThanOrEqual(0);
expect(updateIndex).toBeGreaterThanOrEqual(0);
// reads can be interleaved between modules; the important property is that
// the read for THIS workUnitId happened before the update for the SAME id.
// If reads is a single-entry array per call site, simpler:
expect(log.reads[0]).toBe(workUnitId);
expect(log.updates[0]).toBe(workUnitId);
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @switchboard/core test -- work-trace-update-caller-rule`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/work-trace-update-caller-rule.test.ts
git commit -m "test(core): enforce WorkTrace update-caller read-then-assert rule"
```

---

### Task 24: PrismaLedgerStorage external-tx + findBySnapshotField

**Files:**

- Modify: `packages/db/src/storage/prisma-ledger-storage.ts`
- Modify: `packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts`

- [ ] **Step 1: Extend `appendAtomic` with `externalTx`**

In `packages/db/src/storage/prisma-ledger-storage.ts`, replace `appendAtomic`:

```ts
  async appendAtomic(
    buildEntry: (previousEntryHash: string | null) => Promise<AuditEntry>,
    options?: { externalTx?: unknown },
  ): Promise<AuditEntry> {
    const writeWithTx = async (
      tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">,
    ) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

      const latest = await tx.auditEntry.findFirst({ orderBy: { timestamp: "desc" } });
      const previousEntryHash = latest?.entryHash ?? null;

      const entry = await buildEntry(previousEntryHash);

      await tx.auditEntry.create({
        data: {
          id: entry.id,
          eventType: entry.eventType,
          timestamp: entry.timestamp,
          actorType: entry.actorType,
          actorId: entry.actorId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          riskCategory: entry.riskCategory,
          visibilityLevel: entry.visibilityLevel,
          summary: entry.summary,
          snapshot: entry.snapshot as object,
          evidencePointers: entry.evidencePointers as object[],
          redactionApplied: entry.redactionApplied,
          redactedFields: entry.redactedFields,
          chainHashVersion: entry.chainHashVersion,
          schemaVersion: entry.schemaVersion,
          entryHash: entry.entryHash,
          previousEntryHash: entry.previousEntryHash,
          envelopeId: entry.envelopeId,
          organizationId: entry.organizationId,
          traceId: entry.traceId ?? undefined,
        },
      });

      return entry;
    };

    if (options?.externalTx) {
      // Run on the parent transaction. Same advisory-lock semantics apply
      // because pg_advisory_xact_lock is per-tx.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return writeWithTx(options.externalTx as any);
    }
    return this.prisma.$transaction(writeWithTx);
  }
```

- [ ] **Step 2: Implement `findBySnapshotField` via JSONB filter**

Add to the same file:

```ts
  async findBySnapshotField(params: {
    entityType: string;
    entityId: string;
    eventType: string;
    field: string;
    value: unknown;
  }): Promise<AuditEntry | null> {
    // Use JSONB equality predicate. Prisma's `path` filter compares the
    // value at the specified JSON path. No arbitrary limit — relies on
    // (entityType, entityId, eventType) selectivity.
    const row = await this.prisma.auditEntry.findFirst({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        eventType: params.eventType,
        snapshot: {
          path: [params.field],
          equals: params.value as never,
        },
      },
      orderBy: { timestamp: "desc" },
    });
    if (!row) return null;
    return toAuditEntry(row);
  }
```

- [ ] **Step 3: Add integration tests**

Append to `packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts`:

```ts
describe.skipIf(!process.env.DATABASE_URL)(
  "PrismaLedgerStorage — externalTx + findBySnapshotField",
  () => {
    // Mirror existing test setup pattern (PrismaClient + cleanup).
    // 1. appendAtomic(...) with no options → existing path works (regression).
    // 2. appendAtomic(..., { externalTx: tx }) inside an outer prisma.$transaction
    //    that throws after the call → assert AuditEntry was rolled back.
    // 3. findBySnapshotField returns the matching entry by traceVersion.
    // 4. findBySnapshotField returns null when no match.
    it.todo("appendAtomic respects externalTx rollback");
    it.todo("findBySnapshotField returns the entry whose snapshot field matches");
    it.todo("findBySnapshotField returns null when no entry matches");
  },
);
```

Replace each `it.todo` with a concrete body that uses the existing test fixtures.

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL=<test-db> pnpm --filter @switchboard/db test -- prisma-ledger-storage`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/storage/prisma-ledger-storage.ts packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts
git commit -m "feat(db): PrismaLedgerStorage external-tx + findBySnapshotField"
```

---

## Phase F — Final verification

### Task 25: Full-monorepo typecheck, build, test, lint

**Files:** none (verification only)

- [ ] **Step 1: Reset to ensure all generated artifacts are clean**

Run: `pnpm reset`
Expected: Clean rebuild of schemas → core → db.

- [ ] **Step 2: Typecheck the entire monorepo**

Run: `pnpm typecheck`
Expected: PASS with no errors.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS. Note any skipped integration tests due to missing `DATABASE_URL`.

- [ ] **Step 4: Build the entire monorepo**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Confirm migration cutoff timestamp matches the actual migration**

Run: `ls packages/db/prisma/migrations/ | grep worktrace_integrity`
Confirm the directory name's timestamp matches the value in
`packages/db/src/integrity-cutoff.ts`. If not, update the constant
and re-commit.

- [ ] **Step 7: Update `.audit/08-launch-blocker-sequence.md` with shipped status**

In `.audit/08-launch-blocker-sequence.md`, find the row for #19 in the Audit Status table and update:

```
| 19  | WorkTrace cryptographic integrity              | ✅ SHIPPED | PR #<this-PR-number> (anchored content-hash, version-exact anchor lookup, fail-closed execution admission) |
```

Add the follow-up entry (per spec §Rollout):

```
Follow-up: WorkTrace integrity reconciler + UI surfacing

Goal:
Continuous attestation and operator-visible integrity status.

Required:
- Background cron scanning recent WorkTrace rows, recomputing hashes,
  asserting anchor presence at the row's traceVersion.
- Dashboard widget surfacing per-trace integrity verdict for ops review.
- Audit page badge showing integrity.status alongside trace details.
- Hash-chain visualization across updates of the same workUnitId.

Out of scope here, but unblocked by Blocker #19.
```

Commit:

```bash
git add .audit/08-launch-blocker-sequence.md
git commit -m "docs(audit): mark Blocker #19 (WorkTrace integrity) shipped"
```

- [ ] **Step 8: Open PR**

Run:

```bash
gh pr create --title "Add cryptographic integrity to WorkTrace via anchored content hash" --body "$(cat <<'EOF'
## Summary

Closes Blocker #19 from `.audit/08-launch-blocker-sequence.md`.

Every WorkTrace persist and update now produces a paired AuditEntry that anchors the row's `contentHash` + `traceVersion` into the existing AuditLedger hash chain. Both writes commit on the same Prisma transaction, so a tampered row, a missing anchor, or a divergent hash is detectable on read.

- Read path is fail-open with a typed `IntegrityVerdict` and an operator alert on mismatch.
- Execution admission boundaries fail closed on `mismatch` / `missing_anchor` / `skipped` unless an operator override is threaded through (which itself produces an audit entry).
- Forward-only backfill: pre-migration rows are read-visible but execution-inadmissible.
- Spec: `docs/superpowers/specs/2026-04-29-worktrace-cryptographic-integrity-design.md`
- Plan: `docs/superpowers/plans/2026-04-29-worktrace-cryptographic-integrity-plan.md`

## Test plan

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (incl. integration tests against Postgres)
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] Direct DB tampering with `executionOutputs` produces `mismatch` verdict + operator alert (verified via integration test)
- [ ] Direct DB delete of anchor produces `missing_anchor` verdict + operator alert (verified via integration test)
- [ ] Pre-migration row returns `skipped` and is rejected by execution admission

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened. Return URL to user.

---

## Self-review

Spec coverage spot-check (against `docs/superpowers/specs/2026-04-29-worktrace-cryptographic-integrity-design.md`):

| Spec section                                                                              | Covered by                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| New audit event types                                                                     | Task 1                                            |
| `WorkTrace` interface fields                                                              | Task 3                                            |
| `work-trace-hash.ts`                                                                      | Task 4                                            |
| `work-trace-integrity.ts` (verifier + admission + WorkTraceIntegrityError)                | Task 5                                            |
| `LedgerStorage.appendAtomic` external-tx                                                  | Task 6, Task 24 (Prisma side)                     |
| `AuditLedger.findAnchor` + `findBySnapshotField`                                          | Task 7, Task 24 (Prisma side)                     |
| Prisma schema columns + migration                                                         | Task 8                                            |
| `WORK_TRACE_INTEGRITY_CUTOFF_AT`                                                          | Task 9                                            |
| `WorkTraceStore` read interface change to `WorkTraceReadResult`                           | Task 10                                           |
| `PrismaWorkTraceStore` required deps                                                      | Task 11                                           |
| `PrismaWorkTraceStore` atomic persist                                                     | Task 11                                           |
| `PrismaWorkTraceStore` atomic update + hash-relevant detection + `lockedAt`-only handling | Task 12                                           |
| `PrismaWorkTraceStore` verifying read                                                     | Task 13                                           |
| Construction tests                                                                        | Task 14                                           |
| Existing test migrations                                                                  | Tasks 15, 20                                      |
| `platform-lifecycle.ts` admission                                                         | Task 16                                           |
| `platform-ingress.ts` idempotency read shape                                              | Task 17                                           |
| `approval/lifecycle-service.ts` admission                                                 | Task 18                                           |
| App bootstrap consumers                                                                   | Task 19                                           |
| Tampering integration tests                                                               | Task 21                                           |
| Lifecycle admission integration tests                                                     | Task 22                                           |
| Caller-rule structural test                                                               | Task 23                                           |
| External-tx + findBySnapshotField Prisma impl + tests                                     | Task 24                                           |
| Audit doc update + PR                                                                     | Task 25                                           |
| `NoopOperatorAlerter`                                                                     | Reused (already exists; noted in plan amendments) |

No spec section is unaddressed. Plan amendments at top document deviations from spec discovered during exploration.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-worktrace-cryptographic-integrity-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
