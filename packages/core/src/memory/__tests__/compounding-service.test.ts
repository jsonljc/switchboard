import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import type { ConversationEndEvent } from "@switchboard/core";
import type { BookingAttributionStore } from "../booking-attribution.js";
import {
  createInMemoryMetrics,
  setMetrics,
  type SwitchboardMetrics,
} from "../../telemetry/metrics.js";

function createMetricsSpy(): SwitchboardMetrics {
  const base = createInMemoryMetrics();
  vi.spyOn(base.outcomePatternsExtracted, "inc");
  vi.spyOn(base.outcomePatternsMerged, "inc");
  vi.spyOn(base.outcomePatternsCreated, "inc");
  vi.spyOn(base.outcomePatternsSurfaced, "inc");
  vi.spyOn(base.outcomePatternConfidence, "observe");
  return base;
}

let metricsSpy: SwitchboardMetrics;

function createMockDeps() {
  return {
    llmClient: {
      complete: vi.fn(),
    },
    embeddingAdapter: {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
      dimensions: 1024,
      available: true,
    },
    interactionSummaryStore: {
      create: vi.fn().mockResolvedValue({ id: "sum-1" }),
    },
    deploymentMemoryStore: {
      findByCategory: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "mem-1" }),
      incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 2 }),
      countByDeployment: vi.fn().mockResolvedValue(0),
    },
  };
}

const baseEvent: ConversationEndEvent = {
  deploymentId: "dep-1",
  organizationId: "org-1",
  contactId: null,
  channelType: "telegram",
  sessionId: "session-1",
  messages: [
    { role: "user", content: "What services do you offer?" },
    { role: "assistant", content: "We offer teeth whitening and cleaning." },
    { role: "user", content: "How much is teeth whitening?" },
    { role: "assistant", content: "Teeth whitening starts at $299." },
  ],
  duration: 120,
  messageCount: 4,
  endReason: "inactivity",
  endedAt: new Date(),
};

function createEvent(): ConversationEndEvent {
  return { ...baseEvent };
}

function primeSummarizeAndExtract(
  deps: ReturnType<typeof createMockDeps>,
  summarization: { summary: string; outcome: string },
  extraction: {
    facts?: Array<{ fact: string; confidence: number; category: string }>;
    questions?: string[];
    patterns?: string[];
  },
): void {
  deps.llmClient.complete
    .mockResolvedValueOnce(JSON.stringify(summarization))
    .mockResolvedValueOnce(
      JSON.stringify({
        facts: extraction.facts ?? [],
        questions: extraction.questions ?? [],
        patterns: extraction.patterns ?? [],
      }),
    );
}

function primeFaqExtractionLlm(deps: ReturnType<typeof createMockDeps>, question: string): void {
  deps.llmClient.complete
    .mockResolvedValueOnce(
      JSON.stringify({
        summary: "Customer asked an FAQ.",
        outcome: "info_request",
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        facts: [],
        questions: [question],
      }),
    );
}

describe("ConversationCompoundingService", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let service: ConversationCompoundingService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ConversationCompoundingService(deps);
    metricsSpy = createMetricsSpy();
    setMetrics(metricsSpy);
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

  it("writes pattern-category memories when summarization outcome is booked", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-1" }]),
    };
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer booked laser treatment", outcome: "booked" },
      { patterns: ["Customers ask about downtime before booking laser treatment"] },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(localDeps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "pattern",
        content: "Customers ask about downtime before booking laser treatment",
      }),
    );
  });

  it("does not write pattern-category memories for non-booked outcomes", async () => {
    for (const outcome of ["lost", "qualified", "info_request", "escalated"] as const) {
      const localDeps = createMockDeps();
      localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
      primeSummarizeAndExtract(
        localDeps,
        { summary: `Conversation ended ${outcome}`, outcome },
        { patterns: ["should not surface because outcome is not booked"] },
      );
      localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

      const localService = new ConversationCompoundingService(localDeps);
      await localService.processConversationEnd(baseEvent);

      const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
        (c) => c[0].category === "pattern",
      );
      expect(patternCreates).toHaveLength(0);
    }
  });

  it("increments confidence on a near-duplicate pattern instead of creating a duplicate", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-dup" }]),
    };
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([
      {
        id: "p-existing",
        content: "Customers ask about downtime before booking laser treatment",
        sourceCount: 2,
        confidence: 0.6,
      },
    ]);
    localDeps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "p-existing",
      sourceCount: 3,
    });
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked again", outcome: "booked" },
      { patterns: ["Customers ask about downtime before booking laser treatment"] },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(localDeps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "p-existing",
      expect.any(Number),
    );
    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
  });

  it("does NOT write patterns when summarization.outcome is booked but no Booking exists", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer claimed to book", outcome: "booked" },
      { patterns: ["fake-pattern from hallucinated booking"] },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd(baseEvent);

    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
    expect(localDeps.deploymentMemoryStore.incrementConfidence).not.toHaveBeenCalled();
  });

  it("writes patterns under tier 'strong' when workTraceId matches a Booking", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked", outcome: "booked" },
      { patterns: ["Customers ask about downtime before booking laser treatment"] },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(localDeps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: "pattern" }),
    );
    expect(metricsSpy.outcomePatternsExtracted.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      attributionTier: "strong",
    });
  });

  it("writes patterns under tier 'fallback' when only the window matches", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-2" }]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Booked", outcome: "booked" },
      { patterns: ["Customers prefer morning appointments"] },
    );
    localDeps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    localDeps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd({ ...baseEvent, contactId: "contact-1" });

    expect(metricsSpy.outcomePatternsExtracted.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
      attributionTier: "fallback",
    });
    expect(metricsSpy.outcomePatternsCreated.inc).toHaveBeenCalledWith({
      deploymentId: baseEvent.deploymentId,
    });
  });

  it("does not write patterns for non-booked outcomes even when a recent Booking exists", async () => {
    const localDeps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-orphan" }]),
    };
    primeSummarizeAndExtract(
      localDeps,
      { summary: "Customer asked about pricing", outcome: "qualified" },
      { patterns: ["should not surface"] },
    );

    const localService = new ConversationCompoundingService({ ...localDeps, bookingStore });
    await localService.processConversationEnd(baseEvent);

    const patternCreates = localDeps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(0);
  });

  const MAX_PATTERNS_PER_CONVERSATION = 5;
  const MAX_PATTERN_LENGTH = 500;

  it("ignores extraction.patterns when it is not an array", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({ facts: [], questions: [], patterns: "not an array" }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("filters non-string entries out of extraction.patterns", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [],
          questions: [],
          patterns: ["valid pattern", 42, null, { evil: "object" }, "another valid pattern"],
        }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(2);
    expect(patternCreates.map((c) => c[0].content)).toEqual([
      "valid pattern",
      "another valid pattern",
    ]);
  });

  it("caps extraction.patterns at MAX_PATTERNS_PER_CONVERSATION entries", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const twentyPatterns = Array.from({ length: 20 }, (_, i) => `pattern ${i}`);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(
        JSON.stringify({ facts: [], questions: [], patterns: twentyPatterns }),
      );
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(MAX_PATTERNS_PER_CONVERSATION);
  });

  it("truncates pattern strings longer than MAX_PATTERN_LENGTH", async () => {
    const deps = createMockDeps();
    const bookingStore: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-A" }]),
      findInWindow: vi.fn(),
    };
    const huge = "x".repeat(5000);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "x", outcome: "booked" }))
      .mockResolvedValueOnce(JSON.stringify({ facts: [], questions: [], patterns: [huge] }));
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);

    const service = new ConversationCompoundingService({ ...deps, bookingStore });
    await service.processConversationEnd({ ...baseEvent, workTraceIds: ["wt-A"] });

    const patternCreates = deps.deploymentMemoryStore.create.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCreates).toHaveLength(1);
    expect((patternCreates[0]![0].content as string).length).toBe(MAX_PATTERN_LENGTH);
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
