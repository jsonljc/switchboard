import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "../types.js";

describe("ChannelGateway — override race condition", () => {
  function buildGateway(opts: {
    statusBeforeDispatch: string | null;
    statusAfterDispatch: string | null;
  }) {
    let callCount = 0;
    const getConversationStatus = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? opts.statusBeforeDispatch : opts.statusAfterDispatch;
    });

    const config: ChannelGatewayConfig = {
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
        getConversationStatus,
      },
      deploymentResolver: {
        resolveByChannelToken: vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          listingId: "list-1",
          organizationId: "org-1",
          skillSlug: "alex",
          persona: {},
        }),
      } as never,
      platformIngress: {
        submit: vi.fn().mockResolvedValue({
          ok: true,
          result: {
            outputs: { response: "AI reply" },
            summary: "AI reply",
            outcome: "completed",
          },
        }),
      },
    };

    return { config, getConversationStatus };
  }

  it("does not send reply if override toggled during skill execution", async () => {
    const { config } = buildGateway({
      statusBeforeDispatch: "active",
      statusAfterDispatch: "human_override",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const replySink: ReplySink = { send };

    const gw = new ChannelGateway(config);
    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok-123",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gw.handleIncoming(msg, replySink);

    // Reply should NOT be sent because override was toggled mid-flight
    expect(send).not.toHaveBeenCalled();
  });

  it("sends reply normally when status remains active", async () => {
    const { config } = buildGateway({
      statusBeforeDispatch: "active",
      statusAfterDispatch: "active",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const replySink: ReplySink = { send };

    const gw = new ChannelGateway(config);
    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok-123",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gw.handleIncoming(msg, replySink);
    expect(send).toHaveBeenCalledWith("AI reply");
  });
});
