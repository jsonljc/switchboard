import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextBuilder } from "../context-builder.js";

function createMockDeps() {
  return {
    knowledgeRetriever: {
      retrieve: vi.fn().mockResolvedValue([]),
    },
    deploymentMemoryStore: {
      listHighConfidence: vi.fn().mockResolvedValue([]),
    },
    interactionSummaryStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("ContextBuilder", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let builder: ContextBuilder;

  beforeEach(() => {
    deps = createMockDeps();
    builder = new ContextBuilder(deps);
  });

  it("returns empty context when no data exists", async () => {
    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "What services do you offer?",
    });

    expect(result.retrievedChunks).toEqual([]);
    expect(result.learnedFacts).toEqual([]);
    expect(result.recentSummaries).toEqual([]);
    expect(result.totalTokenEstimate).toBe(0);
  });

  it("includes retrieved knowledge chunks", async () => {
    deps.knowledgeRetriever.retrieve.mockResolvedValue([
      { content: "We offer teeth whitening.", sourceType: "wizard", similarity: 0.9, metadata: {} },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "What services?",
    });

    expect(result.retrievedChunks).toHaveLength(1);
    expect(result.retrievedChunks[0]?.content).toBe("We offer teeth whitening.");
  });

  it("includes high-confidence deployment memory", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "m1",
        content: "Closed on Sundays",
        category: "fact",
        confidence: 0.85,
        sourceCount: 5,
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Are you open today?",
    });

    expect(result.learnedFacts).toHaveLength(1);
    expect(result.learnedFacts[0]?.content).toBe("Closed on Sundays");
  });

  it("respects token budget — truncates when over limit", async () => {
    const manyFacts = Array.from({ length: 700 }, (_, i) => ({
      id: `m${i}`,
      content: `Fact number ${i} about biz`,
      category: "fact",
      confidence: 0.9,
      sourceCount: 10,
    }));
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue(manyFacts);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Tell me everything",
      tokenBudget: 4000,
    });

    expect(result.totalTokenEstimate).toBeLessThanOrEqual(4000);
    expect(result.learnedFacts.length).toBeLessThan(700);
  });

  it("includes repeat customer summaries when contactId provided", async () => {
    deps.interactionSummaryStore.listByDeployment.mockResolvedValue([
      {
        id: "s1",
        summary: "Customer asked about teeth whitening.",
        outcome: "info_request",
        createdAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Hello",
      contactId: "contact-1",
    });

    expect(result.recentSummaries).toHaveLength(1);
  });
});
