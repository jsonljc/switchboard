import { describe, it, expect, vi } from "vitest";
import { BrandMemory } from "../brand-memory.js";
import type { BrandMemoryStore } from "../interfaces.js";

function createMockStore(): BrandMemoryStore {
  return {
    search: vi.fn(),
    ingest: vi.fn(),
  };
}

describe("BrandMemory", () => {
  const orgId = "org-1";
  const employeeId = "emp-1";

  it("delegates search to the store with bound orgId and employeeId", async () => {
    const store = createMockStore();
    const results = [{ content: "Brand voice is casual", similarity: 0.92 }];
    vi.mocked(store.search).mockResolvedValue(results);

    const memory = new BrandMemory(store, orgId, employeeId);
    const actual = await memory.search("brand voice", 5);

    expect(actual).toEqual(results);
    expect(store.search).toHaveBeenCalledWith(orgId, employeeId, "brand voice", 5);
  });

  it("delegates search without topK when not provided", async () => {
    const store = createMockStore();
    vi.mocked(store.search).mockResolvedValue([]);

    const memory = new BrandMemory(store, orgId, employeeId);
    await memory.search("tone");

    expect(store.search).toHaveBeenCalledWith(orgId, employeeId, "tone", undefined);
  });

  it("delegates ingest to the store with bound orgId and employeeId", async () => {
    const store = createMockStore();
    vi.mocked(store.ingest).mockResolvedValue(undefined);

    const memory = new BrandMemory(store, orgId, employeeId);
    await memory.ingest("doc-1", "Our brand is fun and approachable", "brand");

    expect(store.ingest).toHaveBeenCalledWith(
      orgId,
      employeeId,
      "doc-1",
      "Our brand is fun and approachable",
      "brand",
    );
  });

  it("passes correction source type through", async () => {
    const store = createMockStore();
    vi.mocked(store.ingest).mockResolvedValue(undefined);

    const memory = new BrandMemory(store, orgId, employeeId);
    await memory.ingest("doc-2", "Do not use slang", "correction");

    expect(store.ingest).toHaveBeenCalledWith(
      orgId,
      employeeId,
      "doc-2",
      "Do not use slang",
      "correction",
    );
  });
});
