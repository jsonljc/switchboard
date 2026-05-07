import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type {
  ChannelGatewayConfig,
  GatewayContactStore,
  IncomingChannelMessage,
  ReplySink,
} from "../types.js";
import type { DeploymentResolverResult } from "../../platform/deployment-resolver.js";

function makeResolverResult(): DeploymentResolverResult {
  return {
    deploymentId: "dep-1",
    listingId: "listing-1",
    organizationId: "org-1",
    skillSlug: "alex",
    trustLevel: "guided",
    trustScore: 50,
    deploymentConfig: {},
  };
}

function makeContactStore(overrides: Partial<GatewayContactStore> = {}): GatewayContactStore & {
  recordMessagingOptOut: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findByPhone: ReturnType<typeof vi.fn>;
} {
  return {
    findByPhone: vi.fn().mockResolvedValue({ id: "contact-1" }),
    create: vi.fn().mockResolvedValue({ id: "contact-1" }),
    recordMessagingOptOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

function makeConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue(makeResolverResult()),
      resolveByDeploymentId: vi.fn().mockResolvedValue(makeResolverResult()),
      resolveByOrgAndSlug: vi.fn().mockResolvedValue(makeResolverResult()),
    },
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: "Hello" },
          summary: "Responded",
        },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
    approvalStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe("ChannelGateway — WhatsApp opt-out keyword", () => {
  it("records opt-out, replies confirmation, and skips skill dispatch on STOP", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);
    const send = vi.fn().mockResolvedValue(undefined);
    const replySink: ReplySink = { send };

    const message: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "wa-token",
      sessionId: "+6599999999",
      text: "STOP",
    };

    await gateway.handleIncoming(message, replySink);

    expect(contactStore.recordMessagingOptOut).toHaveBeenCalledWith("org-1", "contact-1");
    expect(send).toHaveBeenCalledTimes(1);
    const reply = send.mock.calls[0]?.[0] as string;
    expect(reply.toLowerCase()).toContain("opt");
    expect(config.platformIngress.submit).not.toHaveBeenCalled();
  });

  it("opts out on 'unsubscribe'", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);
    const send = vi.fn().mockResolvedValue(undefined);

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "wa-token",
        sessionId: "+6599999999",
        text: "unsubscribe",
      },
      { send },
    );

    expect(contactStore.recordMessagingOptOut).toHaveBeenCalled();
    expect(config.platformIngress.submit).not.toHaveBeenCalled();
  });

  it("does not opt out for non-WhatsApp channels", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "telegram",
        token: "tg-token",
        sessionId: "tg-1",
        text: "STOP",
      },
      { send: vi.fn() },
    );

    expect(contactStore.recordMessagingOptOut).not.toHaveBeenCalled();
    // telegram messages still flow through skill dispatch
    expect(config.platformIngress.submit).toHaveBeenCalled();
  });

  it("does not opt out when text contains keyword as substring", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "wa-token",
        sessionId: "+6599999999",
        text: "please stop by tomorrow",
      },
      { send: vi.fn() },
    );

    expect(contactStore.recordMessagingOptOut).not.toHaveBeenCalled();
    expect(config.platformIngress.submit).toHaveBeenCalled();
  });

  it("falls through (no opt-out) when contactStore is not wired", async () => {
    const config = makeConfig({ contactStore: undefined });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "wa-token",
        sessionId: "+6599999999",
        text: "STOP",
      },
      { send: vi.fn() },
    );

    expect(config.platformIngress.submit).toHaveBeenCalled();
  });
});
