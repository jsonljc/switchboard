import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "../types.js";
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
      "This agent is currently inactive. Please contact your administrator.",
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
});
