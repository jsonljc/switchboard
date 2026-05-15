import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextBuilder } from "../context-builder.js";
import {
  createInMemoryMetrics,
  setMetrics,
  type SwitchboardMetrics,
} from "../../telemetry/metrics.js";

function createMetricsSpy(): SwitchboardMetrics {
  const base = createInMemoryMetrics();
  vi.spyOn(base.outcomePatternsSurfaced, "inc");
  return base;
}

let metricsSpy: SwitchboardMetrics;

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
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
  });

  afterEach(() => {
    // Restore the module-singleton metrics so this test file doesn't leak its
    // spy instance into other test files running in the same vitest worker.
    setMetrics(createInMemoryMetrics());
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
        lastSeenAt: new Date(),
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
      lastSeenAt: new Date(),
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

  it("sorts retrieved chunks by source type priority (corrections first)", async () => {
    // Set up mock to return chunks in wrong order
    deps.knowledgeRetriever.retrieve.mockResolvedValue([
      { content: "from document", sourceType: "document", similarity: 0.95 },
      { content: "owner correction", sourceType: "correction", similarity: 0.8 },
      { content: "learned fact", sourceType: "learned", similarity: 0.9 },
      { content: "from wizard", sourceType: "wizard", similarity: 0.85 },
    ]);
    const builder = new ContextBuilder(deps);
    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "test",
    });
    // Verify priority order regardless of similarity
    expect(result.retrievedChunks[0]!.sourceType).toBe("correction");
    expect(result.retrievedChunks[1]!.sourceType).toBe("wizard");
    expect(result.retrievedChunks[2]!.sourceType).toBe("learned");
    expect(result.retrievedChunks[3]!.sourceType).toBe("document");
  });

  it("includes formatted outcome patterns in built context", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "m1",
        content: "Customers ask about downtime before booking laser treatment",
        category: "pattern",
        canonicalKey: "objection:downtime_work",
        confidence: 0.85,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Tell me about laser",
    });

    expect(result.outcomePatternContext).toMatch(/<outcome-patterns>/);
    expect(result.outcomePatternContext).toContain("downtime");
  });

  it("returns injectedPatternIds matching the rendered <pattern id> attributes", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "pat_abc",
        content: "Customers ask about downtime",
        category: "pattern",
        canonicalKey: "objection:downtime_work",
        confidence: 0.78,
        sourceCount: 4,
        lastSeenAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "downtime question",
    });

    expect(result.injectedPatternIds).toEqual(["pat_abc"]);
    expect(result.outcomePatternContext).toMatch(/id="pat_abc"/);
  });

  it("returns [] for injectedPatternIds when no patterns surface", async () => {
    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "anything",
    });
    expect(result.injectedPatternIds).toEqual([]);
  });

  it("returns [] for injectedPatternIds when patterns collapse to empty after escaping", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "pat_collapse",
        content: "\x00\x01\x02",
        category: "pattern",
        canonicalKey: "objection:downtime_work",
        confidence: 0.85,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "x",
    });
    expect(result.outcomePatternContext).toBe("");
    expect(result.injectedPatternIds).toEqual([]);
  });

  it("excludes category:'pattern' rows from learnedFacts even when high-confidence", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "p1",
        content: "Customers ask about downtime",
        category: "pattern",
        confidence: 0.9,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
      {
        id: "f1",
        content: "Numbing cream onset is 20 minutes",
        category: "treatment_protocol",
        confidence: 0.9,
        sourceCount: 4,
        lastSeenAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "tell me about laser",
    });

    expect(result.learnedFacts).toHaveLength(1);
    expect(result.learnedFacts[0]!.category).toBe("treatment_protocol");
    expect(result.outcomePatternContext).toContain("downtime");
  });

  it("increments outcomePatternsSurfaced when at least one pattern is injected", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "p1",
        content: "Customers ask about downtime",
        category: "pattern",
        confidence: 0.85,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
    ]);

    await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "tell me about laser",
    });

    expect(metricsSpy.outcomePatternsSurfaced.inc).toHaveBeenCalledWith({
      deploymentId: "dep-1",
    });
    expect(metricsSpy.outcomePatternsSurfaced.inc).toHaveBeenCalledTimes(1);
  });

  it("does not increment outcomePatternsSurfaced when no patterns surface", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "p1",
        content: "weak signal",
        category: "pattern",
        confidence: 0.55,
        sourceCount: 1,
        lastSeenAt: new Date(),
      },
    ]);

    await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "x",
    });

    expect(metricsSpy.outcomePatternsSurfaced.inc).not.toHaveBeenCalled();
  });

  it("excludes low-confidence patterns from outcomePatternContext", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "m1",
        content: "Weak signal",
        category: "pattern",
        confidence: 0.67,
        sourceCount: 2, // below SURFACING_THRESHOLD.minSourceCount (3)
        lastSeenAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "test",
    });

    expect(result.outcomePatternContext).toBe("");
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
