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
    // hashInputVersion: 1 — fixture exercises pre-v2 hash path
    // (computeWorkTraceContentHash is called with version 1 throughout this file)
    ingressPath: "platform_ingress",
    hashInputVersion: 1,
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
