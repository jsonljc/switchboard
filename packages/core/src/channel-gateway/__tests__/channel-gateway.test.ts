import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type {
  ChannelGatewayConfig,
  GatewayContactStore,
  IncomingChannelMessage,
  ReplySink,
} from "../types.js";
import { DeploymentInactiveError } from "../../platform/deployment-resolver.js";
import type { DeploymentResolverResult } from "../../platform/deployment-resolver.js";

function createMockResolverResult(
  overrides: Partial<DeploymentResolverResult> = {},
): DeploymentResolverResult {
  return {
    deploymentId: "dep-1",
    listingId: "listing-1",
    organizationId: "org-1",
    skillSlug: "alex",
    trustLevel: "guided",
    trustScore: 50,
    deploymentConfig: {},
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue(createMockResolverResult()),
      resolveByDeploymentId: vi.fn().mockResolvedValue(createMockResolverResult()),
      resolveByOrgAndSlug: vi.fn().mockResolvedValue(createMockResolverResult()),
    },
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: "Hello from agent" },
          summary: "Responded to user",
        },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
    approvalStore: {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn(),
      listPending: vi.fn(),
    },
    ...overrides,
  };
}

describe("ChannelGateway", () => {
  it("throws when deployment resolver finds no connection", async () => {
    const config = createMockConfig({
      deploymentResolver: {
        resolveByChannelToken: vi
          .fn()
          .mockRejectedValue(new Error("No deployment connection found")),
        resolveByDeploymentId: vi.fn(),
        resolveByOrgAndSlug: vi.fn(),
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_invalid",
      sessionId: "sess-1",
      text: "hi",
    };
    const replySink: ReplySink = { send: vi.fn() };

    await expect(gateway.handleIncoming(message, replySink)).rejects.toThrow(
      "No deployment connection found",
    );
  });

  it("sends inactive message when DeploymentInactiveError is thrown", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      deploymentResolver: {
        resolveByChannelToken: vi
          .fn()
          .mockRejectedValue(new DeploymentInactiveError("dep-x", "status is deactivated")),
        resolveByDeploymentId: vi.fn(),
        resolveByOrgAndSlug: vi.fn(),
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_inactive",
      sessionId: "sess-1",
      text: "hi",
    };
    const replySink: ReplySink = { send: sendSpy };

    await gateway.handleIncoming(message, replySink);

    expect(sendSpy).toHaveBeenCalledWith(
      "This service is temporarily paused. Please try again later.",
    );
  });

  it("processes message and delivers reply via replySink", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
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
    const onTypingSpy = vi.fn();
    const config = createMockConfig();
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
    const longHistory = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}`,
    }));
    const submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "reply" },
        summary: "ok",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: longHistory,
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      platformIngress: { submit: submitSpy },
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

    expect(submitSpy).toHaveBeenCalled();
    const request = submitSpy.mock.calls[0]?.[0];
    // conversation.messages should be <= 31 (30 capped + 1 new user message)
    expect(request.parameters.conversation.messages.length).toBeLessThanOrEqual(31);
  });

  it("sends fallback message when platform ingress returns not ok", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      platformIngress: {
        submit: vi.fn().mockResolvedValue({
          ok: false,
          error: { type: "execution_error", message: "Something went wrong" },
        }),
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "hi",
    };

    await gateway.handleIncoming(message, { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(
      "I'm having trouble right now. Let me connect you with the team.",
    );
  });

  it("skips skill dispatch when conversation status is human_override", async () => {
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const submitSpy = vi.fn();
    const sendSpy = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: addMessageSpy,
        getConversationStatus: vi.fn().mockResolvedValue("human_override"),
      },
      platformIngress: { submit: submitSpy },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gateway.handleIncoming(message, { send: sendSpy });

    // Message should be persisted
    expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "user", "Hello");
    // But skill dispatch and reply should be skipped
    expect(submitSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("proceeds normally when conversation status is active", async () => {
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "Hello from agent" },
        summary: "Responded to user",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: addMessageSpy,
        getConversationStatus: vi.fn().mockResolvedValue("active"),
      },
      platformIngress: { submit: submitSpy },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gateway.handleIncoming(message, { send: sendSpy });

    // Should proceed normally
    expect(submitSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
  });

  it("proceeds normally when getConversationStatus is not implemented", async () => {
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "Hello from agent" },
        summary: "Responded to user",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: addMessageSpy,
        // No getConversationStatus method
      },
      platformIngress: { submit: submitSpy },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gateway.handleIncoming(message, { send: sendSpy });

    // Should proceed normally for backward compatibility
    expect(submitSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
  });
});

function makeConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  const submit = vi.fn().mockResolvedValue({
    ok: true,
    result: { outputs: { response: "ok" }, summary: "ok" },
  });
  return {
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue({
        organizationId: "org-1",
        deploymentId: "dep-1",
        listingId: "list-1",
        skillSlug: "alex",
        persona: { businessName: "Acme", tone: "friendly" },
      }),
      resolveByDeploymentId: vi.fn(),
      resolveByOrgAndSlug: vi.fn(),
    },
    platformIngress: { submit },
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    approvalStore: {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn(),
      listPending: vi.fn(),
    },
    ...overrides,
  };
}

function makeContactStore(): GatewayContactStore {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "contact-new" }),
  };
}

const replySink: ReplySink = {
  send: vi.fn().mockResolvedValue(undefined),
};

describe("ChannelGateway identity resolution", () => {
  it("WhatsApp: same sessionId across two messages creates Contact exactly once", async () => {
    const contactStore = makeContactStore();
    let createdId: string | null = null;
    contactStore.findByPhone = vi.fn(async (_org, _phone) =>
      createdId ? { id: createdId } : null,
    );
    contactStore.create = vi.fn(async (_input) => {
      createdId = "contact-1";
      return { id: createdId };
    });

    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok",
      sessionId: "+6599999999",
      text: "hi",
    };

    await gateway.handleIncoming(msg, replySink);
    await gateway.handleIncoming({ ...msg, text: "hi again" }, replySink);

    expect(contactStore.create).toHaveBeenCalledTimes(1);
    expect(config.platformIngress.submit).toHaveBeenCalledTimes(2);
  });

  it("WhatsApp: parameters include contactId, phone, channel, _agentContext", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "tok",
        sessionId: "+6599999999",
        text: "hi",
      },
      replySink,
    );

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(submitCall.parameters.contactId).toBe("contact-new");
    expect(submitCall.parameters.phone).toBe("+6599999999");
    expect(submitCall.parameters.channel).toBe("whatsapp");
    expect(submitCall.parameters._agentContext).toEqual({
      persona: { businessName: "Acme", tone: "friendly" },
    });
  });

  it("Telegram: parameters omit contactId and phone, channel still set", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      { channel: "telegram", token: "tok", sessionId: "tg-1", text: "hi" },
      replySink,
    );

    expect(contactStore.findByPhone).not.toHaveBeenCalled();
    expect(contactStore.create).not.toHaveBeenCalled();

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(submitCall.parameters.contactId).toBeUndefined();
    expect(submitCall.parameters.phone).toBeUndefined();
    expect(submitCall.parameters.channel).toBe("telegram");
  });

  it("no contactStore configured: identity step is skipped, parameters stay channel+_agentContext", async () => {
    const config = makeConfig(); // contactStore is undefined
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      { channel: "whatsapp", token: "tok", sessionId: "+6599999999", text: "hi" },
      replySink,
    );

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(submitCall.parameters.contactId).toBeUndefined();
    expect(submitCall.parameters.phone).toBeUndefined();
    expect(submitCall.parameters.channel).toBe("whatsapp");
  });
});
