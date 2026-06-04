/**
 * Slice-2 topology regression (spec 3.4): taste rows live on Mira's CREATIVE
 * deployment (seeded by seed-mira-creative-deployment), never shared with a
 * conversational agent's deployment. The context builder queries memories by
 * the PROMPTED deployment's id, so taste rows on the creative deployment can
 * never surface in another deployment's learned-facts block or compete in its
 * 500-entry eviction pool. These tests pin that store-scoped isolation and
 * document the known same-deployment behavior (non-pattern categories flow
 * into learnedFacts for the deployment that owns them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextBuilder } from "../context-builder.js";
import { createInMemoryMetrics, setMetrics } from "../../telemetry/metrics.js";

const CREATIVE_DEP = "dep-mira-creative";
const ALEX_DEP = "dep-alex";

const TASTE_ROW = {
  id: "m-taste",
  content: "Operator kept polished creatives with question-style hooks",
  category: "taste",
  canonicalKey: "taste:kept_polished_question",
  confidence: 0.7,
  sourceCount: 4,
  lastSeenAt: new Date("2026-06-04T00:00:00Z"),
};

function depsWithTasteOnCreativeDeployment() {
  return {
    knowledgeRetriever: { retrieve: vi.fn().mockResolvedValue([]) },
    deploymentMemoryStore: {
      // Store-scoped isolation: rows exist ONLY for the creative deployment.
      listHighConfidence: vi
        .fn()
        .mockImplementation(async (_org: string, deploymentId: string) =>
          deploymentId === CREATIVE_DEP ? [TASTE_ROW] : [],
        ),
    },
    interactionSummaryStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
    evidenceStore: { countDistinctBookingIds: vi.fn().mockResolvedValue(0) },
  };
}

describe("taste memory cross-deployment isolation", () => {
  beforeEach(() => setMetrics(createInMemoryMetrics()));
  afterEach(() => setMetrics(createInMemoryMetrics()));

  it("a conversation-context build for ANOTHER deployment never surfaces creative-deployment taste rows", async () => {
    const deps = depsWithTasteOnCreativeDeployment();
    const builder = new ContextBuilder(deps as never);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "alex",
      deploymentId: ALEX_DEP,
      query: "What do customers ask before booking?",
    });

    // The builder queried the PROMPTED deployment only.
    expect(deps.deploymentMemoryStore.listHighConfidence).toHaveBeenCalledWith(
      "org-1",
      ALEX_DEP,
      expect.any(Number),
      expect.any(Number),
    );
    expect(result.learnedFacts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("question-style hooks");
  });

  it("documents the known same-deployment behavior: taste rows DO flow into the creative deployment's own learnedFacts", async () => {
    const deps = depsWithTasteOnCreativeDeployment();
    const builder = new ContextBuilder(deps as never);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "mira",
      deploymentId: CREATIVE_DEP,
      query: "anything",
    });

    // Non-pattern categories flow into the fact-like branch for the deployment
    // that owns them (context-builder compares only against the "pattern"
    // literal). The TOPOLOGY invariant (own deployment, never shared) is what
    // keeps this from leaking into conversational prompts.
    expect(result.learnedFacts).toHaveLength(1);
    expect(result.learnedFacts[0]).toMatchObject({ category: "taste" });
  });
});
