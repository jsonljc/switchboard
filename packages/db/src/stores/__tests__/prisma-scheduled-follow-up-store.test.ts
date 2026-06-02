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
      touchNumber: 1,
      cadenceId: "cad-1",
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

  it("create persists touchNumber and cadenceId", async () => {
    prisma.scheduledFollowUp.create.mockResolvedValue({ id: "fu_1" });
    await store.create({
      organizationId: "org_1",
      contactId: "c_1",
      conversationThreadId: "th_1",
      sessionId: "th_1",
      deploymentId: "dep_1",
      workUnitId: "wu_1",
      channel: "whatsapp",
      jurisdiction: "SG",
      reason: "hesitation",
      note: null,
      templateIntentClass: "re-engagement-offer",
      dueAt: new Date("2026-06-04T00:00:00.000Z"),
      dedupeKey: "followup:org_1:c_1:2026-06-04:t1",
      touchNumber: 1,
      cadenceId: "cad_1",
    });
    expect(prisma.scheduledFollowUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ touchNumber: 1, cadenceId: "cad_1", status: "pending" }),
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
    prisma.scheduledFollowUp.findMany.mockResolvedValue([]);
    const now = new Date("2026-06-04T10:00:00Z");
    await store.findDue(now, 100);
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
        sessionId: true,
        deploymentId: true,
        workUnitId: true,
        channel: true,
        jurisdiction: true,
        reason: true,
        note: true,
        templateIntentClass: true,
        attempts: true,
        dueAt: true,
        touchNumber: true,
        cadenceId: true,
      },
    });
  });

  it("findDue projects the cadence + carry-over fields", async () => {
    prisma.scheduledFollowUp.findMany.mockResolvedValue([]);
    await store.findDue(new Date("2026-06-04T00:00:00.000Z"), 100);
    const call = prisma.scheduledFollowUp.findMany.mock.calls[0]![0];
    expect(call.select).toEqual({
      id: true,
      organizationId: true,
      contactId: true,
      conversationThreadId: true,
      sessionId: true,
      deploymentId: true,
      workUnitId: true,
      channel: true,
      jurisdiction: true,
      reason: true,
      note: true,
      templateIntentClass: true,
      attempts: true,
      dueAt: true,
      touchNumber: true,
      cadenceId: true,
    });
    expect(call.where.attempts).toEqual({ lt: 3 });
  });

  it("markSent() flips status to sent + stamps sentAt + clears any stale skipReason", async () => {
    await store.markSent("fu_1");
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: expect.objectContaining({ status: "sent", skipReason: null }),
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

  it("markDeferred keeps the row pending without consuming an attempt", async () => {
    prisma.scheduledFollowUp.update.mockResolvedValue({});
    const at = new Date("2026-06-04T01:00:00.000Z");
    await store.markDeferred("fu_1", "template_not_approved", at);
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "pending", skipReason: "template_not_approved", nextRetryAt: at },
    });
  });
});
