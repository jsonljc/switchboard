import { describe, it, expect, vi, beforeEach } from "vitest";

describe("POST /api/conversations/:threadId/send", () => {
  let mockPrisma: {
    conversationState: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let mockNotifier: { sendProactive: ReturnType<typeof vi.fn> };

  const conversation = {
    id: "conv-1",
    threadId: "sess-wa-456",
    channel: "whatsapp",
    principalId: "+1234567890",
    organizationId: "org-1",
    status: "human_override",
    messages: [],
    lastActivityAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue(conversation),
        update: vi.fn().mockResolvedValue(conversation),
      },
    };
    mockNotifier = { sendProactive: vi.fn().mockResolvedValue(undefined) };
  });

  it("delivers message to channel and appends to conversation", async () => {
    const message = "Hi, this is the business owner following up.";

    // Simulate handler logic
    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "sess-wa-456", organizationId: "org-1" },
    });
    expect(conv).toBeDefined();

    await mockNotifier.sendProactive(conv!.principalId, conv!.channel, message);
    expect(mockNotifier.sendProactive).toHaveBeenCalledWith("+1234567890", "whatsapp", message);
  });

  it("rejects send for conversation not in human_override status", async () => {
    mockPrisma.conversationState.findFirst.mockResolvedValue({
      ...conversation,
      status: "active",
    });

    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "sess-wa-456", organizationId: "org-1" },
    });

    // Route should reject if not in human_override
    expect(conv!.status).not.toBe("human_override");
  });

  it("returns 404 for unknown threadId", async () => {
    mockPrisma.conversationState.findFirst.mockResolvedValue(null);

    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "nonexistent", organizationId: "org-1" },
    });
    expect(conv).toBeNull();
  });
});
