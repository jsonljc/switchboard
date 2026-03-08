import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramAdapter } from "../adapters/telegram.js";
import { ChatRuntime } from "../runtime.js";
import type {
  ChannelAdapter,
  ApprovalCardPayload,
  ResultCardPayload,
} from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import type { RuntimeOrchestrator, ProposeResult } from "@switchboard/core";
import type { ConversationRouter, RouterResponse } from "@switchboard/customer-engagement";
import { deleteThread } from "../conversation/threads.js";

// ── Telegram deep link parsing ─────────────────────────────────────────────

describe("TelegramAdapter — /start deep link attribution", () => {
  const adapter = new TelegramAdapter("fake-bot-token");

  function buildStartPayload(startParam: string) {
    return {
      update_id: 1,
      message: {
        message_id: 100,
        from: {
          id: 7001,
          is_bot: false,
          first_name: "Jane",
          last_name: "Doe",
          username: "janedoe",
        },
        chat: { id: 8001, type: "private" },
        date: 1700000000,
        text: `/start ${startParam}`,
      },
    };
  }

  it("parses /start ad_{adId}_{campaignId} into attribution metadata", () => {
    const msg = adapter.parseIncomingMessage(buildStartPayload("ad_abc123_camp456"));
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("hi"); // replaced /start with clean greeting
    expect(msg!.metadata?.["startPayload"]).toBe("ad_abc123_camp456");
    expect(msg!.metadata?.["sourceAdId"]).toBe("abc123");
    expect(msg!.metadata?.["sourceCampaignId"]).toBe("camp456");
    expect(msg!.metadata?.["utmSource"]).toBe("meta_ads");
  });

  it("handles /start with non-ad payload (no attribution)", () => {
    const msg = adapter.parseIncomingMessage(buildStartPayload("ref_partner123"));
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("hi");
    expect(msg!.metadata?.["startPayload"]).toBe("ref_partner123");
    expect(msg!.metadata?.["sourceAdId"]).toBeUndefined();
    expect(msg!.metadata?.["sourceCampaignId"]).toBeUndefined();
  });

  it("extracts contactName from first_name and last_name", () => {
    const msg = adapter.parseIncomingMessage(buildStartPayload("ad_x_y"));
    expect(msg!.metadata?.["contactName"]).toBe("Jane Doe");
  });

  it("handles first_name only (no last_name)", () => {
    const payload = {
      update_id: 1,
      message: {
        message_id: 101,
        from: { id: 7002, is_bot: false, first_name: "Bob" },
        chat: { id: 8002, type: "private" },
        date: 1700000000,
        text: "hello",
      },
    };
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg!.metadata?.["contactName"]).toBe("Bob");
  });

  it("passes through regular messages unchanged", () => {
    const payload = {
      update_id: 1,
      message: {
        message_id: 102,
        from: { id: 7003, is_bot: false, first_name: "Carol" },
        chat: { id: 8003, type: "private" },
        date: 1700000000,
        text: "I want to book an appointment",
      },
    };
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg!.text).toBe("I want to book an appointment");
    expect(msg!.metadata?.["startPayload"]).toBeUndefined();
    expect(msg!.metadata?.["sourceAdId"]).toBeUndefined();
  });
});

// ── Lead bot runtime routing ───────────────────────────────────────────────

class MockAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  sentText: Array<{ threadId: string; text: string }> = [];
  sentApprovalCards: Array<{ threadId: string; card: ApprovalCardPayload }> = [];
  sentResultCards: Array<{ threadId: string; card: ResultCardPayload }> = [];
  private nextMessage: IncomingMessage | null = null;

  setNextMessage(msg: IncomingMessage): void {
    this.nextMessage = msg;
  }

  parseIncomingMessage(_rawPayload: unknown): IncomingMessage | null {
    return this.nextMessage;
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    this.sentText.push({ threadId, text });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    this.sentApprovalCards.push({ threadId, card });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    this.sentResultCards.push({ threadId, card });
  }

  extractMessageId(_rawPayload: unknown): string | null {
    return null;
  }

  reset(): void {
    this.sentText = [];
    this.sentApprovalCards = [];
    this.sentResultCards = [];
    this.nextMessage = null;
  }
}

function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: `lead_thread_${Date.now()}`,
    principalId: "lead_user_1",
    organizationId: "org_test",
    text,
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

function createMockOrchestrator(): RuntimeOrchestrator {
  return {
    resolveAndPropose: vi.fn().mockResolvedValue({
      denied: false,
      approvalRequest: null,
      explanation: "Approved",
      envelope: {
        id: "env_1",
        proposals: [{ actionType: "customer-engagement.book-appointment", parameters: {} }],
        decisions: [],
        auditEntryIds: [],
      },
      decisionTrace: {
        explanation: "Auto-approved",
        checks: [],
        computedRiskScore: { category: "low", score: 10 },
      },
    } as unknown as ProposeResult),
    executeApproved: vi.fn().mockResolvedValue({
      success: true,
      summary: "Appointment booked",
      rollbackAvailable: false,
    }),
    respondToApproval: vi.fn(),
    requestUndo: vi.fn(),
  } as unknown as RuntimeOrchestrator;
}

function createMockLeadRouter(response?: Partial<RouterResponse>): ConversationRouter {
  const defaultResponse: RouterResponse = {
    handled: true,
    responses: [
      "Hi! I'd love to help you book an appointment. What service are you interested in?",
    ],
    escalated: false,
    completed: false,
    sessionId: "sess_test_1",
    ...response,
  };

  return {
    handleMessage: vi.fn().mockResolvedValue(defaultResponse),
    startFlow: vi.fn(),
    escalateSession: vi.fn(),
    endSession: vi.fn(),
  } as unknown as ConversationRouter;
}

function createMockInterpreter() {
  return {
    interpret: vi.fn().mockResolvedValue({
      proposals: [],
      confidence: 0,
      needsClarification: false,
    }),
  };
}

describe("ChatRuntime — lead bot mode", () => {
  let adapter: MockAdapter;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let leadRouter: ReturnType<typeof createMockLeadRouter>;
  let interpreter: ReturnType<typeof createMockInterpreter>;

  beforeEach(() => {
    adapter = new MockAdapter();
    orchestrator = createMockOrchestrator();
    leadRouter = createMockLeadRouter();
    interpreter = createMockInterpreter();
  });

  function createLeadRuntime(
    routerOverride?: ConversationRouter,
    opts?: { isLeadBot?: boolean },
  ): ChatRuntime {
    return new ChatRuntime({
      adapter,
      interpreter,
      orchestrator,
      availableActions: ["customer-engagement.book-appointment"],
      isLeadBot: opts?.isLeadBot ?? true,
      leadRouter: routerOverride ?? leadRouter,
    });
  }

  it("routes messages through ConversationRouter in lead bot mode", async () => {
    const threadId = `lead_${Date.now()}`;
    const msg = makeMessage("I want to book a cleaning", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime();
    await runtime.handleIncomingMessage({});

    expect(leadRouter.handleMessage).toHaveBeenCalledTimes(1);

    // Verify the InboundMessage shape passed to the router
    const inbound = (leadRouter.handleMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(inbound.channelId).toBe(threadId);
    expect(inbound.channelType).toBe("telegram");
    expect(inbound.body).toBe("I want to book a cleaning");
    expect(inbound.from).toBe("lead_user_1");

    // Should send back the router's response
    const textReplies = adapter.sentText.filter((t) => t.threadId === threadId);
    // Welcome message + router response
    const routerReply = textReplies.find((t) =>
      t.text.includes("I'd love to help you book an appointment"),
    );
    expect(routerReply).toBeTruthy();

    await deleteThread(threadId);
  });

  it("does NOT use interpreter pipeline in lead bot mode", async () => {
    const threadId = `lead_noint_${Date.now()}`;
    const msg = makeMessage("pause my campaign", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime();
    await runtime.handleIncomingMessage({});

    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(leadRouter.handleMessage).toHaveBeenCalled();

    await deleteThread(threadId);
  });

  it("sends escalation message when router escalates", async () => {
    const escalatedRouter = createMockLeadRouter({
      responses: ["Let me connect you with someone."],
      escalated: true,
    });

    const threadId = `lead_esc_${Date.now()}`;
    const msg = makeMessage("I want to talk to a human", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime(escalatedRouter);
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const escalationMsg = replies.find((t) => t.text.includes("connecting you"));
    expect(escalationMsg).toBeTruthy();

    await deleteThread(threadId);
  });

  it("proposes actions through orchestrator when router returns actionRequired", async () => {
    const actionRouter = createMockLeadRouter({
      responses: ["I'll book that for you!"],
      actionRequired: {
        actionType: "customer-engagement.book-appointment",
        parameters: { service: "cleaning", date: "2026-03-15" },
      },
    });

    const threadId = `lead_act_${Date.now()}`;
    const msg = makeMessage("book me a cleaning for next week", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime(actionRouter);
    await runtime.handleIncomingMessage({});

    expect(orchestrator.resolveAndPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "customer-engagement.book-appointment",
        parameters: expect.objectContaining({ service: "cleaning" }),
        cartridgeId: "customer-engagement",
      }),
    );

    await deleteThread(threadId);
  });

  it("handles router errors gracefully", async () => {
    const errorRouter = {
      handleMessage: vi.fn().mockRejectedValue(new Error("Router crash")),
      startFlow: vi.fn(),
      escalateSession: vi.fn(),
      endSession: vi.fn(),
    } as unknown as ConversationRouter;

    const threadId = `lead_err_${Date.now()}`;
    const msg = makeMessage("hello", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime(errorRouter);
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const errorReply = replies.find((t) => t.text.includes("something went wrong"));
    expect(errorReply).toBeTruthy();

    await deleteThread(threadId);
  });

  it("falls through to interpreter pipeline when isLeadBot is false", async () => {
    const threadId = `owner_${Date.now()}`;
    const msg = makeMessage("pause campaign", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime(leadRouter, { isLeadBot: false });
    await runtime.handleIncomingMessage({});

    expect(leadRouter.handleMessage).not.toHaveBeenCalled();
    // Interpreter should be called (owner bot mode)
    expect(interpreter.interpret).toHaveBeenCalled();

    await deleteThread(threadId);
  });

  it("sends multiple response messages when router returns several", async () => {
    const multiRouter = createMockLeadRouter({
      responses: [
        "Great choice! Teeth whitening is one of our most popular services.",
        "We have availability this week. What day works best?",
      ],
    });

    const threadId = `lead_multi_${Date.now()}`;
    const msg = makeMessage("I want teeth whitening", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createLeadRuntime(multiRouter);
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const routerReplies = replies.filter(
      (t) => t.text.includes("popular services") || t.text.includes("What day"),
    );
    expect(routerReplies).toHaveLength(2);

    await deleteThread(threadId);
  });
});

// ── CRM attribution wiring ────────────────────────────────────────────────

describe("CRM auto-create with ad attribution", () => {
  it("passes sourceCampaignId and utmSource from metadata to CRM createContact", async () => {
    const adapter = new MockAdapter();
    const orchestrator = createMockOrchestrator();
    const leadRouter = createMockLeadRouter();
    const interpreter = createMockInterpreter();

    const mockCrmProvider = {
      findByExternalId: vi.fn().mockResolvedValue(null),
      createContact: vi.fn().mockResolvedValue({
        id: "ct_new",
        externalId: "lead_user_ad",
        channel: "telegram",
        email: null,
        firstName: "Jane",
        lastName: "Doe",
        company: null,
        phone: null,
        tags: [],
        status: "active",
        assignedStaffId: null,
        sourceAdId: "abc123",
        sourceCampaignId: "camp456",
        utmSource: "meta_ads",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        properties: {},
      }),
      updateContact: vi.fn(),
      archiveContact: vi.fn(),
      searchContacts: vi.fn().mockResolvedValue([]),
      getContact: vi.fn(),
      listDeals: vi.fn().mockResolvedValue([]),
      listActivities: vi.fn().mockResolvedValue([]),
      getPipelineStatus: vi.fn().mockResolvedValue([]),
      createDeal: vi.fn(),
      archiveDeal: vi.fn(),
      logActivity: vi.fn().mockResolvedValue({
        id: "act_1",
        type: "note",
        subject: null,
        body: null,
        contactIds: [],
        dealIds: [],
        createdAt: new Date().toISOString(),
      }),
      healthCheck: vi.fn(),
    };

    const threadId = `attr_${Date.now()}`;
    const msg = makeMessage("hi", {
      threadId,
      principalId: "lead_user_ad",
      metadata: {
        firstName: "Jane",
        lastName: "Doe",
        sourceAdId: "abc123",
        sourceCampaignId: "camp456",
        utmSource: "meta_ads",
        contactName: "Jane Doe",
      },
    });
    adapter.setNextMessage(msg);

    const runtime = new ChatRuntime({
      adapter,
      interpreter,
      orchestrator,
      availableActions: [],
      isLeadBot: true,
      leadRouter,
      crmProvider: mockCrmProvider,
    });

    await runtime.handleIncomingMessage({});

    expect(mockCrmProvider.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "lead_user_ad",
        channel: "telegram",
        firstName: "Jane",
        lastName: "Doe",
        sourceAdId: "abc123",
        sourceCampaignId: "camp456",
        utmSource: "meta_ads",
      }),
    );

    await deleteThread(threadId);
  });
});
