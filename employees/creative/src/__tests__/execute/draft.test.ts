import { describe, it, expect } from "vitest";
import { executeDraft } from "../../execute/draft.js";
import type { EmployeeContext } from "@switchboard/employee-sdk";

const mockContext = {} as EmployeeContext;

describe("executeDraft", () => {
  it("succeeds with valid params", async () => {
    const result = await executeDraft(
      {
        content: "AI is transforming business operations.",
        channel: "linkedin",
        format: "post",
        topic: "AI trends",
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("linkedin");
    expect(result.data).toEqual(
      expect.objectContaining({
        content: "AI is transforming business operations.",
        channel: "linkedin",
        format: "post",
      }),
    );
  });

  it("fails with invalid params", async () => {
    const result = await executeDraft({ content: 123 }, mockContext);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Invalid");
  });

  it("fails with invalid channel", async () => {
    const result = await executeDraft(
      {
        content: "Test",
        channel: "tiktok",
        format: "post",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
  });
});
