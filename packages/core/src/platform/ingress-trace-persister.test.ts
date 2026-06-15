import { describe, it, expect, vi } from "vitest";
import { IngressTracePersister, TRACE_PERSIST_RETRY_POLICY } from "./ingress-trace-persister.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";

const zeroDelay = () => Promise.resolve();

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu_1",
    traceId: "t_1",
    intent: "test.intent",
    organizationId: "org_1",
    actor: { id: "actor_1", type: "user" },
    parameters: {},
    trigger: "api",
    requestedAt: new Date("2026-06-15T00:00:00.000Z").toISOString(),
    resolvedMode: "skill",
    priority: "normal",
    deployment: { deploymentId: "dep_1", skillSlug: "test", trustScore: 50 },
    ...overrides,
  } as WorkUnit;
}

const decision: GovernanceDecision = {
  outcome: "execute",
  riskScore: 0,
  budgetProfile: "standard",
  matchedPolicies: [],
  constraints: {
    allowedModelTiers: ["default"],
    maxToolCalls: 5,
    maxLlmTurns: 3,
    maxTotalTokens: 4000,
    maxRuntimeMs: 30000,
    maxWritesPerExecution: 2,
    trustLevel: "guided",
  },
};

const completedResult: ExecutionResult = {
  workUnitId: "wu_1",
  outcome: "completed",
  summary: "OK",
  outputs: {},
  mode: "skill",
  durationMs: 100,
  traceId: "t_1",
};

describe("IngressTracePersister", () => {
  it("re-exports the retry policy constant unchanged", () => {
    expect(TRACE_PERSIST_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      baseDelayMs: 100,
      factor: 4,
      jitterRatio: 0.25,
    });
  });

  describe("runWithRetry", () => {
    it("returns the value on first success without delaying", async () => {
      const delayFn = vi.fn(zeroDelay);
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn,
      });
      const result = await persister.runWithRetry(async () => 42);
      expect(result).toEqual({ ok: true, value: 42 });
      expect(delayFn).not.toHaveBeenCalled();
    });

    it("retries up to maxAttempts then returns the last error", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("boom"));
      const delayFn = vi.fn(zeroDelay);
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn,
      });
      const result = await persister.runWithRetry(fn);
      expect(result.ok).toBe(false);
      expect(fn).toHaveBeenCalledTimes(3);
      // delay applies BEFORE attempt 2 and attempt 3 only.
      expect(delayFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("persistTrace", () => {
    it("is a no-op when no store is provided", async () => {
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      await expect(
        persister.persistTrace(undefined, makeWorkUnit(), decision, "2026-06-15T00:00:00.000Z"),
      ).resolves.toBeUndefined();
    });

    it("records exactly one infra-failure (audit + alert) after terminal failure", async () => {
      const persist = vi.fn().mockRejectedValue(new Error("permanent"));
      const audit = { record: vi.fn().mockResolvedValue(undefined) };
      const alert = vi.fn().mockResolvedValue(undefined);
      const persister = new IngressTracePersister({
        auditLedger: audit as never,
        alerter: { alert },
        delayFn: zeroDelay,
      });

      await persister.persistTrace(
        { persist, getByIdempotencyKey: vi.fn() } as never,
        makeWorkUnit(),
        decision,
        "2026-06-15T00:00:00.000Z",
        completedResult,
      );

      expect(persist).toHaveBeenCalledTimes(3);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]![0]).toMatchObject({
        errorType: "trace_persist_failed",
        source: "platform_ingress",
      });
    });
  });

  describe("claimIdempotency", () => {
    it("returns skipped when the work unit has no idempotency key", async () => {
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      const result = await persister.claimIdempotency(
        { claim: vi.fn() } as never,
        makeWorkUnit(),
        decision,
        "2026-06-15T00:00:00.000Z",
        "2026-06-15T00:00:01.000Z",
      );
      expect(result).toEqual({ kind: "skipped" });
    });

    it("returns claimed when the store claims the key", async () => {
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      const result = await persister.claimIdempotency(
        { claim: vi.fn().mockResolvedValue({ claimed: true }) } as never,
        makeWorkUnit({ idempotencyKey: "k1" }),
        decision,
        "2026-06-15T00:00:00.000Z",
        "2026-06-15T00:00:01.000Z",
      );
      expect(result).toEqual({ kind: "claimed" });
    });

    it("returns conflict when the store reports the key already exists", async () => {
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      const result = await persister.claimIdempotency(
        { claim: vi.fn().mockResolvedValue({ claimed: false }) } as never,
        makeWorkUnit({ idempotencyKey: "k1" }),
        decision,
        "2026-06-15T00:00:00.000Z",
        "2026-06-15T00:00:01.000Z",
      );
      expect(result).toEqual({ kind: "conflict" });
    });

    it("returns claim_failed (retryable infra-failure) on transient store error", async () => {
      const alert = vi.fn().mockResolvedValue(undefined);
      const persister = new IngressTracePersister({
        alerter: { alert },
        delayFn: zeroDelay,
      });
      const result = await persister.claimIdempotency(
        { claim: vi.fn().mockRejectedValue(new Error("db down")) } as never,
        makeWorkUnit({ idempotencyKey: "k1" }),
        decision,
        "2026-06-15T00:00:00.000Z",
        "2026-06-15T00:00:01.000Z",
      );
      expect(result).toEqual({ kind: "claim_failed" });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]![0]).toMatchObject({ retryable: true });
    });
  });

  describe("finalizeTrace", () => {
    it("updates the running claim to its terminal outcome", async () => {
      const update = vi.fn().mockResolvedValue({ ok: true });
      const persister = new IngressTracePersister({
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      await persister.finalizeTrace(
        { update } as never,
        makeWorkUnit(),
        completedResult,
        "2026-06-15T00:00:02.000Z",
      );
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]![0]).toBe("wu_1");
      expect(update.mock.calls[0]![2]).toMatchObject({
        caller: "platform_ingress_finalize",
        organizationId: "org_1",
      });
    });

    it("records an infra-failure when the update is rejected (locked)", async () => {
      const update = vi.fn().mockResolvedValue({ ok: false, reason: "WORK_TRACE_LOCKED" });
      const alert = vi.fn().mockResolvedValue(undefined);
      const persister = new IngressTracePersister({
        alerter: { alert },
        delayFn: zeroDelay,
      });
      await persister.finalizeTrace(
        { update } as never,
        makeWorkUnit(),
        completedResult,
        "2026-06-15T00:00:02.000Z",
      );
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]![0]).toMatchObject({
        errorType: "trace_persist_failed",
        retryable: false,
      });
    });
  });

  describe("recordInfrastructureFailure", () => {
    it("does not throw when the audit ledger record throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const persister = new IngressTracePersister({
        auditLedger: { record: vi.fn().mockRejectedValue(new Error("audit down")) } as never,
        alerter: { alert: vi.fn().mockResolvedValue(undefined) },
        delayFn: zeroDelay,
      });
      await expect(
        persister.recordInfrastructureFailure({
          errorType: "execution_exception",
          error: new Error("x"),
          workUnit: makeWorkUnit(),
          retryable: false,
        }),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
