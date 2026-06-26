import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { GovernanceGateInterface, PlatformIngressConfig } from "../platform-ingress.js";
import type { WorkTrace } from "../work-trace.js";
import type {
  WorkTraceStore,
  WorkTraceReadResult,
  WorkTraceClaimResult,
  WorkTraceUpdateResult,
  StrandedRunningClaim,
} from "../work-trace-recorder.js";
import { validateUpdate } from "../work-trace-lock.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { ExecutionMode } from "../execution-context.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionResult } from "../execution-result.js";

/**
 * D1 — Trace ↔ side-effect atomicity (governance audit, Invariants 2 + 5).
 *
 * PlatformIngress.submit() dispatches the handler (which commits the domain
 * write + outbox, atomic *with each other*, in the handler's OWN transaction)
 * and THEN calls persistTrace in a SEPARATE transaction. persistTrace swallows
 * terminal failure and returns success. So a DB blip in that window yields a
 * committed revenue/consent/opportunity mutation with NO WorkTrace.
 *
 * Compounding: the idempotency replay guard keys on getByIdempotencyKey. With
 * no trace persisted, a retry of the same idempotency key re-executes the
 * handler -> a second money mutation (double spend).
 *
 * FAITHFULNESS (the audit explicitly warns over-mocking hides this hole):
 *   - The "domain write" and the "trace persist" are kept as GENUINELY SEPARATE
 *     operations, exactly as in production (core cannot import db; the handler
 *     owns its own tx, the trace store is a separate tx). They share no fake
 *     transaction that would paper over the gap.
 *   - The ingress builds the REAL WorkTrace via buildWorkTrace and hands it to
 *     the store; the store round-trips real traces. We do not hand-fabricate
 *     trace fixtures for the replay path — getByIdempotencyKey returns exactly
 *     what persist actually committed, mirroring PrismaWorkTraceStore.
 */

const testConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided",
};

// A money-path intent: idempotent retries must never double-apply (Invariant 5).
const revenueRegistration: IntentRegistration = {
  intent: "revenue.record",
  defaultMode: "operator_mutation",
  allowedModes: ["operator_mutation"],
  executor: { mode: "operator_mutation" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "standard",
  approvalPolicy: "none",
  idempotent: true,
  allowedTriggers: ["api"],
  timeoutMs: 30000,
  retryable: false,
} as unknown as IntentRegistration;

const baseRequest: CanonicalSubmitRequest = {
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "revenue.record",
  parameters: { contactId: "contact-1", amount: 5000 },
  trigger: "api",
  surface: { surface: "api", requestId: "req-revenue" },
};

function buildExecuteDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: testConstraints,
    matchedPolicies: ["default-policy"],
  };
}

/**
 * Stateful in-memory WorkTrace store that faithfully mirrors PrismaWorkTraceStore
 * for the claim-first execute path:
 *   - claim() inserts a `running` trace keyed by (org, idempotencyKey); a second
 *     claim for the same key returns { claimed: false } (the atomic-insert lock).
 *   - update() finalizes a claim (running -> terminal) by merging fields onto the
 *     stored trace; getByIdempotencyKey() returns whatever is actually committed.
 *   - failFinalizeCount models the D1 window: claim succeeds + the domain write
 *     commits, but the finalize update blips out (the retry loop exhausts), so the
 *     trace is left `running` and a retry must fail closed.
 *   - failPersistCount models transient claim/persist failures BEFORE dispatch.
 * The domain write (the mode) and the trace writes stay GENUINELY SEPARATE — no
 * shared fake transaction papers over the gap.
 */
class InMemoryTraceStore implements WorkTraceStore {
  private byKey = new Map<string, WorkTrace>();
  private byWorkUnit = new Map<string, WorkTrace>();
  /** Upcoming claim()/persist() attempts that should throw (pre-dispatch blip). */
  failPersistCount = 0;
  /** Upcoming update() attempts that should throw (finalize blip — the D1 window). */
  failFinalizeCount = 0;

  private idemKey(orgId: string, key: string): string {
    return `${orgId}::${key}`;
  }

  private store(trace: WorkTrace): void {
    this.byWorkUnit.set(trace.workUnitId, trace);
    if (trace.idempotencyKey) {
      this.byKey.set(this.idemKey(trace.organizationId, trace.idempotencyKey), trace);
    }
  }

  async persist(trace: WorkTrace): Promise<void> {
    if (this.failPersistCount > 0) {
      this.failPersistCount--;
      throw new Error("trace store down (persist blip)");
    }
    this.store(trace);
  }

  async claim(trace: WorkTrace): Promise<WorkTraceClaimResult> {
    if (this.failPersistCount > 0) {
      this.failPersistCount--;
      throw new Error("trace store down (claim blip)");
    }
    const key = trace.idempotencyKey
      ? this.idemKey(trace.organizationId, trace.idempotencyKey)
      : null;
    if (key && this.byKey.has(key)) return { claimed: false };
    this.store(trace);
    return { claimed: true };
  }

  async getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null> {
    const trace = this.byWorkUnit.get(workUnitId);
    return trace ? ({ trace } as WorkTraceReadResult) : null;
  }

  async update(workUnitId: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> {
    if (this.failFinalizeCount > 0) {
      this.failFinalizeCount--;
      throw new Error("trace store down (finalize blip)");
    }
    const current = this.byWorkUnit.get(workUnitId);
    if (!current) return { ok: true, trace: {} as WorkTrace };
    // Faithfully enforce the WorkTrace lock transitions (mirrors PrismaWorkTraceStore)
    // so this fake REJECTS an illegal finalize (e.g. running -> queued when the lock
    // forbids it) exactly as the real store would — that fidelity is what catches a
    // finalize wedge. A merge-only fake would mask it.
    const validation = validateUpdate({ current, update: fields });
    if (!validation.ok) {
      return {
        ok: false,
        code: "WORK_TRACE_LOCKED",
        traceUnchanged: true,
        reason: validation.diagnostic.reason,
      };
    }
    const merged = {
      ...current,
      ...fields,
      ...(validation.computedLockedAt ? { lockedAt: validation.computedLockedAt } : {}),
    } as WorkTrace;
    this.store(merged);
    return { ok: true, trace: merged };
  }

  async getByIdempotencyKey(
    organizationId: string,
    key: string,
  ): Promise<WorkTraceReadResult | null> {
    const trace = this.byKey.get(this.idemKey(organizationId, key));
    return trace ? ({ trace } as WorkTraceReadResult) : null;
  }

  // Faithful mirror of the Prisma findStuckRunning: only KEYED `running` claims older
  // than the threshold (keyless conversation/lifecycle running rows are excluded),
  // oldest-first, bounded by limit.
  async findStuckRunning(olderThan: Date, limit: number): Promise<StrandedRunningClaim[]> {
    return [...this.byWorkUnit.values()]
      .filter(
        (t) =>
          t.outcome === "running" &&
          t.idempotencyKey != null &&
          t.executionStartedAt != null &&
          new Date(t.executionStartedAt) < olderThan,
      )
      .sort((a, b) => (a.executionStartedAt! < b.executionStartedAt! ? -1 : 1))
      .slice(0, limit)
      .map((t) => ({
        workUnitId: t.workUnitId,
        organizationId: t.organizationId,
        idempotencyKey: t.idempotencyKey ?? null,
        intent: t.intent,
        traceId: t.traceId,
        executionStartedAt: t.executionStartedAt ?? null,
      }));
  }
}

interface RevenueRow {
  rowId: string;
  workUnitId: string;
  contactId: string;
  amount: number;
}

/**
 * A money-mutation execution mode that models the real handler: each dispatch
 * commits a NEW revenue row in its own transaction (mirroring record-revenue's
 * Date.now()-derived opportunityId, which the domain layer cannot dedup — only
 * the trace-level idempotency guard can). Returns "completed".
 */
function makeRevenueMode(ledger: RevenueRow[]): ExecutionMode {
  let seq = 0;
  return {
    name: "operator_mutation",
    execute: vi.fn(async (workUnit: WorkUnit): Promise<ExecutionResult> => {
      seq += 1;
      // DOMAIN WRITE COMMITS HERE — its own transaction, closes before dispatch returns.
      ledger.push({
        rowId: `rev-row-${seq}`,
        workUnitId: workUnit.id,
        contactId: String((workUnit.parameters as Record<string, unknown>).contactId),
        amount: Number((workUnit.parameters as Record<string, unknown>).amount),
      });
      return {
        workUnitId: workUnit.id,
        outcome: "completed" as const,
        summary: "Recorded revenue",
        outputs: { rowId: `rev-row-${seq}` },
        mode: "operator_mutation",
        durationMs: 10,
        traceId: workUnit.traceId,
      };
    }),
  };
}

function buildConfig(traceStore: WorkTraceStore, mode: ExecutionMode): PlatformIngressConfig {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(revenueRegistration);

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(mode);

  const governanceGate: GovernanceGateInterface = {
    evaluate: vi.fn().mockResolvedValue(buildExecuteDecision()),
  };

  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        skillSlug: "revenue",
        trustLevel: "guided",
        trustScore: 42,
      }),
    } as never,
    traceStore,
    // No-op so the persistTrace retry loop does not actually sleep between attempts.
    delayFn: async () => {},
  };
}

describe("PlatformIngress D1 — trace-atomicity double-spend window", () => {
  it("fails closed on idempotent retry when finalize blipped after a committed mutation", async () => {
    const ledger: RevenueRow[] = [];
    const mode = makeRevenueMode(ledger);
    const traceStore = new InMemoryTraceStore();
    const ingress = new PlatformIngress(buildConfig(traceStore, mode));

    const request = { ...baseRequest, idempotencyKey: "pay-key-1" };

    // --- First submission: claim succeeds, the domain write commits, but the
    //     finalize update blips out (all retry attempts) -> the trace is left
    //     `running`. The mutation already committed, so submit STILL returns ok.
    traceStore.failFinalizeCount = 3;
    const first = await ingress.submit(request);

    expect(first.ok).toBe(true);
    expect(ledger).toHaveLength(1);
    // Invariant 2 (WorkTrace is canonical) HOLDS now: a canonical record exists
    // for the committed mutation — left `running` for reconciliation, not absent.
    const claimed = await traceStore.getByIdempotencyKey("org-1", "pay-key-1");
    expect(claimed?.trace.outcome).toBe("running");

    // --- Idempotent retry: identical request, same key. The replay guard sees a
    //     `running` claim and FAILS CLOSED — it must NOT re-execute (Invariant 5).
    const second = await ingress.submit(request);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.type).toBe("idempotency_in_flight");
      expect(second.error.retryable).toBe(false);
    }

    // The money handler ran exactly ONCE across both submissions — no double spend.
    expect(ledger).toHaveLength(1);
    expect(vi.mocked(mode.execute)).toHaveBeenCalledTimes(1);
  });

  // EV-2 / SPINE-2: the stranded-claim reaper ages an orphaned `running` claim to
  // the `needs_reconciliation` dead-letter sink. A replay of that key must STILL
  // fail closed — never fall through to a cached `ok:true` (the prior mutation may
  // have committed, so the key must stay blocked until a human reconciles).
  it("a reaped (needs_reconciliation) claim STILL fails closed on replay — never a cached success", async () => {
    const ledger: RevenueRow[] = [];
    const mode = makeRevenueMode(ledger);
    const traceStore = new InMemoryTraceStore();
    const ingress = new PlatformIngress(buildConfig(traceStore, mode));
    const request = { ...baseRequest, idempotencyKey: "pay-key-reap" };

    // 1) Stranded claim: the domain write commits but finalize blips -> left `running`.
    traceStore.failFinalizeCount = 3;
    const first = await ingress.submit(request);
    expect(first.ok).toBe(true);
    expect(ledger).toHaveLength(1);
    const claim = await traceStore.getByIdempotencyKey("org-1", "pay-key-reap");
    expect(claim?.trace.outcome).toBe("running");

    // 2) The reaper ages the orphan to the non-resubmittable terminal sink (this is
    //    the only writer of running -> needs_reconciliation; it seals the row).
    const reap = await traceStore.update(claim!.trace.workUnitId, {
      outcome: "needs_reconciliation",
      completedAt: "2026-06-25T00:00:00.000Z",
    });
    expect(reap.ok).toBe(true);
    const reaped = await traceStore.getByIdempotencyKey("org-1", "pay-key-reap");
    expect(reaped?.trace.outcome).toBe("needs_reconciliation");

    // 3) Replay of the reaped key STILL fails closed (NOT cached ok:true, NOT a
    //    re-dispatch), and the operator message names reconciliation (not "in-flight").
    const replay = await ingress.submit(request);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.type).toBe("idempotency_in_flight");
      expect(replay.error.retryable).toBe(false);
      expect(replay.error.message.toLowerCase()).toContain("reconcil");
    }

    // No second money mutation; the handler still ran exactly ONCE.
    expect(ledger).toHaveLength(1);
    expect(vi.mocked(mode.execute)).toHaveBeenCalledTimes(1);
  });

  it("finalizes a successful keyed submit running -> completed without re-sending executionStartedAt", async () => {
    const ledger: RevenueRow[] = [];
    const traceStore = new InMemoryTraceStore();
    const updateSpy = vi.spyOn(traceStore, "update");
    const ingress = new PlatformIngress(buildConfig(traceStore, makeRevenueMode(ledger)));

    const res = await ingress.submit({ ...baseRequest, idempotencyKey: "ok-key" });
    expect(res.ok).toBe(true);

    const finalized = await traceStore.getByIdempotencyKey("org-1", "ok-key");
    expect(finalized?.trace.outcome).toBe("completed");
    // ONE_SHOT guardrail: the finalize update must NOT carry executionStartedAt
    // (it was sealed at claim time; re-sending a different value wedges the row).
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![1]).not.toHaveProperty("executionStartedAt");
    expect(ledger).toHaveLength(1);
  });

  it("fails closed without dispatching when the claim is lost (concurrent winner)", async () => {
    const ledger: RevenueRow[] = [];
    const mode = makeRevenueMode(ledger);
    const traceStore = new InMemoryTraceStore();
    vi.spyOn(traceStore, "claim").mockResolvedValue({ claimed: false });
    const ingress = new PlatformIngress(buildConfig(traceStore, mode));

    const res = await ingress.submit({ ...baseRequest, idempotencyKey: "race-key" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("idempotency_in_flight");
    expect(vi.mocked(mode.execute)).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
  });

  it("aborts before dispatch and is retryable when the claim insert fails transiently", async () => {
    const ledger: RevenueRow[] = [];
    const mode = makeRevenueMode(ledger);
    const traceStore = new InMemoryTraceStore();
    vi.spyOn(traceStore, "claim").mockRejectedValue(new Error("store down"));
    const ingress = new PlatformIngress(buildConfig(traceStore, mode));

    const res = await ingress.submit({ ...baseRequest, idempotencyKey: "blip-key" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe("upstream_error");
      expect(res.error.retryable).toBe(true);
    }
    expect(vi.mocked(mode.execute)).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
  });

  it("updates the claim running -> failed on handler throw, rethrows, and replays cached failure", async () => {
    const traceStore = new InMemoryTraceStore();
    const boom = new Error("handler boom");
    const throwingMode: ExecutionMode = {
      name: "operator_mutation",
      execute: vi.fn().mockRejectedValue(boom),
    };
    const ingress = new PlatformIngress(buildConfig(traceStore, throwingMode));
    const request = { ...baseRequest, idempotencyKey: "throw-key" };

    await expect(ingress.submit(request)).rejects.toBe(boom);
    const failed = await traceStore.getByIdempotencyKey("org-1", "throw-key");
    expect(failed?.trace.outcome).toBe("failed");

    // Replay of a finalized failure returns the cached failed result (no re-dispatch).
    const replay = await ingress.submit(request);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.result.outcome).toBe("failed");
    expect(vi.mocked(throwingMode.execute)).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy single-persist path for no-key submits (no claim)", async () => {
    const ledger: RevenueRow[] = [];
    const traceStore = new InMemoryTraceStore();
    const claimSpy = vi.spyOn(traceStore, "claim");
    const persistSpy = vi.spyOn(traceStore, "persist");
    const ingress = new PlatformIngress(buildConfig(traceStore, makeRevenueMode(ledger)));

    const res = await ingress.submit({ ...baseRequest }); // no idempotencyKey
    expect(res.ok).toBe(true);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveLength(1);
  });

  // Regression: a keyed submit whose mode returns a NON-terminal outcome (a
  // workflow that resolves to `queued`/`pending_approval`) must finalize the
  // running claim to that outcome — not wedge at `running` and fail closed on a
  // legitimate replay. The fake store enforces the real lock transitions, so this
  // fails if running->{queued,pending_approval} is not a legal finalize.
  it.each(["queued", "pending_approval"] as const)(
    "finalizes a keyed submit whose dispatch returns %s without wedging at running",
    async (nonTerminal) => {
      const traceStore = new InMemoryTraceStore();
      const nonTerminalMode: ExecutionMode = {
        name: "operator_mutation",
        execute: vi.fn(
          async (workUnit: WorkUnit): Promise<ExecutionResult> => ({
            workUnitId: workUnit.id,
            outcome: nonTerminal,
            summary: `dispatch resolved to ${nonTerminal}`,
            outputs: {},
            mode: "workflow",
            durationMs: 5,
            traceId: workUnit.traceId,
          }),
        ),
      };
      const ingress = new PlatformIngress(buildConfig(traceStore, nonTerminalMode));
      const request = { ...baseRequest, idempotencyKey: `nt-${nonTerminal}` };

      const first = await ingress.submit(request);
      expect(first.ok).toBe(true);
      // The claim was finalized to the real (non-terminal) outcome, not stuck running.
      const finalized = await traceStore.getByIdempotencyKey("org-1", `nt-${nonTerminal}`);
      expect(finalized?.trace.outcome).toBe(nonTerminal);

      // A legitimate idempotent replay returns the cached result — it must NOT
      // fail closed (the op succeeded; only `running` is indeterminate).
      const replay = await ingress.submit(request);
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.result.outcome).toBe(nonTerminal);
    },
  );
});
