import { describe, it, expect, vi } from "vitest";
import { ExecuteResultBuilder, failResult } from "../result-builder.js";

describe("ExecuteResultBuilder", () => {
  it("builds a success result with defaults", () => {
    const result = ExecuteResultBuilder.start().success("Campaign paused").build();

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Campaign paused");
    expect(result.externalRefs).toEqual({});
    expect(result.rollbackAvailable).toBe(false);
    expect(result.partialFailures).toEqual([]);
    expect(result.undoRecipe).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("builds a failure result", () => {
    const result = ExecuteResultBuilder.start()
      .failure("Missing campaignId")
      .addFailure("validate", "Missing campaignId")
      .build();

    expect(result.success).toBe(false);
    expect(result.summary).toBe("Missing campaignId");
    expect(result.partialFailures).toEqual([{ step: "validate", error: "Missing campaignId" }]);
  });

  it("chains refs, rollback, and undo", () => {
    const undo = {
      originalActionId: "a1",
      originalEnvelopeId: "e1",
      reverseActionType: "campaign.resume",
      reverseParameters: {},
      undoExpiresAt: new Date(),
      undoRiskCategory: "low" as const,
      undoApprovalRequired: "none" as const,
    };

    const result = ExecuteResultBuilder.start()
      .success("Campaign paused")
      .refs({ campaignId: "c123" })
      .undo(undo)
      .build();

    expect(result.externalRefs).toEqual({ campaignId: "c123" });
    expect(result.rollbackAvailable).toBe(true);
    expect(result.undoRecipe).toBe(undo);
  });

  it("includes data when set", () => {
    const result = ExecuteResultBuilder.start()
      .success("Diagnosis complete")
      .data({ score: 0.85 })
      .build();

    expect(result.data).toEqual({ score: 0.85 });
  });

  it("omits data property when not set", () => {
    const result = ExecuteResultBuilder.start().success("Done").build();
    expect("data" in result).toBe(false);
  });

  it("computes durationMs from start time", () => {
    const start = Date.now() - 100;
    const result = new ExecuteResultBuilder(start).success("Done").build();
    expect(result.durationMs).toBeGreaterThanOrEqual(100);
  });

  it("accumulates multiple refs calls", () => {
    const result = ExecuteResultBuilder.start()
      .success("Created")
      .refs({ id: "a1" })
      .refs({ orderId: "o1" })
      .build();

    expect(result.externalRefs).toEqual({ id: "a1", orderId: "o1" });
  });

  it("accumulates multiple failures", () => {
    const result = ExecuteResultBuilder.start()
      .failure("Partial failure")
      .addFailure("step1", "err1")
      .addFailure("step2", "err2")
      .build();

    expect(result.partialFailures).toHaveLength(2);
  });
});

describe("failResult", () => {
  it("creates a standard validation failure", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const start = 900;
    const result = failResult(start, "Missing required field");

    expect(result.success).toBe(false);
    expect(result.summary).toBe("Missing required field");
    expect(result.partialFailures).toEqual([{ step: "validate", error: "Missing required field" }]);
    expect(result.durationMs).toBe(100);
    vi.useRealTimers();
  });

  it("accepts a custom step name", () => {
    const result = failResult(Date.now(), "API error", "execute");
    expect(result.partialFailures[0]?.step).toBe("execute");
  });
});
