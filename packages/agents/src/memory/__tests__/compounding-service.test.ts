import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import type { ConversationEndEvent } from "@switchboard/core";

function createMockDeps() {
  return {
    llmClient: {
      complete: vi.fn(),
    },
    embeddingAdapter: {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
      dimensions: 1024,
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
};

describe("ConversationCompoundingService", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let service: ConversationCompoundingService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ConversationCompoundingService(deps);
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

  it("tracks questions as FAQ and promotes to knowledge store at 3+ occurrences", async () => {
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
  });
});
