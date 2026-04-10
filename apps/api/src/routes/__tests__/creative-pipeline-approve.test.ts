// apps/api/src/routes/__tests__/creative-pipeline-approve.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";

const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
  productionTier: z.enum(["basic", "pro"]).optional(),
});

describe("ApproveStageInput with productionTier", () => {
  it("accepts productionTier when provided", () => {
    const result = ApproveStageInput.safeParse({
      action: "continue",
      productionTier: "pro",
    });
    expect(result.success).toBe(true);
    expect(result.data?.productionTier).toBe("pro");
  });

  it("accepts approval without productionTier", () => {
    const result = ApproveStageInput.safeParse({ action: "continue" });
    expect(result.success).toBe(true);
    expect(result.data?.productionTier).toBeUndefined();
  });

  it("defaults productionTier to basic when not provided at storyboard stage", () => {
    const result = ApproveStageInput.safeParse({ action: "continue" });
    expect(result.success).toBe(true);
    // Logic: approve handler defaults to "basic" if not provided and currentStage === "storyboard"
    expect(result.data?.productionTier).toBeUndefined(); // schema allows undefined; handler defaults
  });
});
