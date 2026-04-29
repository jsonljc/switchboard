import { describe, it, expect } from "vitest";
import {
  WORK_TRACE_HASH_VERSION,
  WORK_TRACE_HASH_VERSION_V1,
  WORK_TRACE_HASH_VERSION_V2,
  WORK_TRACE_HASH_VERSION_LATEST,
  WORK_TRACE_HASH_EXCLUDED_FIELDS_V1,
  WORK_TRACE_HASH_EXCLUDED_FIELDS_V2,
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
    ingressPath: "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
    ...overrides,
  };
}

describe("work-trace-hash", () => {
  it("WORK_TRACE_HASH_VERSION_LATEST is 2 (current default for new persists)", () => {
    expect(WORK_TRACE_HASH_VERSION_LATEST).toBe(2);
    // Backwards-compat alias points at the latest version.
    expect(WORK_TRACE_HASH_VERSION).toBe(WORK_TRACE_HASH_VERSION_LATEST);
  });

  it("v1 excluded set excludes contentHash, traceVersion, lockedAt, ingressPath, hashInputVersion", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1).toEqual(
      expect.arrayContaining([
        "contentHash",
        "traceVersion",
        "lockedAt",
        "ingressPath",
        "hashInputVersion",
      ]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1.length).toBe(5);
  });

  it("v2 excluded set excludes contentHash, traceVersion, lockedAt, hashInputVersion (NOT ingressPath)", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).toEqual(
      expect.arrayContaining(["contentHash", "traceVersion", "lockedAt", "hashInputVersion"]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).not.toContain("ingressPath");
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2.length).toBe(4);
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
    expect(input).toHaveProperty("hashVersion", WORK_TRACE_HASH_VERSION_LATEST);
  });

  it("buildWorkTraceHashInput includes traceVersion field", () => {
    const input = buildWorkTraceHashInput(baseTrace(), 7);
    expect(input).toHaveProperty("traceVersionForHash", 7);
  });
});

const baseTraceForVersionBlock: WorkTrace = {
  workUnitId: "wu_test_1",
  traceId: "wu_test_1",
  intent: "test.intent",
  mode: "skill",
  organizationId: "org_1",
  actor: { type: "service", id: "svc_test" },
  trigger: "api",
  parameters: { a: 1 },
  governanceOutcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
  outcome: "completed",
  durationMs: 1,
  modeMetrics: undefined,
  requestedAt: "2026-04-29T00:00:00.000Z",
  governanceCompletedAt: "2026-04-29T00:00:00.001Z",
  ingressPath: "platform_ingress",
  hashInputVersion: 2,
};

describe("buildWorkTraceHashInput — v1 vs v2", () => {
  it("v1 input shape excludes ingressPath and hashInputVersion", () => {
    const input = buildWorkTraceHashInput(
      { ...baseTraceForVersionBlock, hashInputVersion: WORK_TRACE_HASH_VERSION_V1 },
      1,
    );
    expect(input).not.toHaveProperty("ingressPath");
    expect(input).not.toHaveProperty("hashInputVersion");
    expect(input.hashVersion).toBe(1);
  });

  it("v2 input shape includes ingressPath and excludes hashInputVersion", () => {
    const input = buildWorkTraceHashInput(
      { ...baseTraceForVersionBlock, hashInputVersion: WORK_TRACE_HASH_VERSION_V2 },
      1,
    );
    expect(input).toHaveProperty("ingressPath", "platform_ingress");
    expect(input).not.toHaveProperty("hashInputVersion");
    expect(input.hashVersion).toBe(2);
  });

  it("v2 hashes differ when ingressPath differs", () => {
    const a = computeWorkTraceContentHash(
      {
        ...baseTraceForVersionBlock,
        hashInputVersion: WORK_TRACE_HASH_VERSION_V2,
        ingressPath: "platform_ingress",
      },
      1,
    );
    const b = computeWorkTraceContentHash(
      {
        ...baseTraceForVersionBlock,
        hashInputVersion: WORK_TRACE_HASH_VERSION_V2,
        ingressPath: "store_recorded_operator_mutation",
      },
      1,
    );
    expect(a).not.toEqual(b);
  });

  it("v1 hash for a row matches a pinned reference fixture", () => {
    // Pin the v1 hash so future refactors cannot silently change it and break
    // pre-migration locked rows. If this fixture changes, we have invalidated
    // every pre-migration row's contentHash. That is a breaking change that
    // must be explicit, not accidental.
    const v1Trace: WorkTrace = {
      ...baseTraceForVersionBlock,
      hashInputVersion: WORK_TRACE_HASH_VERSION_V1,
      ingressPath: "platform_ingress",
    };
    const hash = computeWorkTraceContentHash(v1Trace, 1);
    expect(hash).toMatchInlineSnapshot(
      `"ccafb985781b689b6e9f66c75dcd11e160e03aa696b98558e7abe110c61aa3f5"`,
    );
    // ^ first run will populate the inline snapshot; reviewer must inspect.
  });
});
