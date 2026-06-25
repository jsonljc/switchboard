import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaRobinRecoverySendStore } from "../prisma-robin-recovery-send-store.js";

function makePrisma() {
  return { robinRecoverySend: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() } };
}

describe("PrismaRobinRecoverySendStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaRobinRecoverySendStore;
  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaRobinRecoverySendStore(prisma as never);
  });

  it("create persists a pending row and returns its id", async () => {
    prisma.robinRecoverySend.create.mockResolvedValue({ id: "rs_1" });
    const out = await store.create({
      organizationId: "org_1",
      contactId: "c_1",
      bookingId: "bk_1",
      campaignKind: "no_show",
      campaignWorkUnitId: "wu_1",
      dedupeKey: "recovery:no_show:org_1:bk_1",
    });
    expect(out).toEqual({ id: "rs_1" });
    expect(prisma.robinRecoverySend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "pending",
          dedupeKey: "recovery:no_show:org_1:bk_1",
          campaignWorkUnitId: "wu_1",
        }),
        select: { id: true },
      }),
    );
  });

  it("create coerces an absent campaignWorkUnitId to null", async () => {
    prisma.robinRecoverySend.create.mockResolvedValue({ id: "rs_2" });
    await store.create({
      organizationId: "org_1",
      contactId: "c_1",
      bookingId: "bk_2",
      campaignKind: "no_show",
      dedupeKey: "recovery:no_show:org_1:bk_2",
    });
    expect(prisma.robinRecoverySend.create.mock.calls[0]![0].data.campaignWorkUnitId).toBeNull();
  });

  it("markSent sets sent + messageId + sentAt", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markSent("rs_1", "wamid.X");
    const call = prisma.robinRecoverySend.update.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "rs_1" });
    expect(call.data).toEqual(expect.objectContaining({ status: "sent", messageId: "wamid.X" }));
    expect(call.data.sentAt).toBeInstanceOf(Date);
  });

  it("markSent tolerates a null messageId", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markSent("rs_1", null);
    expect(prisma.robinRecoverySend.update.mock.calls[0]![0].data.messageId).toBeNull();
  });

  it("markSendInFlight clears nextRetryAt (removes the row from the retry-due set before sending)", async () => {
    // Pre-send claim: once an attempt starts, the row must not be re-selected by findDue (which keys
    // on a due nextRetryAt) even if the post-send markSent fails -> at-most-once, no double-send.
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markSendInFlight("rs_1");
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: { nextRetryAt: null },
    });
  });

  it("markSkipped sets terminal skipped state", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markSkipped("rs_1", "template_not_approved");
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
  });

  it("findDue returns explicitly-rescheduled pending rows within attempt cap and age window", async () => {
    prisma.robinRecoverySend.findMany.mockResolvedValue([]);
    const now = new Date("2026-06-21T20:00:00.000Z");
    await store.findDue(now, 100);
    expect(prisma.robinRecoverySend.findMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        nextRetryAt: { lte: now },
        attempts: { lt: 3 },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { nextRetryAt: "asc" },
      take: 100,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        bookingId: true,
        campaignKind: true,
        attempts: true,
      },
    });
  });

  it("markFailed re-queues (pending + nextRetryAt) when nextRetryAt is provided", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    const next = new Date("2026-06-21T20:15:00.000Z");
    await store.markFailed("rs_1", "boom", next);
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: { status: "pending", attempts: { increment: 1 }, nextRetryAt: next, lastError: "boom" },
    });
  });

  it("markFailed dead-letters (failed + nextRetryAt null) when nextRetryAt is null", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markFailed("rs_1", "boom", null);
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        nextRetryAt: null,
        lastError: "boom",
      },
    });
  });
});
