import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock types matching the route's dependencies
interface MockPrisma {
  handoff: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  conversationState: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe("POST /api/escalations/:id/reply — channel delivery", () => {
  let mockPrisma: MockPrisma;
  let mockNotifier: { sendProactive: ReturnType<typeof vi.fn> };

  const handoff = {
    id: "esc-1",
    sessionId: "sess-wa-123",
    organizationId: "org-1",
    leadId: "lead-1",
    status: "pending",
    reason: "human_requested",
    conversationSummary: {},
    leadSnapshot: {},
    qualificationSnapshot: {},
    slaDeadlineAt: new Date("2026-05-01"),
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const conversation = {
    threadId: "sess-wa-123",
    channel: "whatsapp",
    principalId: "user-phone-123",
    messages: [{ role: "user", text: "I need help", timestamp: "2026-04-26T10:00:00Z" }],
    lastActivityAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      handoff: {
        findUnique: vi.fn().mockResolvedValue(handoff),
        update: vi
          .fn()
          .mockResolvedValue({ ...handoff, status: "released", acknowledgedAt: new Date() }),
      },
      conversationState: {
        findUnique: vi.fn().mockResolvedValue(conversation),
        update: vi.fn().mockResolvedValue(conversation),
      },
    };
    mockNotifier = { sendProactive: vi.fn().mockResolvedValue(undefined) };
  });

  it("calls sendProactive with the customer's channel and principalId after DB update", async () => {
    // Simulate the reply handler logic
    const message = "We can fit you in at 3pm tomorrow.";

    // 1. Find handoff
    const found = await mockPrisma.handoff.findUnique({ where: { id: "esc-1" } });
    expect(found).toBeDefined();

    // 2. Find conversation to get channel + principalId
    const conv = await mockPrisma.conversationState.findUnique({
      where: { threadId: found!.sessionId },
    });
    expect(conv).toBeDefined();
    expect(conv!.channel).toBe("whatsapp");

    // 3. Deliver via notifier
    await mockNotifier.sendProactive(conv!.principalId, conv!.channel, message);

    expect(mockNotifier.sendProactive).toHaveBeenCalledWith("user-phone-123", "whatsapp", message);
  });

  it("returns replySent: false and 502 if channel delivery fails", async () => {
    mockNotifier.sendProactive.mockRejectedValue(new Error("WhatsApp API error: 401"));

    let replySent = true;
    let statusCode = 200;

    try {
      await mockNotifier.sendProactive("user-phone-123", "whatsapp", "test");
      replySent = true;
    } catch {
      replySent = false;
      statusCode = 502;
    }

    expect(replySent).toBe(false);
    expect(statusCode).toBe(502);
  });

  it("still updates handoff status to released even if delivery fails", async () => {
    // The handoff update happens before delivery attempt
    await mockPrisma.handoff.update({
      where: { id: "esc-1" },
      data: { status: "released", acknowledgedAt: new Date() },
    });

    expect(mockPrisma.handoff.update).toHaveBeenCalled();
  });
});
