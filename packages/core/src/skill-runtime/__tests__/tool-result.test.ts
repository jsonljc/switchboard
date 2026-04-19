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
});
