import { describe, it, expect } from "vitest";
import { ok, fail, denied, pendingApproval } from "../tool-result.js";

describe("ToolResult helpers", () => {
  it("ok() creates a success result", () => {
    const result = ok({ name: "Alice" }, { nextActions: ["update_stage"] });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ name: "Alice" });
    expect(result.nextActions).toEqual(["update_stage"]);
    expect(result.error).toBeUndefined();
  });

  it("ok() with no data", () => {
    const result = ok();
    expect(result.status).toBe("success");
    expect(result.data).toBeUndefined();
  });

  it("ok() with entityState", () => {
    const result = ok({ id: "opp_1" }, { entityState: { stage: "qualified" } });
    expect(result.entityState).toEqual({ stage: "qualified" });
  });

  it("fail() creates an error result", () => {
    const result = fail("INVALID_INPUT", "Missing contactId", {
      modelRemediation: "Include contactId in the request",
      retryable: false,
    });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toBe("Missing contactId");
    expect(result.error?.modelRemediation).toBe("Include contactId in the request");
    expect(result.error?.retryable).toBe(false);
  });

  it("fail() defaults retryable to false", () => {
    const result = fail("SOME_ERROR", "Something broke");
    expect(result.error?.retryable).toBe(false);
  });

  it("denied() creates a denied result", () => {
    const result = denied("Not permitted at supervised trust level");
    expect(result.status).toBe("denied");
    expect(result.error?.code).toBe("DENIED_BY_POLICY");
    expect(result.error?.message).toBe("Not permitted at supervised trust level");
    expect(result.error?.retryable).toBe(false);
  });

  it("denied() with modelRemediation", () => {
    const result = denied("Blocked", "Try a read operation instead");
    expect(result.error?.modelRemediation).toBe("Try a read operation instead");
  });

  it("pendingApproval() creates a pending result", () => {
    const result = pendingApproval("Requires human approval");
    expect(result.status).toBe("pending_approval");
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(result.error?.message).toBe("Requires human approval");
    expect(result.error?.retryable).toBe(false);
  });

  describe("fail() category-aware overload", () => {
    it("uses taxonomy defaults when category is provided", () => {
      const result = fail("execution", "TOOL_NOT_FOUND", "Unknown tool: foo.bar");
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("TOOL_NOT_FOUND");
      expect(result.error?.message).toBe("Unknown tool: foo.bar");
      expect(result.error?.modelRemediation).toBe(
        "Tool not found. Check available tools for this skill.",
      );
      expect(result.error?.operatorRemediation).toBe("Tool ID does not match any registered tool.");
      expect(result.error?.retryable).toBe(false);
    });

    it("allows custom overrides with category form", () => {
      const result = fail("governance", "DENIED_BY_POLICY", "Blocked", {
        modelRemediation: "Custom model fix",
        retryable: true,
      });
      expect(result.error?.modelRemediation).toBe("Custom model fix");
      expect(result.error?.retryable).toBe(true);
      // operatorRemediation falls back to default
      expect(result.error?.operatorRemediation).toBe(
        "Policy denied the action. Check governance rules.",
      );
    });

    it("without category still works (backward compat)", () => {
      const result = fail("SOME_CODE", "Something failed");
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("SOME_CODE");
      expect(result.error?.message).toBe("Something failed");
      expect(result.error?.modelRemediation).toBeUndefined();
      expect(result.error?.retryable).toBe(false);
    });

    it("backward compat with opts", () => {
      const result = fail("MY_CODE", "Broke", {
        modelRemediation: "Fix it",
        retryable: true,
        data: { detail: "x" },
      });
      expect(result.error?.code).toBe("MY_CODE");
      expect(result.error?.modelRemediation).toBe("Fix it");
      expect(result.error?.retryable).toBe(true);
      expect(result.data).toEqual({ detail: "x" });
    });
  });
});
