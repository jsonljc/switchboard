import { describe, it, expect } from "vitest";
import { buildRileyBudgetExecutorHandler } from "../riley-budget-executor.js";

describe("buildRileyBudgetExecutorHandler (Spec-1B fail-closed placeholder)", () => {
  it("registers the reallocate intent", () => {
    expect(buildRileyBudgetExecutorHandler().intent).toBe("adoptimizer.campaign.reallocate");
  });

  it("FAILS CLOSED (EXECUTOR_NOT_WIRED), never returns completed, never touches Meta", async () => {
    const { handler } = buildRileyBudgetExecutorHandler();
    const result = await handler.execute({} as never, {} as never);
    expect(result.outcome).toBe("failed");
    expect(result.outcome).not.toBe("completed");
    expect(result.error?.code).toBe("EXECUTOR_NOT_WIRED");
    // Structural pin: the handler closure has no ads client in scope, so it cannot move money.
  });
});
