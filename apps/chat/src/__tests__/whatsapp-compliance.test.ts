import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatRuntime } from "../runtime.js";
import type {
  ChannelAdapter,
  ApprovalCardPayload,
  ResultCardPayload,
} from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import type { RuntimeOrchestrator } from "@switchboard/core";
import { deleteThread } from "../conversation/threads.js";
import { isWithinWhatsAppWindow } from "../adapters/whatsapp.js";

// ── Mock adapter ──────────────────────────────────────────────────────────

class MockAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  sentText: Array<{ threadId: string; text: string }> = [];

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

  async sendApprovalCard(_threadId: string, _card: ApprovalCardPayload): Promise<void> {}
  async sendResultCard(_threadId: string, _card: ResultCardPayload): Promise<void> {}
  extractMessageId(_rawPayload: unknown): string | null {
    return null;
  }

  reset(): void {
    this.sentText = [];
    this.nextMessage = null;
  }
}

function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    channel: "whatsapp",
    channelMessageId: "wamid_123",
    threadId: `wa_thread_${Date.now()}`,
    principalId: "15551234567",
    organizationId: "org_test",
    text,
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

function createMockOrchestrator(): RuntimeOrchestrator {
  return {
    resolveAndPropose: vi.fn(),
    executeApproved: vi.fn(),
    respondToApproval: vi.fn(),
    requestUndo: vi.fn(),
  } as unknown as RuntimeOrchestrator;
}

function createMockInterpreter() {
  return {
    interpret: vi.fn().mockResolvedValue({
      proposals: [],
      confidence: 0,
      needsClarification: false,
      clarificationQuestion: null,
    }),
  };
}

// ── Opt-out keyword detection ─────────────────────────────────────────────

describe("WhatsApp opt-out compliance", () => {
  let adapter: MockAdapter;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let interpreter: ReturnType<typeof createMockInterpreter>;

  beforeEach(() => {
    adapter = new MockAdapter();
    orchestrator = createMockOrchestrator();
    interpreter = createMockInterpreter();
  });

  function createRuntime(crmProvider?: unknown): ChatRuntime {
    return new ChatRuntime({
      adapter,
      interpreter,
      orchestrator,
      availableActions: [],
      crmProvider: crmProvider as never,
    });
  }

  it("handles STOP keyword — sends unsubscribe confirmation", async () => {
    const threadId = `opt_out_${Date.now()}`;
    const msg = makeMessage("STOP", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createRuntime();
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const unsub = replies.find((t) => t.text.includes("unsubscribed"));
    expect(unsub).toBeTruthy();

    await deleteThread(threadId);
  });

  it("handles lowercase stop keyword", async () => {
    const threadId = `opt_out_lower_${Date.now()}`;
    const msg = makeMessage("stop", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createRuntime();
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const unsub = replies.find((t) => t.text.includes("unsubscribed"));
    expect(unsub).toBeTruthy();

    await deleteThread(threadId);
  });

  it("handles unsubscribe keyword", async () => {
    const threadId = `opt_out_unsub_${Date.now()}`;
    const msg = makeMessage("unsubscribe", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createRuntime();
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const unsub = replies.find((t) => t.text.includes("unsubscribed"));
    expect(unsub).toBeTruthy();

    await deleteThread(threadId);
  });

  it("updates CRM contact consent on opt-out", async () => {
    const crmProvider = {
      findByExternalId: vi.fn().mockResolvedValue({
        id: "ct_1",
        externalId: "15551234567",
        channel: "whatsapp",
      }),
      createContact: vi.fn(),
      updateContact: vi.fn().mockResolvedValue({}),
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

    const threadId = `opt_out_crm_${Date.now()}`;

    // First message to create conversation with CRM link
    const msg1 = makeMessage("hello", { threadId, principalId: "15551234567" });
    adapter.setNextMessage(msg1);
    const runtime = createRuntime(crmProvider);
    await runtime.handleIncomingMessage({});

    // Now send STOP
    const msg2 = makeMessage("STOP", { threadId, principalId: "15551234567" });
    adapter.setNextMessage(msg2);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.updateContact).toHaveBeenCalledWith(
      "ct_1",
      expect.objectContaining({ consentStatus: "revoked" }),
    );

    await deleteThread(threadId);
  });

  it("does NOT process message through interpreter after opt-out", async () => {
    const threadId = `opt_out_noint_${Date.now()}`;
    const msg = makeMessage("STOP", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createRuntime();
    await runtime.handleIncomingMessage({});

    expect(interpreter.interpret).not.toHaveBeenCalled();

    await deleteThread(threadId);
  });

  it("handles START keyword — sends re-subscribe confirmation", async () => {
    const threadId = `opt_in_${Date.now()}`;
    const msg = makeMessage("START", { threadId });
    adapter.setNextMessage(msg);

    const runtime = createRuntime();
    await runtime.handleIncomingMessage({});

    const replies = adapter.sentText.filter((t) => t.threadId === threadId);
    const resub = replies.find((t) => t.text.includes("re-subscribed"));
    expect(resub).toBeTruthy();

    await deleteThread(threadId);
  });
});

// ── 24-hour conversation window ───────────────────────────────────────────

describe("WhatsApp 24h conversation window", () => {
  it("returns true when last inbound is within 24 hours", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(oneHourAgo)).toBe(true);
  });

  it("returns false when last inbound is older than 24 hours", () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(isWithinWhatsAppWindow(twentyFiveHoursAgo)).toBe(false);
  });

  it("returns false when lastInboundAt is null", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });

  it("returns true at exactly 23h59m", () => {
    const justUnder = new Date(Date.now() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000);
    expect(isWithinWhatsAppWindow(justUnder)).toBe(true);
  });
});
