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
      findUnique: vi.fn(),
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
    it("returns status from ConversationState when it exists", async () => {
      mockPrisma.conversationState.findUnique.mockResolvedValue({
        status: "human_override",
      });

      const store = new PrismaGatewayConversationStore(mockPrisma as never);
      const result = await store.getConversationStatus("session-1");

      expect(result).toBe("human_override");
      expect(mockPrisma.conversationState.findUnique).toHaveBeenCalledWith({
        where: { threadId: "session-1" },
        select: { status: true },
      });
    });

    it("returns null when no ConversationState exists for sessionId", async () => {
      mockPrisma.conversationState.findUnique.mockResolvedValue(null);

      const store = new PrismaGatewayConversationStore(mockPrisma as never);
      const result = await store.getConversationStatus("nonexistent");

      expect(result).toBe(null);
      expect(mockPrisma.conversationState.findUnique).toHaveBeenCalledWith({
        where: { threadId: "nonexistent" },
        select: { status: true },
      });
    });
  });
});
