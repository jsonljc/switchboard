import { describe, it, expect } from "vitest";
import {
  buildInfrastructureFailureAuditParams,
  extractErrorMessage,
  extractErrorMetadata,
} from "../infrastructure-failure.js";

const baseWorkUnit = {
  id: "wu_1",
  intent: "test.intent",
  traceId: "t_1",
  organizationId: "org_1",
  deployment: { deploymentId: "dep_1" },
};

describe("extractErrorMessage", () => {
  it("returns Error.message", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error throws", () => {
    expect(extractErrorMessage("oops")).toBe("oops");
    expect(extractErrorMessage({ code: 42 })).toBe('{"code":42}');
    expect(extractErrorMessage(null)).toBe("null");
  });
});

describe("extractErrorMetadata", () => {
  it("returns name and stack for Error instances", () => {
    const meta = extractErrorMetadata(new TypeError("boom"));
    expect(meta.name).toBe("TypeError");
    expect(typeof meta.stack).toBe("string");
  });
  it("truncates stack to 2000 chars", () => {
    const longStack = "x".repeat(5000);
    const err = new Error("long");
    err.stack = longStack;
    expect(extractErrorMetadata(err).stack?.length).toBe(2000);
  });
  it("returns empty object for non-Error throws", () => {
    expect(extractErrorMetadata("oops")).toEqual({});
    expect(extractErrorMetadata(null)).toEqual({});
  });
});

describe("buildInfrastructureFailureAuditParams — error metadata", () => {
  it("populates errorName and errorStack on snapshot, omits from alert", () => {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: new TypeError("db down"),
      retryable: false,
    });
    expect(ledgerParams.snapshot.errorName).toBe("TypeError");
    expect(typeof ledgerParams.snapshot.errorStack).toBe("string");
    // Alert payload stays small — name/stack live only in the audit ledger.
    expect("errorName" in alert).toBe(false);
    expect("errorStack" in alert).toBe(false);
  });
  it("omits errorName/errorStack when error is not an Error instance", () => {
    const { ledgerParams } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: "string error",
      retryable: false,
    });
    expect("errorName" in ledgerParams.snapshot).toBe(false);
    expect("errorStack" in ledgerParams.snapshot).toBe(false);
  });
});

describe("buildInfrastructureFailureAuditParams", () => {
  it("populates all fields from workUnit when present", () => {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "governance_eval_exception",
      error: new Error("gate exploded"),
      workUnit: baseWorkUnit,
      retryable: false,
    });

    expect(ledgerParams.eventType).toBe("action.failed");
    expect(ledgerParams.entityType).toBe("work_unit");
    expect(ledgerParams.entityId).toBe("wu_1");
    expect(ledgerParams.actorType).toBe("system");
    expect(ledgerParams.actorId).toBe("platform_ingress");
    expect(ledgerParams.organizationId).toBe("org_1");
    expect(ledgerParams.traceId).toBe("t_1");
    expect(ledgerParams.snapshot).toMatchObject({
      errorType: "governance_eval_exception",
      failureClass: "infrastructure",
      severity: "critical",
      errorMessage: "gate exploded",
      intent: "test.intent",
      traceId: "t_1",
      deploymentId: "dep_1",
      organizationId: "org_1",
      retryable: false,
    });
    expect(typeof ledgerParams.snapshot.occurredAt).toBe("string");

    expect(alert).toMatchObject({
      errorType: "governance_eval_exception",
      severity: "critical",
      errorMessage: "gate exploded",
      intent: "test.intent",
      traceId: "t_1",
      deploymentId: "dep_1",
      organizationId: "org_1",
      retryable: false,
      source: "platform_ingress",
    });
    expect(typeof alert.occurredAt).toBe("string");
  });

  it("omits optional snapshot fields when workUnit is absent", () => {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: new Error("db down"),
      retryable: false,
    });

    const snap = ledgerParams.snapshot as unknown as Record<string, unknown>;
    expect("intent" in snap).toBe(false);
    expect("traceId" in snap).toBe(false);
    expect("deploymentId" in snap).toBe(false);
    expect("organizationId" in snap).toBe(false);
    expect(snap.failureClass).toBe("infrastructure");
    expect(snap.severity).toBe("critical");
    expect(snap.errorType).toBe("trace_persist_failed");

    expect("intent" in alert).toBe(false);
    expect("traceId" in alert).toBe(false);
    expect(ledgerParams.entityId).toBe("unknown");
    expect(ledgerParams.organizationId).toBeUndefined();
    expect(ledgerParams.traceId).toBeNull();
  });

  it("uses critical severity for both error types by default", () => {
    const a = buildInfrastructureFailureAuditParams({
      errorType: "governance_eval_exception",
      error: new Error("x"),
      retryable: false,
    });
    const b = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: new Error("x"),
      retryable: false,
    });
    expect(a.alert.severity).toBe("critical");
    expect(b.alert.severity).toBe("critical");
  });

  it("handles non-Error throws via extractErrorMessage", () => {
    const { alert } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: "string error",
      retryable: false,
    });
    expect(alert.errorMessage).toBe("string error");
  });
});
