import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatRuntime } from "../runtime.js";
import type {
  ChannelAdapter,
  ApprovalCardPayload,
  ResultCardPayload,
} from "../adapters/adapter.js";
import type { IncomingMessage, CrmProvider, CrmContact, CrmActivity } from "@switchboard/schemas";
import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec } from "@switchboard/schemas";
import { deleteThread } from "../conversation/threads.js";
import { TelegramAdapter } from "../adapters/telegram.js";

// ── Mock Adapter ──

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

// ── Mock CRM Provider ──

function createMockCrmProvider(overrides?: Partial<CrmProvider>): CrmProvider {
  const now = new Date().toISOString();
  return {
    searchContacts: vi.fn().mockResolvedValue([]),
    getContact: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    listDeals: vi.fn().mockResolvedValue([]),
    listActivities: vi.fn().mockResolvedValue([]),
    getPipelineStatus: vi.fn().mockResolvedValue([]),
    createContact: vi.fn().mockResolvedValue({
      id: "ct_new_1",
      externalId: null,
      channel: null,
      email: null,
      firstName: null,
      lastName: null,
      company: null,
      phone: null,
      tags: [],
      status: "active",
      assignedStaffId: null,
      sourceAdId: null,
      sourceCampaignId: null,
      utmSource: null,
      createdAt: now,
      updatedAt: now,
      properties: {},
    } satisfies CrmContact),
    updateContact: vi.fn().mockResolvedValue({} as CrmContact),
    archiveContact: vi.fn().mockResolvedValue(undefined),
    createDeal: vi.fn().mockResolvedValue({} as never),
    archiveDeal: vi.fn().mockResolvedValue(undefined),
    logActivity: vi.fn().mockResolvedValue({
      id: "act_1",
      type: "note",
      subject: null,
      body: null,
      contactIds: [],
      dealIds: [],
      createdAt: now,
    } satisfies CrmActivity),
    healthCheck: vi.fn().mockResolvedValue({
      status: "connected",
      latencyMs: 1,
      error: null,
      capabilities: [],
    }),
    ...overrides,
  };
}

// ── Helpers ──

function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: `thread_crm_${Date.now()}`,
    principalId: "user_crm_1",
    organizationId: null,
    text,
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

function makeIdentitySpec(overrides?: Partial<IdentitySpec>): IdentitySpec {
  const now = new Date();
  return {
    id: "spec_test",
    principalId: "user_crm_1",
    organizationId: null,
    name: "Test User",
    description: "Test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: ["user_crm_1"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Tests ──

describe("CRM auto-create from chat", () => {
  let adapter: MockAdapter;
  let storage: StorageContext;
  let orchestrator: LifecycleOrchestrator;
  let cartridge: TestCartridge;
  let ledgerStorage: InMemoryLedgerStorage;

  beforeEach(async () => {
    adapter = new MockAdapter();
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

    cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
    cartridge.onRiskInput(() => ({
      baseRisk: "low" as const,
      exposure: { dollarsAtRisk: 0, blastRadius: 0 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));
    cartridge.onExecute(() => ({
      success: true,
      summary: "Done",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 1,
      undoRecipe: null,
    }));

    storage.cartridges.register("digital-ads", cartridge);

    await storage.policies.save({
      id: "default-allow",
      name: "Default allow",
      description: "Allow all",
      organizationId: null,
      cartridgeId: "digital-ads",
      priority: 100,
      active: true,
      rule: { composition: "AND", conditions: [], children: [] },
      effect: "allow",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await storage.identity.saveSpec(makeIdentitySpec());

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
    });
  });

  function createRuntime(crmProvider?: CrmProvider | null): ChatRuntime {
    return new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["digital-ads.campaign.pause"],
      storage,
      crmProvider,
    });
  }

  it("auto-creates a contact when findByExternalId returns null", async () => {
    const crmProvider = createMockCrmProvider();
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_new_${Date.now()}`;

    const msg = makeMessage("help", { threadId, principalId: "tg_user_42" });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.findByExternalId).toHaveBeenCalledWith("tg_user_42", "telegram");
    expect(crmProvider.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "tg_user_42",
        channel: "telegram",
        properties: expect.objectContaining({ source: "chat" }),
      }),
    );

    // Clean up
    await deleteThread(threadId);
  });

  it("links existing contact when findByExternalId returns a match", async () => {
    const existingContact: CrmContact = {
      id: "ct_existing",
      externalId: "tg_user_42",
      channel: "telegram",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      company: null,
      phone: null,
      tags: [],
      status: "active",
      assignedStaffId: null,
      sourceAdId: null,
      sourceCampaignId: null,
      utmSource: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      properties: {},
    };

    const crmProvider = createMockCrmProvider({
      findByExternalId: vi.fn().mockResolvedValue(existingContact),
    });
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_existing_${Date.now()}`;

    const msg = makeMessage("help", { threadId, principalId: "tg_user_42" });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.findByExternalId).toHaveBeenCalledWith("tg_user_42", "telegram");
    expect(crmProvider.createContact).not.toHaveBeenCalled();

    await deleteThread(threadId);
  });

  it("passes metadata from message to createContact", async () => {
    const crmProvider = createMockCrmProvider();
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_meta_${Date.now()}`;

    const msg = makeMessage("help", {
      threadId,
      principalId: "tg_user_99",
      metadata: {
        firstName: "Alice",
        lastName: "Smith",
        username: "alicesmith",
      },
    });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Alice",
        lastName: "Smith",
        properties: expect.objectContaining({
          source: "chat",
          telegramUsername: "alicesmith",
        }),
      }),
    );

    await deleteThread(threadId);
  });

  it("passes WhatsApp metadata and sets phone from principalId", async () => {
    const crmProvider = createMockCrmProvider();
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_wa_${Date.now()}`;

    const msg = makeMessage("help", {
      threadId,
      principalId: "+15551234567",
      channel: "whatsapp",
      metadata: {
        contactName: "Bob Jones",
        sourceAdId: "ad_123",
      },
    });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "+15551234567",
        channel: "whatsapp",
        phone: "+15551234567",
        sourceAdId: "ad_123",
        properties: expect.objectContaining({
          source: "chat",
          displayName: "Bob Jones",
        }),
      }),
    );

    await deleteThread(threadId);
  });

  it("handles createContact failure gracefully", async () => {
    const crmProvider = createMockCrmProvider({
      createContact: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    });
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_fail_${Date.now()}`;

    const msg = makeMessage("help", { threadId, principalId: "tg_user_fail" });
    adapter.setNextMessage(msg);

    // Should not throw — error is caught internally
    await runtime.handleIncomingMessage({});

    // Conversation still processed (help reply sent)
    expect(adapter.sentText.length).toBeGreaterThan(0);

    await deleteThread(threadId);
  });

  it("does nothing when no crmProvider configured", async () => {
    const runtime = createRuntime(null);
    const threadId = `thread_no_crm_${Date.now()}`;

    const msg = makeMessage("help", { threadId, principalId: "tg_user_no_crm" });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    // Help reply still sent
    expect(adapter.sentText.length).toBeGreaterThan(0);

    await deleteThread(threadId);
  });

  it("does not re-create on second message (existing conversation)", async () => {
    const crmProvider = createMockCrmProvider();
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_repeat_${Date.now()}`;

    // First message — creates conversation and auto-creates contact
    const msg1 = makeMessage("help", { threadId, principalId: "tg_user_repeat" });
    adapter.setNextMessage(msg1);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.createContact).toHaveBeenCalledTimes(1);

    // Second message — conversation already exists, skip CRM lookup
    adapter.reset();
    const msg2 = makeMessage("help", {
      id: `msg_${Date.now()}_2`,
      threadId,
      principalId: "tg_user_repeat",
    });
    adapter.setNextMessage(msg2);
    await runtime.handleIncomingMessage({});

    // createContact should still only have been called once
    expect(crmProvider.createContact).toHaveBeenCalledTimes(1);

    await deleteThread(threadId);
  });

  it("logs activity after contact creation", async () => {
    const crmProvider = createMockCrmProvider();
    const runtime = createRuntime(crmProvider);
    const threadId = `thread_activity_${Date.now()}`;

    const msg = makeMessage("help", { threadId, principalId: "tg_user_activity" });
    adapter.setNextMessage(msg);
    await runtime.handleIncomingMessage({});

    expect(crmProvider.logActivity).toHaveBeenCalledWith({
      type: "note",
      subject: "Contact auto-created from chat",
      body: "Created from telegram conversation",
      contactIds: ["ct_new_1"],
    });

    await deleteThread(threadId);
  });
});

describe("Telegram adapter metadata extraction", () => {
  it("extracts firstName, lastName, and username from message payload", () => {
    const adapter = new TelegramAdapter("test-token", undefined, undefined);
    const payload = {
      message: {
        message_id: 1,
        from: {
          id: 12345,
          first_name: "Alice",
          last_name: "Smith",
          username: "alicesmith",
        },
        chat: { id: 67890 },
        text: "Hello",
        date: Math.floor(Date.now() / 1000),
      },
    };

    const result = adapter.parseIncomingMessage(payload);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      firstName: "Alice",
      lastName: "Smith",
      username: "alicesmith",
      contactName: "Alice Smith",
    });
  });

  it("extracts metadata from callback_query payload", () => {
    const adapter = new TelegramAdapter("test-token", undefined, undefined);
    const payload = {
      callback_query: {
        id: "cb_1",
        from: {
          id: 12345,
          first_name: "Bob",
          username: "bob42",
        },
        message: {
          chat: { id: 67890 },
        },
        data: "some_callback",
      },
    };

    const result = adapter.parseIncomingMessage(payload);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({
      firstName: "Bob",
      username: "bob42",
    });
  });

  it("returns empty metadata when no profile info available", () => {
    const adapter = new TelegramAdapter("test-token", undefined, undefined);
    const payload = {
      message: {
        message_id: 1,
        from: { id: 12345 },
        chat: { id: 67890 },
        text: "Hello",
        date: Math.floor(Date.now() / 1000),
      },
    };

    const result = adapter.parseIncomingMessage(payload);

    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({});
  });
});
