import { describe, it, expect } from "vitest";
import { executePublish } from "../../execute/publish.js";
import type { EmployeeContext } from "@switchboard/employee-sdk";

const mockContext = {} as EmployeeContext;

describe("executePublish", () => {
  it("succeeds with valid params", async () => {
    const result = await executePublish(
      {
        draftId: "draft-1",
        channel: "linkedin",
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("linkedin");
    expect(result.externalRefs.draftId).toBe("draft-1");
  });

  it("accepts optional scheduledFor", async () => {
    const result = await executePublish(
      {
        draftId: "draft-2",
        channel: "twitter",
        scheduledFor: "2026-04-10T10:00:00.000Z",
      },
      mockContext,
    );

    expect(result.success).toBe(true);
  });

  it("fails with missing draftId", async () => {
    const result = await executePublish({ channel: "linkedin" }, mockContext);

    expect(result.success).toBe(false);
  });
});
