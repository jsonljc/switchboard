/**
 * Caller rule (load-bearing): every existing update() call site that drives
 * an external effect MUST first call getByWorkUnitId AND
 * assertExecutionAdmissible on the result before invoking update.
 *
 * This test scaffolds an instrumentation pattern that future call-site tests
 * can use. Today it covers only the "broken caller is detected" case — the
 * full call-site verification is a follow-up that requires real lifecycle
 * fixture wiring (see ./platform/__tests__/platform-lifecycle.test.ts for
 * setup).
 *
 * The skipped describe block names the call sites that need coverage.
 */
import { describe, it, expect, vi } from "vitest";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore, WorkTraceReadResult } from "../platform/work-trace-recorder.js";

// ---------------------------------------------------------------------------
// Instrumented store factory
// ---------------------------------------------------------------------------

interface CallLog {
  reads: string[];
  updates: string[];
  /** Ordered record of every store call: e.g. "read:wu_1", "update:wu_1" */
  ordered: string[];
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
  ingressPath: "platform_ingress",
  hashInputVersion: 2,
};

function instrumentedStore(log: CallLog, base: WorkTrace): WorkTraceStore {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByWorkUnitId: vi.fn(async (id: string): Promise<WorkTraceReadResult | null> => {
      log.reads.push(id);
      log.ordered.push(`read:${id}`);
      return { trace: { ...base, workUnitId: id }, integrity: { status: "ok" as const } };
    }),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    update: vi.fn(
      async (
        id: string,
        _fields: Partial<WorkTrace>,
        _options?: { caller?: string },
      ): Promise<{ ok: true; trace: WorkTrace }> => {
        log.updates.push(id);
        log.ordered.push(`update:${id}`);
        return { ok: true as const, trace: { ...base, workUnitId: id } };
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests — instrumentation contract
// ---------------------------------------------------------------------------

describe("WorkTrace update caller rule — read-before-update ordering", () => {
  it("the instrumented spy records reads and updates independently", async () => {
    const log: CallLog = { reads: [], updates: [], ordered: [] };
    const store = instrumentedStore(log, baseTrace);

    await store.getByWorkUnitId("wu_check");
    await store.update("wu_check", { executionSummary: "done" });

    expect(log.reads).toContain("wu_check");
    expect(log.updates).toContain("wu_check");
  });

  it("a deliberately-broken caller (update without prior read) is detected by the spy", async () => {
    const log: CallLog = { reads: [], updates: [], ordered: [] };
    const store = instrumentedStore(log, baseTrace);

    // Intentionally skip the read — simulates a caller that bypasses the gate
    await store.update("wu_broken", { executionSummary: "x" });

    expect(log.reads).not.toContain("wu_broken");
    expect(log.updates).toContain("wu_broken");
  });

  it("a compliant caller (read before update) leaves both IDs in the log with read first", async () => {
    const log: CallLog = { reads: [], updates: [], ordered: [] };
    const store = instrumentedStore(log, baseTrace);

    // Compliant: read first, then update
    const readResult = await store.getByWorkUnitId("wu_good");
    expect(readResult?.integrity.status).toBe("ok");

    await store.update("wu_good", { executionSummary: "done" });

    expect(log.reads).toContain("wu_good");
    expect(log.updates).toContain("wu_good");
    // Read MUST precede update — verified via the ordered call log
    expect(log.ordered.indexOf("read:wu_good")).toBeLessThan(log.ordered.indexOf("update:wu_good"));
  });
});

// ---------------------------------------------------------------------------
// Skipped describe block — named call sites awaiting fixture wiring
// ---------------------------------------------------------------------------

describe.skip("call site verification (requires lifecycle fixtures)", () => {
  // Each of these tests would use instrumentedStore + a real lifecycle
  // fixture to drive execution through to the update() call, then assert
  // that the read ID appears in the log before the update ID.
  //
  // See packages/core/src/platform/__tests__/platform-lifecycle.test.ts
  // for the fixture construction pattern.

  it.todo(
    "approval/lifecycle-service.ts:151 (rejectLifecycle) — " +
      "getByWorkUnitId(lifecycle.actionEnvelopeId) precedes update(lifecycle.actionEnvelopeId)",
  );

  it.todo(
    "platform-lifecycle.ts respondToApproval (~line 88) — " +
      "getByWorkUnitId(approval.envelopeId) precedes updateWorkTraceApproval",
  );

  it.todo(
    "platform-lifecycle.ts executeAfterApproval (~line 295) — " +
      "getByWorkUnitId(workUnitId) precedes modeRegistry.dispatch and subsequent update",
  );
});
