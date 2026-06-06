import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import type { ApprovalRecord } from "@switchboard/schemas";
import {
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  APPROVE_EXECUTED_MSG,
} from "../handle-approval-response.js";
import { DeploymentInactiveError } from "../../platform/deployment-resolver.js";

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
      resolveByChannelToken: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        listingId: "listing-1",
        organizationId: "org-1",
        skillSlug: "alex",
        trustLevel: "guided",
        trustScore: 50,
        inputConfig: {},
      }),
      resolveByDeploymentId: vi.fn().mockResolvedValue({}),
      resolveByOrgAndSlug: vi.fn().mockResolvedValue({}),
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
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe("ChannelGateway approval-payload interception", () => {
  const APPROVAL_TEXT = JSON.stringify({
    action: "approve",
    approvalId: "appr_1",
    bindingHash: "hash123",
  });

  function makeMessage(): IncomingChannelMessage {
    return {
      channel: "whatsapp",
      token: "sw_test",
      sessionId: "sess-1",
      text: APPROVAL_TEXT,
    };
  }

  function makeApprovalRecord(
    overrides: Partial<{ bindingHash: string; organizationId: string | null }> = {},
  ): ApprovalRecord {
    return {
      request: {
        id: "appr_1",
        bindingHash: overrides.bindingHash ?? "hash123",
      } as unknown as ApprovalRecord["request"],
      state: { status: "pending", version: 0 } as unknown as ApprovalRecord["state"],
      envelopeId: "env_1",
      organizationId: overrides.organizationId === undefined ? "org-1" : overrides.organizationId,
    };
  }

  it("does not call platformIngress.submit, conversationStore.addMessage, or onTyping for any approval branch (not-found)", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const onTyping = vi.fn();
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy, onTyping });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
    expect(onTyping).not.toHaveBeenCalled();
  });

  it("replies NOT_FOUND_MSG on org mismatch", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord({ organizationId: "org-other" })),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies STALE_MSG on hash mismatch", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord({ bindingHash: "differenthash1" })),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies NOT_AUTHORIZED_MSG on hash match when no approvalResponseConfig is wired (fail-closed)", async () => {
    // Audit invariant (Risk #4a): channel-possession (matching binding hash) MUST NOT
    // execute the approval. Without an explicit OperatorChannelBinding config, the gateway
    // refuses — never silently approves. See handle-approval-response.ts.
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord()),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies APPROVAL_LOOKUP_ERROR_MSG and does not fall through to chat when store throws", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockRejectedValue(new Error("db down")),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("propagates replySink.send error and does not fall through to chat", async () => {
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await expect(
      gateway.handleIncoming(makeMessage(), {
        send: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).rejects.toThrow("network down");

    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("does not invoke approval interception for non-approval text (regression)", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "Hello there" },
        summary: "Responded",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
    const addMessage = vi.fn();
    const getById = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById,
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(
      { channel: "whatsapp", token: "sw_test", sessionId: "sess-1", text: "hello" },
      { send: sendSpy },
    );

    expect(getById).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalled(); // existing inbound persistence path runs
    expect(sendSpy).toHaveBeenCalledWith("Hello there");
  });

  it("approval-shaped payload on a paused deployment still returns pause message, not approval reply", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const getById = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      deploymentResolver: {
        resolveByChannelToken: vi
          .fn()
          .mockRejectedValue(new DeploymentInactiveError("dep-x", "status is deactivated")),
        resolveByDeploymentId: vi.fn(),
        resolveByOrgAndSlug: vi.fn(),
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById,
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    // Pause branch fires first (deployment resolve throws DeploymentInactiveError)
    // and short-circuits BEFORE approval parsing — so getById is never reached.
    expect(getById).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      "This service is temporarily paused. Please try again later.",
    );
  });

  it("transport mode stays terminal: bridged tap replies and never reaches ingress or local stores", async () => {
    // Bridge spec 4.5: an approval-shaped payload is terminal in the gateway
    // regardless of bridge mode — no PlatformIngress.submit, no LLM
    // fallthrough — and transport mode does no local approval lookups.
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const getById = vi.fn();
    const respond = vi.fn().mockResolvedValue({
      kind: "responded",
      action: "approve",
      executionSuccess: true,
    });
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById,
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
      approvalResponseConfig: { transport: { respond } },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
    expect(getById).not.toHaveBeenCalled();
  });

  describe("approval binding identity (principalId seam)", () => {
    function transportConfig(respond: ReturnType<typeof vi.fn>) {
      return createMockConfig({
        approvalResponseConfig: { transport: { respond } },
      });
    }

    it("binds on principalId when the adapter supplied one (Slack taps)", async () => {
      const respond = vi.fn().mockResolvedValue({ kind: "refused", code: "not_authorized" });
      const gateway = new ChannelGateway(transportConfig(respond));

      await gateway.handleIncoming(
        {
          channel: "slack",
          token: "sw_test",
          sessionId: "C67890",
          principalId: "U12345",
          text: APPROVAL_TEXT,
        },
        { send: vi.fn().mockResolvedValue(undefined) },
      );

      expect(respond).toHaveBeenCalledTimes(1);
      expect(respond.mock.calls[0]![0].channelIdentifier).toBe("U12345");
    });

    it("falls back to sessionId when no principalId is present (WhatsApp pin)", async () => {
      const respond = vi.fn().mockResolvedValue({ kind: "refused", code: "not_authorized" });
      const gateway = new ChannelGateway(transportConfig(respond));

      await gateway.handleIncoming(
        { channel: "whatsapp", token: "sw_test", sessionId: "+6591234567", text: APPROVAL_TEXT },
        { send: vi.fn().mockResolvedValue(undefined) },
      );

      expect(respond.mock.calls[0]![0].channelIdentifier).toBe("+6591234567");
    });

    it("non-approval conversation flow still keys on sessionId, ignoring principalId", async () => {
      const config = createMockConfig();
      const gateway = new ChannelGateway(config);

      await gateway.handleIncoming(
        {
          channel: "slack",
          token: "sw_test",
          sessionId: "C67890",
          principalId: "U12345",
          text: "hello there",
        },
        { send: vi.fn().mockResolvedValue(undefined) },
      );

      // The session id (not principalId) is used for the thread key; identity is
      // the new 4th arg (Spec-1A chain weld), whose presence is verified separately.
      expect(config.conversationStore.getOrCreateBySession).toHaveBeenCalledWith(
        "dep-1",
        "slack",
        "C67890",
        expect.objectContaining({ organizationId: expect.any(String) }),
      );
    });
  });
});
