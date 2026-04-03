import { describe, it, expect, vi } from "vitest";
import { PerformanceQuery } from "../performance-query.js";
import type { PerformanceStore } from "../interfaces.js";

function createMockStore(): PerformanceStore {
  return {
    record: vi.fn(),
    getTop: vi.fn(),
    getApprovalRate: vi.fn(),
  };
}

describe("PerformanceQuery", () => {
  const orgId = "org-1";
  const employeeId = "emp-1";

  it("delegates getTop to the store with bound orgId and employeeId", async () => {
    const store = createMockStore();
    const topContent = [
      { contentId: "c-1", metrics: { engagement: 0.95, clicks: 120 } },
      { contentId: "c-2", metrics: { engagement: 0.88, clicks: 95 } },
    ];
    vi.mocked(store.getTop).mockResolvedValue(topContent);

    const query = new PerformanceQuery(store, orgId, employeeId);
    const actual = await query.getTop("instagram", 10);

    expect(actual).toEqual(topContent);
    expect(store.getTop).toHaveBeenCalledWith(orgId, employeeId, "instagram", 10);
  });

  it("delegates getApprovalRate to the store with bound orgId and employeeId", async () => {
    const store = createMockStore();
    const rate = { total: 50, approved: 45, rate: 0.9 };
    vi.mocked(store.getApprovalRate).mockResolvedValue(rate);

    const query = new PerformanceQuery(store, orgId, employeeId);
    const actual = await query.getApprovalRate();

    expect(actual).toEqual(rate);
    expect(store.getApprovalRate).toHaveBeenCalledWith(orgId, employeeId);
  });

  it("returns zero rate when no events recorded", async () => {
    const store = createMockStore();
    vi.mocked(store.getApprovalRate).mockResolvedValue({ total: 0, approved: 0, rate: 0 });

    const query = new PerformanceQuery(store, orgId, employeeId);
    const actual = await query.getApprovalRate();

    expect(actual).toEqual({ total: 0, approved: 0, rate: 0 });
  });
});
