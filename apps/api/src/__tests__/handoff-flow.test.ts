import { describe, it, expect, vi } from "vitest";
import { bootstrapAgentSystem } from "../agent-bootstrap.js";
import { KnowledgeRetriever } from "@switchboard/agents";

describe("Handoff flow integration", () => {
  const mockEmbedding = {
    embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
    embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
    dimensions: 1024,
  };
  const mockStore = {
    store: vi.fn().mockResolvedValue(undefined),
    storeBatch: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    deleteByDocument: vi.fn().mockResolvedValue(undefined),
  };

  const retriever = new KnowledgeRetriever({
    embedding: mockEmbedding,
    store: mockStore,
  });

  const mockConvDeps = {
    llm: {
      generateReply: vi.fn().mockResolvedValue({ reply: "test reply", confidence: 0.9 }),
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

  it("routes message.received to lead-responder and produces messaging actions", async () => {
    const system = bootstrapAgentSystem({
      leadResponderConversationDeps: mockConvDeps,
      salesCloserConversationDeps: mockConvDeps,
      organizationIds: ["org-test"],
    });

    const { createEventEnvelope } = await import("@switchboard/agents");
    const event = createEventEnvelope({
      organizationId: "org-test",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1", messageText: "hello", channel: "whatsapp" },
    });

    event.metadata = { ...event.metadata, targetAgentId: "lead-responder" };

    const result = await system.eventLoop.process(event, { organizationId: "org-test" });
    expect(result.processed.length).toBeGreaterThan(0);
  });

  it("escalates when no agent handles the message (unrouted)", async () => {
    const system = bootstrapAgentSystem({
      leadResponderConversationDeps: mockConvDeps,
      salesCloserConversationDeps: mockConvDeps,
      organizationIds: ["org-test"],
    });

    const { createEventEnvelope } = await import("@switchboard/agents");
    const event = createEventEnvelope({
      organizationId: "org-test",
      eventType: "unknown.event.type",
      source: { type: "webhook", id: "whatsapp" },
      payload: {},
    });

    const result = await system.eventLoop.process(event, { organizationId: "org-test" });

    const hasUnrouted =
      result.processed.length === 0 ||
      result.processed.some((p) => !p.success || p.agentId === "unrouted");
    expect(hasUnrouted).toBe(true);
  });

  it("purchase-gated handoff escalates when target agent is disabled", async () => {
    const system = bootstrapAgentSystem({
      leadResponderConversationDeps: mockConvDeps,
      salesCloserConversationDeps: mockConvDeps,
      organizationIds: ["org-gated"],
    });

    // Disable sales-closer to simulate unpurchased agent
    const agents = system.registry.listActive("org-gated");
    const salesCloser = agents.find((a) => a.agentId === "sales-closer");
    if (salesCloser) {
      system.registry.register(
        "org-gated",
        { ...salesCloser, status: "disabled" },
        { forceOverwrite: true },
      );
    }

    const { createEventEnvelope } = await import("@switchboard/agents");
    const event = createEventEnvelope({
      organizationId: "org-gated",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c2" },
      metadata: { targetAgentId: "sales-closer" },
    });

    const result = await system.eventLoop.process(event, { organizationId: "org-gated" });

    const salesCloserResult = result.processed.find((p) => p.agentId === "sales-closer");
    const wasHandled = salesCloserResult?.success === true;
    expect(wasHandled).not.toBe(true);
  });
});
