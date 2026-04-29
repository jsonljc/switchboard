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
