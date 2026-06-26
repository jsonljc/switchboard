import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGatewayConversationStore } from "../gateway-conversation-store.js";

describe("PrismaGatewayConversationStore", () => {
  const mockPrisma = {
    conversationThread: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversationMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    conversationState: {
      findFirst: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates new conversation when none exists", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue(null);
    mockPrisma.conversationThread.create.mockResolvedValue({
      id: "new-conv",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([]);

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    const result = await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");

    expect(result.conversationId).toBe("new-conv");
    expect(result.messages).toEqual([]);
    expect(mockPrisma.conversationThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "visitor-sess-1",
          organizationId: "gateway",
          agentContext: { deploymentId: "dep-1", sessionId: "sess-1", channel: "web_widget" },
        }),
      }),
    );
  });

  it("returns existing conversation with message history", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue({
      id: "existing-conv",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([
      { id: "m1", direction: "inbound", content: "hello", contactId: "visitor-sess-1" },
      { id: "m2", direction: "outbound", content: "hi there", contactId: "visitor-sess-1" },
    ]);

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    const result = await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");

    expect(result.conversationId).toBe("existing-conv");
    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("adds message to conversation", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue({
      id: "conv-1",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([]);
    mockPrisma.conversationMessage.create.mockResolvedValue({ id: "m3" });
    mockPrisma.conversationThread.update.mockResolvedValue({});

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");
    await store.addMessage("conv-1", "user", "test message");

    expect(mockPrisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "visitor-sess-1",
          orgId: "gateway",
          direction: "inbound",
          content: "test message",
          channel: "web_widget",
        }),
      }),
    );
  });

  describe("addMessage — lastWhatsAppInboundAt invariant", () => {
    beforeEach(() => {
      mockPrisma.conversationMessage.create.mockResolvedValue({ id: "m-new" });
      mockPrisma.conversationThread.update.mockResolvedValue({});
    });

    async function makeStoreWithThread(channel: string) {
      mockPrisma.conversationThread.findFirst.mockResolvedValue({
        id: "thread-wa",
        contactId: "visitor-sess-wa",
        organizationId: "gateway",
      });
      mockPrisma.conversationMessage.findMany.mockResolvedValue([]);
      const store = new PrismaGatewayConversationStore(mockPrisma as never);
      await store.getOrCreateBySession("dep-wa", channel, "sess-wa");
      return store;
    }

    it("sets lastWhatsAppInboundAt when inbound + whatsapp", async () => {
      const store = await makeStoreWithThread("whatsapp");
      await store.addMessage("thread-wa", "user", "hi");
      expect(mockPrisma.conversationThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "thread-wa" },
          data: expect.objectContaining({
            messageCount: { increment: 1 },
            lastWhatsAppInboundAt: expect.any(Date),
          }),
        }),
      );
    });

    it("does NOT set lastWhatsAppInboundAt for outbound (assistant) messages on whatsapp", async () => {
      const store = await makeStoreWithThread("whatsapp");
      await store.addMessage("thread-wa", "assistant", "hi back");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const call = mockPrisma.conversationThread.update.mock.calls[0]![0];
      expect(call.data).not.toHaveProperty("lastWhatsAppInboundAt");
    });

    it("does NOT set lastWhatsAppInboundAt for non-whatsapp inbound", async () => {
      const store = await makeStoreWithThread("telegram");
      await store.addMessage("thread-wa", "user", "hi");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const call = mockPrisma.conversationThread.update.mock.calls[0]![0];
      expect(call.data).not.toHaveProperty("lastWhatsAppInboundAt");
    });
  });

  describe("getConversationStatus", () => {
    it("reads status org-scoped via findFirst on (threadId, organizationId)", async () => {
      mockPrisma.conversationState.findFirst.mockResolvedValue({
        status: "human_override",
      });

      const store = new PrismaGatewayConversationStore(mockPrisma as never);
      const result = await store.getConversationStatus("session-1", "org-1");

      expect(result).toBe("human_override");
      // audit #2: scoped by org so a shared phone never reads another tenant's row.
      expect(mockPrisma.conversationState.findFirst).toHaveBeenCalledWith({
        where: { threadId: "session-1", organizationId: "org-1" },
        select: { status: true },
      });
    });

    it("returns null when no ConversationState exists for (sessionId, org)", async () => {
      mockPrisma.conversationState.findFirst.mockResolvedValue(null);

      const store = new PrismaGatewayConversationStore(mockPrisma as never);
      const result = await store.getConversationStatus("nonexistent", "org-1");

      expect(result).toBe(null);
      expect(mockPrisma.conversationState.findFirst).toHaveBeenCalledWith({
        where: { threadId: "nonexistent", organizationId: "org-1" },
        select: { status: true },
      });
    });
  });
});

function makePrisma(createSpy: ReturnType<typeof vi.fn>) {
  return {
    conversationThread: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: createSpy,
      update: vi.fn().mockResolvedValue({}),
    },
    conversationMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    conversationState: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as import("@switchboard/db").PrismaClient;
}

describe("PrismaGatewayConversationStore thread re-key", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let store: PrismaGatewayConversationStore;

  beforeEach(() => {
    createSpy = vi.fn().mockResolvedValue({ id: "thr_1" });
    store = new PrismaGatewayConversationStore(makePrisma(createSpy));
  });

  it("keys the new thread off the resolved contactId + organizationId when identity is provided", async () => {
    await store.getOrCreateBySession("dep_1", "whatsapp", "+6591234567", {
      organizationId: "org_real",
      contactId: "ct_real",
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "ct_real", organizationId: "org_real" }),
      }),
    );
  });

  it("falls back to visitor-/gateway literals when identity is absent (no resolvable contact)", async () => {
    await store.getOrCreateBySession("dep_1", "web", "sess_x");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "visitor-sess_x", organizationId: "gateway" }),
      }),
    );
  });

  it("falls back to the visitor- literal when identity.contactId is null", async () => {
    await store.getOrCreateBySession("dep_1", "whatsapp", "sess_y", {
      organizationId: "org_real",
      contactId: null,
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "visitor-sess_y", organizationId: "org_real" }),
      }),
    );
  });
});
