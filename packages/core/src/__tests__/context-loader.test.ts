import { describe, it, expect } from "vitest";
import { NullContextLoader } from "../context-loader.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

describe("NullContextLoader", () => {
  const loader = new NullContextLoader();

  it("returns empty memory for any input", async () => {
    const memory = await loader.load({
      orgId: "org-1",
      employeeId: "emp-1",
      taskType: "content.draft",
      task: { goal: "draft post", scope: [], constraints: [], expectedOutput: "post" },
      limits: DEFAULT_CONTEXT_BUDGET_LIMITS,
    });

    expect(memory).toEqual({});
  });
});
