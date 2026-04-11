import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import { UnknownChannelError } from "../types.js";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
} from "../types.js";

function createMockConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    deploymentLookup: {
      findByChannelToken: vi.fn().mockResolvedValue(null),
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
    llmAdapterFactory: vi.fn().mockReturnValue({
      generateReply: vi.fn().mockResolvedValue({
        reply: "Hello from agent",
        confidence: 0.9,
      }),
    }),
    ...overrides,
  };
}

function createDeploymentInfo(overrides: Partial<DeploymentInfo> = {}): DeploymentInfo {
  return {
    deployment: { id: "dep-1", listingId: "listing-1", organizationId: "org-1" },
    persona: {
      id: "persona-1",
      organizationId: "org-1",
      businessName: "Test Biz",
      businessType: "saas",
      productService: "widgets",
      valueProposition: "best widgets",
      tone: "professional" as const,
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
    ...overrides,
  };
}

describe("ChannelGateway", () => {
  it("throws UnknownChannelError when deployment not found", async () => {
    const config = createMockConfig();
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_invalid",
      sessionId: "sess-1",
      text: "hi",
    };
    const replySink: ReplySink = { send: vi.fn() };

    await expect(gateway.handleIncoming(message, replySink)).rejects.toThrow(UnknownChannelError);
  });

  it("processes message and delivers reply via replySink", async () => {
    const depInfo = createDeploymentInfo();
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: addMessageSpy,
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid123",
      sessionId: "sess-1",
      text: "Hello",
    };
    const replySink: ReplySink = { send: sendSpy };

    await gateway.handleIncoming(message, replySink);

    // User message persisted
    expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "user", "Hello");
    // Reply delivered via sink
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
    // Reply persisted
    expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "assistant", "Hello from agent");
  });

  it("calls onTyping before processing", async () => {
    const depInfo = createDeploymentInfo();
    const onTypingSpy = vi.fn();
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid123",
      sessionId: "sess-1",
      text: "Hello",
    };
    const replySink: ReplySink = {
      send: vi.fn().mockResolvedValue(undefined),
      onTyping: onTypingSpy,
    };

    await gateway.handleIncoming(message, replySink);

    expect(onTypingSpy).toHaveBeenCalled();
  });

  it("caps conversation history at 30 messages", async () => {
    const depInfo = createDeploymentInfo();
    const longHistory = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}`,
    }));
    const generateReply = vi.fn().mockResolvedValue({
      reply: "reply",
      confidence: 0.9,
    });
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: longHistory,
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      llmAdapterFactory: () => ({ generateReply }),
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "hi",
    };

    await gateway.handleIncoming(message, {
      send: vi.fn().mockResolvedValue(undefined),
    });

    // RuntimeLLMProvider transforms messages to ConversationPrompt.conversationHistory
    // with direction "inbound"/"outbound". Verify the LLM received capped history.
    expect(generateReply).toHaveBeenCalled();
    const callArgs = generateReply.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    // conversationHistory should be <= 31 (30 capped + 1 new user message)
    expect(callArgs?.conversationHistory.length).toBeLessThanOrEqual(31);
  });
});
