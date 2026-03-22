import { describe, it, expect, vi } from "vitest";
import { buildConversationDeps } from "../bootstrap/conversation-deps.js";

describe("buildConversationDeps", () => {
  const mockConversationStore = {
    getHistory: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    getStage: vi.fn().mockResolvedValue("lead" as const),
    setStage: vi.fn().mockResolvedValue(undefined),
    isOptedOut: vi.fn().mockResolvedValue(false),
    setOptOut: vi.fn().mockResolvedValue(undefined),
  };

  const mockKnowledgeStore = {
    store: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    storeBatch: vi.fn().mockResolvedValue(undefined),
    deleteByDocument: vi.fn().mockResolvedValue(0),
  };

  it("returns null when ANTHROPIC_API_KEY is not set", () => {
    const result = buildConversationDeps({});
    expect(result).toBeNull();
  });

  it("returns null when conversationStore is missing", () => {
    const result = buildConversationDeps({
      anthropicApiKey: "test-key",
      knowledgeStore: mockKnowledgeStore,
    });
    expect(result).toBeNull();
  });

  it("returns null when knowledgeStore is missing", () => {
    const result = buildConversationDeps({
      anthropicApiKey: "test-key",
      conversationStore: mockConversationStore,
    });
    expect(result).toBeNull();
  });

  it("returns deps with llm, retriever, conversationStore when API key is set", () => {
    const result = buildConversationDeps({
      anthropicApiKey: "test-key",
      conversationStore: mockConversationStore,
      knowledgeStore: mockKnowledgeStore,
    });

    expect(result).not.toBeNull();
    expect(result!.llm).toBeDefined();
    expect(result!.retriever).toBeDefined();
    expect(result!.conversationStore).toBe(mockConversationStore);
    expect(result!.embeddingAdapter).toBeDefined();
  });
});
