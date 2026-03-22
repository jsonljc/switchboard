import { describe, it, expect, vi } from "vitest";
import { bootstrapAgentSystem } from "../agent-bootstrap.js";
import { KnowledgeRetriever } from "@switchboard/agents";

describe("bootstrapAgentSystem with conversation deps", () => {
  it("wires conversation deps to lead-responder handler", () => {
    const mockEmbedding = {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
      dimensions: 1024,
    };
    const mockStore = {
      store: vi.fn(),
      storeBatch: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      deleteByDocument: vi.fn(),
    };

    const retriever = new KnowledgeRetriever({
      embedding: mockEmbedding,
      store: mockStore,
    });

    const mockConvDeps = {
      llm: {
        generateReply: vi.fn().mockResolvedValue({ reply: "test", confidence: 0.9 }),
      },
      retriever,
      conversationStore: {
        getHistory: vi.fn().mockResolvedValue([]),
        appendMessage: vi.fn().mockResolvedValue(undefined),
        getStage: vi.fn().mockResolvedValue("lead" as const),
        setStage: vi.fn().mockResolvedValue(undefined),
        isOptedOut: vi.fn().mockResolvedValue(false),
        setOptOut: vi.fn().mockResolvedValue(undefined),
      },
    };

    const system = bootstrapAgentSystem({
      leadResponderConversationDeps: mockConvDeps,
      salesCloserConversationDeps: mockConvDeps,
    });

    expect(system.handlerRegistry).toBeDefined();
    expect(system.eventLoop).toBeDefined();
  });
});
