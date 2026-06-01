import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaScheduledFollowUpStore } from "../prisma-scheduled-follow-up-store.js";

function createMockPrisma() {
  return {
    scheduledFollowUp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaScheduledFollowUpStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaScheduledFollowUpStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaScheduledFollowUpStore(prisma as never);
  });

  it("create() inserts a row and returns its id", async () => {
    prisma.scheduledFollowUp.create.mockResolvedValue({ id: "fu_1" });
    const result = await store.create({
      organizationId: "org-1",
      contactId: "contact-1",
      conversationThreadId: "thread-1",
      sessionId: "thread-1",
      deploymentId: "dep-1",
      workUnitId: "wu-1",
      channel: "whatsapp",
      jurisdiction: "SG",
      reason: "hesitation",
      note: "wants weekend pricing",
      templateIntentClass: "re-engagement-offer",
      dueAt: new Date("2026-06-04T10:00:00Z"),
      dedupeKey: "followup:org-1:contact-1:2026-06-04",
    });
    expect(result).toEqual({ id: "fu_1" });
    expect(prisma.scheduledFollowUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          contactId: "contact-1",
          dedupeKey: "followup:org-1:contact-1:2026-06-04",
          note: "wants weekend pricing",
          status: "pending",
        }),
        select: { id: true },
      }),
    );
  });

  it("findPendingForContact() scopes by org + contact + pending status", async () => {
    prisma.scheduledFollowUp.findFirst.mockResolvedValue({ id: "fu_1" });
    const result = await store.findPendingForContact("org-1", "contact-1");
    expect(result).toEqual({ id: "fu_1" });
    expect(prisma.scheduledFollowUp.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", contactId: "contact-1", status: "pending" },
      select: { id: true },
    });
  });

  it("findDue() returns due pending rows under the attempt cap", async () => {
    prisma.scheduledFollowUp.findMany.mockResolvedValue([
      {
        id: "fu_1",
        organizationId: "org-1",
        contactId: "contact-1",
        conversationThreadId: "thread-1",
        channel: "whatsapp",
        templateIntentClass: "re-engagement-offer",
        reason: "hesitation",
        attempts: 0,
      },
    ]);
    const now = new Date("2026-06-04T10:00:00Z");
    const rows = await store.findDue(now, 100);
    expect(rows).toHaveLength(1);
    expect(prisma.scheduledFollowUp.findMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        dueAt: { lte: now },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        attempts: { lt: 3 },
      },
      orderBy: { dueAt: "asc" },
      take: 100,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        conversationThreadId: true,
        channel: true,
        templateIntentClass: true,
        reason: true,
        attempts: true,
      },
    });
  });

  it("markSent() flips status to sent + stamps sentAt", async () => {
    await store.markSent("fu_1");
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: expect.objectContaining({ status: "sent" }),
    });
  });

  it("markSkipped() records the reason", async () => {
    await store.markSkipped("fu_1", "template_not_approved");
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
  });

  it("markFailed() re-queues when nextRetryAt is provided", async () => {
    const next = new Date("2026-06-04T10:30:00Z");
    await store.markFailed("fu_1", "boom", next);
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "pending", attempts: { increment: 1 }, nextRetryAt: next, lastError: "boom" },
    });
  });

  it("markFailed() terminates when nextRetryAt is null", async () => {
    await store.markFailed("fu_1", "boom", null);
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "failed", attempts: { increment: 1 }, lastError: "boom" },
    });
  });
});
