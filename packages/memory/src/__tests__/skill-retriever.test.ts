import { describe, it, expect, vi } from "vitest";
import { SkillRetriever } from "../skill-retriever.js";
import type { SkillStore } from "../interfaces.js";

function createMockStore(): SkillStore {
  return {
    getRelevant: vi.fn(),
    save: vi.fn(),
    evolve: vi.fn(),
  };
}

describe("SkillRetriever", () => {
  const orgId = "org-1";
  const employeeId = "emp-1";

  it("delegates getRelevant to the store with all parameters", async () => {
    const store = createMockStore();
    const skills = [{ id: "s-1", pattern: "Use hashtags", score: 0.85, version: 2 }];
    vi.mocked(store.getRelevant).mockResolvedValue(skills);

    const retriever = new SkillRetriever(store, orgId, employeeId);
    const actual = await retriever.getRelevant("social-post", "instagram", 3);

    expect(actual).toEqual(skills);
    expect(store.getRelevant).toHaveBeenCalledWith(
      orgId,
      employeeId,
      "social-post",
      "instagram",
      3,
    );
  });

  it("passes undefined for optional parameters when not provided", async () => {
    const store = createMockStore();
    vi.mocked(store.getRelevant).mockResolvedValue([]);

    const retriever = new SkillRetriever(store, orgId, employeeId);
    await retriever.getRelevant("email");

    expect(store.getRelevant).toHaveBeenCalledWith(
      orgId,
      employeeId,
      "email",
      undefined,
      undefined,
    );
  });

  it("returns empty array when no skills match", async () => {
    const store = createMockStore();
    vi.mocked(store.getRelevant).mockResolvedValue([]);

    const retriever = new SkillRetriever(store, orgId, employeeId);
    const actual = await retriever.getRelevant("unknown-task");

    expect(actual).toEqual([]);
  });
});
