import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateProvider } from "../state-provider.js";

function createMockStore() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
}

describe("StateProvider", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let provider: StateProvider;

  beforeEach(() => {
    mockStore = createMockStore();
    provider = new StateProvider("dep_1", mockStore);
  });

  it("delegates get with deploymentId", async () => {
    mockStore.get.mockResolvedValue(42);
    const result = await provider.get("count");
    expect(result).toBe(42);
    expect(mockStore.get).toHaveBeenCalledWith("dep_1", "count");
  });

  it("delegates set with deploymentId", async () => {
    mockStore.set.mockResolvedValue(undefined);
    await provider.set("count", 42);
    expect(mockStore.set).toHaveBeenCalledWith("dep_1", "count", 42);
  });

  it("delegates list with deploymentId", async () => {
    mockStore.list.mockResolvedValue([{ key: "a", value: 1 }]);
    const result = await provider.list("prefix:");
    expect(result).toEqual([{ key: "a", value: 1 }]);
    expect(mockStore.list).toHaveBeenCalledWith("dep_1", "prefix:");
  });

  it("delegates delete with deploymentId", async () => {
    mockStore.delete.mockResolvedValue(undefined);
    await provider.delete("count");
    expect(mockStore.delete).toHaveBeenCalledWith("dep_1", "count");
  });
});
