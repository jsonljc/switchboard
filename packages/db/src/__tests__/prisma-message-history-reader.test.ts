import { describe, expect, it, vi } from "vitest";
import { PrismaMessageHistoryReader } from "../prisma-message-history-reader.js";

describe("PrismaMessageHistoryReader.read", () => {
  it("returns null/null when the thread doesn't exist", async () => {
    const prisma = {
      conversationThread: { findUnique: vi.fn().mockResolvedValue(null) },
      conversationMessage: { findFirst: vi.fn() },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaMessageHistoryReader(prisma as any);
    const result = await reader.read("thread-1");
    expect(result.lastAlexOutboundAt).toBeNull();
    expect(result.lastInboundAt).toBeNull();
    expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
  });

  it("looks up thread by id, then filters messages by contactId+orgId+direction", async () => {
    const earlier = new Date("2026-05-10T09:00:00Z");
    const later = new Date("2026-05-10T09:05:00Z");
    const prisma = {
      conversationThread: {
        findUnique: vi.fn().mockResolvedValue({ contactId: "contact-1", organizationId: "org-1" }),
      },
      conversationMessage: {
        findFirst: vi
          .fn()
          .mockImplementationOnce(async () => ({ createdAt: later })) // outbound first
          .mockImplementationOnce(async () => ({ createdAt: earlier })), // inbound second
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaMessageHistoryReader(prisma as any);
    const result = await reader.read("thread-1");
    expect(result.lastAlexOutboundAt).toEqual(later);
    expect(result.lastInboundAt).toEqual(earlier);
    expect(prisma.conversationThread.findUnique).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      select: { contactId: true, organizationId: true },
    });
    expect(prisma.conversationMessage.findFirst).toHaveBeenNthCalledWith(1, {
      where: { contactId: "contact-1", orgId: "org-1", direction: "outbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    expect(prisma.conversationMessage.findFirst).toHaveBeenNthCalledWith(2, {
      where: { contactId: "contact-1", orgId: "org-1", direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
  });
});
