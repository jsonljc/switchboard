import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import { SseSessionManager } from "../../endpoints/widget-sse-manager.js";

describe("Widget integration", () => {
  it("delivers reply via SSE after POST message", async () => {
    // Create gateway with mock stores
    const gateway = new ChannelGateway({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue({
          deployment: { id: "dep-1", listingId: "listing-1" },
          persona: {
            id: "p-1",
            organizationId: "org-1",
            businessName: "Test",
            businessType: "saas",
            productService: "widgets",
            valueProposition: "best",
            tone: "professional",
            qualificationCriteria: {},
            disqualificationCriteria: {},
            escalationRules: {},
            bookingLink: null,
            customInstructions: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          trustScore: 50,
          trustLevel: "guided",
        }),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar-1", status: "executed" }),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      },
      llmAdapterFactory: () => ({
        generateReply: vi.fn().mockResolvedValue({
          reply: "Hello! How can I help?",
          confidence: 0.9,
        }),
      }),
    });

    // Track SSE messages
    const sseMessages: string[] = [];
    const sseManager = new SseSessionManager();

    // Mock a reply object for SSE
    const mockReply = {
      raw: {
        write: vi.fn((data: string) => {
          sseMessages.push(data);
          return true;
        }),
      },
    };
    sseManager.register("sess-1", mockReply as never);

    // Route message through gateway with SSE replySink
    await gateway.handleIncoming(
      { channel: "web_widget", token: "sw_test", sessionId: "sess-1", text: "Hi" },
      {
        send: async (text) => sseManager.sendMessage("sess-1", "assistant", text),
        onTyping: () => sseManager.sendTyping("sess-1"),
      },
    );

    // Verify SSE received typing + message events
    const typingEvent = sseMessages.find((m) => m.includes("event: typing"));
    const messageEvent = sseMessages.find((m) => m.includes("Hello! How can I help?"));
    expect(typingEvent).toBeDefined();
    expect(messageEvent).toBeDefined();
  });
});
