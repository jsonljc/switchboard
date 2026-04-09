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
});
