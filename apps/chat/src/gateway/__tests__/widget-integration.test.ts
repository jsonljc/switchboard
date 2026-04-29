import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import { SseSessionManager } from "../../endpoints/widget-sse-manager.js";

describe("Widget integration", () => {
  it("delivers reply via SSE after POST message", async () => {
    // Create gateway with converged path mocks
    const gateway = new ChannelGateway({
      deploymentResolver: {
        resolveByChannelToken: vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          listingId: "listing-1",
          organizationId: "org-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 50,
          deploymentConfig: {},
        }),
        resolveByDeploymentId: vi.fn(),
        resolveByOrgAndSlug: vi.fn(),
      },
      platformIngress: {
        submit: vi.fn().mockResolvedValue({
          ok: true,
          result: {
            outcome: "completed",
            outputs: { response: "Hello! How can I help?" },
            summary: "Responded to user",
          },
          workUnit: { id: "wu-1", traceId: "trace-1" },
        }),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
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
