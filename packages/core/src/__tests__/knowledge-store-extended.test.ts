import { describe, it, expect } from "vitest";
import type { KnowledgeSourceType, KnowledgeSearchOptions } from "../knowledge-store.js";

describe("KnowledgeSourceType extended", () => {
  it("accepts 'learned' as a valid source type", () => {
    const sourceType: KnowledgeSourceType = "learned";
    expect(sourceType).toBe("learned");
  });

  it("KnowledgeSearchOptions accepts optional deploymentId", () => {
    const opts: KnowledgeSearchOptions = {
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      topK: 5,
    };
    expect(opts.deploymentId).toBe("dep-1");
  });

  it("KnowledgeSearchOptions works without deploymentId", () => {
    const opts: KnowledgeSearchOptions = {
      organizationId: "org-1",
      agentId: "agent-1",
    };
    expect(opts.deploymentId).toBeUndefined();
  });
});
