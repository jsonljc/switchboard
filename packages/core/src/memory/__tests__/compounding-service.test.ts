import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import {
  createInMemoryMetrics,
  setMetrics,
  type SwitchboardMetrics,
} from "../../telemetry/metrics.js";
import {
  baseEvent,
  createEvent,
  createMetricsSpy,
  createMockDeps,
  primeFaqExtractionLlm,
} from "./compounding-service-fixtures.js";

let metricsSpy: SwitchboardMetrics;

describe("ConversationCompoundingService", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let service: ConversationCompoundingService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ConversationCompoundingService(deps);
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
  });

  afterEach(() => {
    // Restore the module-singleton metrics so this test file doesn't leak its
    // spy instance into other test files running in the same vitest worker
    // (notably context-builder.test.ts, which also reads getMetrics()).
    setMetrics(createInMemoryMetrics());
  });

  it("creates an interaction summary from LLM output", async () => {
    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Customer inquired about teeth whitening pricing.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [
            {
              fact: "Teeth whitening costs $299",
              confidence: 0.8,
              category: "fact",
            },
          ],
          questions: ["What services do you offer?", "How much is teeth whitening?"],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.interactionSummaryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        deploymentId: "dep-1",
        summary: "Customer inquired about teeth whitening pricing.",
        outcome: "info_request",
      }),
    );
  });

  it("creates deployment memory entries for extracted facts", async () => {
    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Customer asked about pricing.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "Closed on Sundays", confidence: 0.7, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Closed on Sundays",
        category: "fact",
      }),
    );
  });

  it("increments existing memory when similar fact found via embedding", async () => {
    const existingMemory = {
      id: "mem-existing",
      content: "They are closed on Sundays",
      category: "fact",
      confidence: 0.5,
      sourceCount: 1,
    };
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([existingMemory]);
    deps.embeddingAdapter.embed
      .mockResolvedValueOnce(new Array(1024).fill(0.5))
      .mockResolvedValueOnce(new Array(1024).fill(0.5));

    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Quick chat.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [
            {
              fact: "Closed on Sundays",
              confidence: 0.7,
              category: "fact",
            },
          ],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-existing",
      expect.any(Number),
    );
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("handles LLM errors gracefully without throwing", async () => {
    deps.llmClient.complete.mockRejectedValue(new Error("LLM timeout"));

    await expect(service.processConversationEnd(baseEvent)).resolves.not.toThrow();
  });

  it("skips conversations with fewer than 2 messages", async () => {
    const shortEvent = {
      ...baseEvent,
      messages: [{ role: "user", content: "hi" }],
      messageCount: 1,
    };
    await service.processConversationEnd(shortEvent);
    expect(deps.llmClient.complete).not.toHaveBeenCalled();
  });

  it("skips fact creation when deployment memory cap is reached", async () => {
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("reinforces an existing fact even when the memory cap is reached", async () => {
    // The cap must gate only NEW creates — reinforcement updates an existing
    // row in place and never grows the count, so it must always run.
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    const existingMemory = {
      id: "mem-existing",
      content: "They are closed on Sundays",
      category: "fact",
      confidence: 0.5,
      sourceCount: 1,
    };
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([existingMemory]);
    deps.embeddingAdapter.embed
      .mockResolvedValueOnce(new Array(1024).fill(0.5))
      .mockResolvedValueOnce(new Array(1024).fill(0.5));
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "Closed on Sundays", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-existing",
      expect.any(Number),
    );
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.invalidate).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.delete).not.toHaveBeenCalled();
  });

  it("evicts the lowest-confidence entry to admit a new fact when the newcomer outranks it", async () => {
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.deploymentMemoryStore.findEvictionCandidate.mockResolvedValue({
      id: "mem-stale",
      confidence: 0.3,
    });
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New high-value fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    // Eviction now routes through invalidate (soft-remove), NOT delete (hard-remove).
    expect(deps.deploymentMemoryStore.invalidate).toHaveBeenCalledWith("org-1", "mem-stale");
    expect(deps.deploymentMemoryStore.delete).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: "New high-value fact", category: "fact" }),
    );
  });

  it("tags the fact create with source: conversation-compounding", async () => {
    // Provenance: every new fact written by the compounding service must carry
    // source="conversation-compounding" so downstream invalidate/decay paths can
    // attribute the write correctly.
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(0);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "A fact with provenance", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "fact",
        source: "conversation-compounding",
      }),
    );
  });

  it("does not evict an entry whose confidence ties the newcomer", async () => {
    // Boundary: the rule is `NEW_FACT_CONFIDENCE <= candidate.confidence -> drop`,
    // so an equal-confidence candidate (0.5, the new-fact rank) must survive —
    // a newcomer only displaces a strictly-lower entry, never an equal one.
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.deploymentMemoryStore.findEvictionCandidate.mockResolvedValue({
      id: "mem-tie",
      confidence: 0.5,
    });
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.invalidate).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.delete).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("drops a new fact at cap when no entry ranks below the newcomer", async () => {
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.deploymentMemoryStore.findEvictionCandidate.mockResolvedValue({
      id: "mem-strong",
      confidence: 0.9,
    });
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.invalidate).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.delete).not.toHaveBeenCalled();
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("drops the new fact on a StaleVersionError when the eviction candidate vanished mid-flight (invalidate path)", async () => {
    // Race: another writer invalidated the candidate between find and invalidate.
    // invalidate() throws StaleVersionError (count===0) — we must not create a row
    // without having freed a slot, and must swallow this specific error.
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.deploymentMemoryStore.findEvictionCandidate.mockResolvedValue({
      id: "mem-gone",
      confidence: 0.3,
    });
    deps.deploymentMemoryStore.invalidate.mockRejectedValue(
      new StaleVersionError("mem-gone", -1, -1),
    );
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await expect(service.processConversationEnd(baseEvent)).resolves.not.toThrow();
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("does not swallow a non-StaleVersionError raised by the eviction invalidate", async () => {
    // A genuine DB failure during eviction must NOT be treated as the benign
    // race: it is rethrown past the eviction catch (no eviction warn) and lands
    // on processConversationEnd's error boundary (console.error). No fact is
    // created without a freed slot.
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.deploymentMemoryStore.findEvictionCandidate.mockResolvedValue({
      id: "mem-stale",
      confidence: 0.3,
    });
    deps.deploymentMemoryStore.invalidate.mockRejectedValue(new Error("connection reset"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await expect(service.processConversationEnd(baseEvent)).resolves.not.toThrow();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[CompoundingService] Failed to process conversation end:",
      expect.objectContaining({ message: "connection reset" }),
    );
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("tracks questions as FAQ and promotes to knowledge store at exactly 3 occurrences", async () => {
    const mockKnowledgeStore = {
      store: vi.fn().mockResolvedValue(undefined),
    };
    service = new ConversationCompoundingService({
      ...deps,
      knowledgeStore: mockKnowledgeStore,
      agentId: "agent-1",
    });

    const existingFaq = {
      id: "faq-1",
      content: "What services do you offer?",
      category: "faq",
      confidence: 0.6,
      sourceCount: 2,
    };
    deps.deploymentMemoryStore.findByCategory.mockImplementation(
      (_org: string, _dep: string, cat: string) =>
        Promise.resolve(cat === "faq" ? [existingFaq] : []),
    );
    deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "faq-1",
      sourceCount: 3,
    });
    deps.embeddingAdapter.embed
      .mockResolvedValueOnce(new Array(1024).fill(0.5))
      .mockResolvedValueOnce(new Array(1024).fill(0.5));

    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Asked about services.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [],
          questions: ["What services do you offer?"],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "faq-1",
      expect.any(Number),
    );
    expect(mockKnowledgeStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "learned",
        content: expect.stringContaining("Frequently asked question"),
      }),
    );

    const storeCall = mockKnowledgeStore.store.mock.calls[0]?.[0];
    expect(storeCall).toHaveProperty("draftStatus", "pending");
    expect(storeCall).toHaveProperty("draftExpiresAt");
    expect(storeCall.draftExpiresAt).toBeInstanceOf(Date);
    // Verify expiry is roughly 72 hours from now (within 1 minute tolerance)
    const expectedExpiry = Date.now() + 72 * 60 * 60 * 1000;
    expect(Math.abs(storeCall.draftExpiresAt.getTime() - expectedExpiry)).toBeLessThan(60_000);
  });

  // spec: assert learned chunks remain draft/pending under the "alex" agent wiring (PR-1 design spec)
  // Pre-existing test above already covers sourceType/draftStatus/72h expiry under a generic
  // agentId; this test pins the canonical "alex" agentId path end-to-end.
  it("promotes FAQ to learned KnowledgeChunk under canonical alex agentId", async () => {
    const knowledgeStore = { store: vi.fn().mockResolvedValue(undefined) };
    const localDeps = createMockDeps();
    // Pre-existing FAQ entry at 2 observations (one below threshold)
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "faq-1",
        content: "What is your cancellation policy?",
        category: "faq",
        sourceCount: 2,
        confidence: 0.6,
      },
    ]);
    localDeps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "faq-1",
      sourceCount: 3,
    });
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    primeFaqExtractionLlm(localDeps, "What is your cancellation policy?");

    const localService = new ConversationCompoundingService({
      ...localDeps,
      knowledgeStore,
      agentId: "alex",
    });

    await localService.processConversationEnd(createEvent());

    expect(knowledgeStore.store).toHaveBeenCalledTimes(1);
    const stored = knowledgeStore.store.mock.calls[0]![0];
    expect(stored.sourceType).toBe("learned");
    expect(stored.agentId).toBe("alex");
    expect(stored.draftStatus).toBe("pending");
    expect(stored.draftExpiresAt).toBeInstanceOf(Date);
  });

  it("skips FAQ promotion gracefully when knowledgeStore is not provided", async () => {
    const localDeps = createMockDeps();
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "faq-1",
        content: "What is your cancellation policy?",
        category: "faq",
        sourceCount: 2,
        confidence: 0.6,
      },
    ]);
    localDeps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "faq-1",
      sourceCount: 3,
    });
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    primeFaqExtractionLlm(localDeps, "What is your cancellation policy?");

    // No knowledgeStore provided — assert the FAQ-tracking path completes (incrementConfidence
    // was reached) and the top-level try/catch in processConversationEnd did NOT swallow an
    // error (console.error not called). .resolves.not.toThrow() alone would be a false-green
    // because the production code wraps the body in try { ... } catch (err) { console.error(...) }.
    const localService = new ConversationCompoundingService(localDeps);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await localService.processConversationEnd(createEvent());

    expect(localDeps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
