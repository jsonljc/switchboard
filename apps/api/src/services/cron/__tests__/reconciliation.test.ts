import { describe, expect, it, vi } from "vitest";
import { executeReconciliation } from "../reconciliation.js";
import type { ReconciliationCronDeps, StepTools } from "../reconciliation.js";

function makeStep(): StepTools {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()) as StepTools["run"],
  };
}

function makeDeps(overrides: Partial<ReconciliationCronDeps> = {}): ReconciliationCronDeps {
  return {
    listActiveOrganizations: vi.fn().mockResolvedValue([]),
    runReconciliation: vi.fn().mockResolvedValue({
      organizationId: "org_1",
      overallStatus: "healthy",
      checks: [],
    }),
    logActivity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("executeReconciliation", () => {
  it("returns zero counts when no organizations exist", async () => {
    const result = await executeReconciliation(makeStep(), makeDeps());

    expect(result).toEqual({ processed: 0, healthy: 0, degraded: 0, failing: 0 });
  });

  it("runs reconciliation for each active org", async () => {
    const deps = makeDeps({
      listActiveOrganizations: vi.fn().mockResolvedValue([
        { id: "org_1", name: "Org 1" },
        { id: "org_2", name: "Org 2" },
      ]),
    });

    const result = await executeReconciliation(makeStep(), deps);

    expect(result.processed).toBe(2);
    expect(result.healthy).toBe(2);
    expect(deps.runReconciliation).toHaveBeenCalledTimes(2);
  });

  it("counts degraded and failing statuses correctly", async () => {
    const deps = makeDeps({
      listActiveOrganizations: vi.fn().mockResolvedValue([
        { id: "org_1", name: "Org 1" },
        { id: "org_2", name: "Org 2" },
        { id: "org_3", name: "Org 3" },
      ]),
      runReconciliation: vi
        .fn()
        .mockResolvedValueOnce({ organizationId: "org_1", overallStatus: "healthy", checks: [] })
        .mockResolvedValueOnce({ organizationId: "org_2", overallStatus: "degraded", checks: [] })
        .mockResolvedValueOnce({ organizationId: "org_3", overallStatus: "failing", checks: [] }),
    });

    const result = await executeReconciliation(makeStep(), deps);

    expect(result.healthy).toBe(1);
    expect(result.degraded).toBe(1);
    expect(result.failing).toBe(1);
  });

  it("logs activity when logActivity is provided", async () => {
    const logActivity = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listActiveOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Org 1" }]),
      logActivity,
    });

    await executeReconciliation(makeStep(), deps);

    expect(logActivity).toHaveBeenCalledWith("org_1", "reconciliation.completed", {
      status: "healthy",
      checks: 0,
    });
  });

  it("counts failures when reconciliation throws", async () => {
    const deps = makeDeps({
      listActiveOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Org 1" }]),
      runReconciliation: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    });

    const result = await executeReconciliation(makeStep(), deps);

    expect(result.failing).toBe(1);
    expect(result.healthy).toBe(0);
  });
});
