import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaRobinRecoverySendStore } from "../prisma-robin-recovery-send-store.js";

function makePrisma() {
  return {
    robinRecoverySend: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
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

  it("SPINE-5 at-most-once invariant: a markSendInFlight-claimed row (nextRetryAt=null) is structurally excluded from findDue's due-set", async () => {
    // The two store predicates that COMPOSE the pre-send-claim ordering guarantee,
    // pinned together as one named invariant:
    //   (1) markSendInFlight clears nextRetryAt -> the row is no longer "due".
    //   (2) findDue selects ONLY rows with nextRetryAt <= now. In SQL a `lte`
    //       comparison against NULL is UNKNOWN, so a null-nextRetryAt (claimed) row
    //       is NEVER returned — and findDue must NOT carry the prior-art
    //       `OR nextRetryAt: null` leg that dispatchRecoveryRow deliberately dropped
    //       (re-introducing it would re-queue claimed rows -> double-send).
    // Because the claim is made BEFORE the network send, a crashed or failed
    // post-send write can never re-queue the row -> at-most-once. (The composed
    // guarantee is proven end-to-end against real Postgres in EV-16; here we pin
    // the two store predicates that compose to it.)
    prisma.robinRecoverySend.update.mockResolvedValue({});
    prisma.robinRecoverySend.findMany.mockResolvedValue([]);
    const now = new Date("2026-06-21T20:00:00.000Z");

    await store.markSendInFlight("rs_claim");
    expect(prisma.robinRecoverySend.update.mock.calls[0]![0].data.nextRetryAt).toBeNull(); // (1)

    await store.findDue(now, 100);
    const dueWhere = prisma.robinRecoverySend.findMany.mock.calls[0]![0].where;
    expect(dueWhere.nextRetryAt).toEqual({ lte: now }); // (2) bounded; no `null` leg
    expect(dueWhere.nextRetryAt).not.toHaveProperty("OR");
    expect(JSON.stringify(dueWhere.nextRetryAt)).not.toContain("null");
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

  describe("crash-orphaned claim reaper (P2-13)", () => {
    it("findOrphanedClaims selects the orphan shape: pending + nextRetryAt NULL + stale updatedAt", async () => {
      // The orphan is pending + nextRetryAt NULL (markSendInFlight ran, no terminal write followed).
      // updatedAt < olderThan is the staleness signal that excludes a freshly-claimed in-flight row.
      prisma.robinRecoverySend.findMany.mockResolvedValue([]);
      const olderThan = new Date("2026-06-26T11:30:00.000Z");
      await store.findOrphanedClaims(olderThan, 500);
      expect(prisma.robinRecoverySend.findMany).toHaveBeenCalledWith({
        where: {
          status: "pending",
          nextRetryAt: null,
          updatedAt: { lt: olderThan },
        },
        orderBy: { updatedAt: "asc" },
        take: 500,
        select: {
          id: true,
          organizationId: true,
          contactId: true,
          bookingId: true,
          updatedAt: true,
        },
      });
    });

    it("reapOrphanedClaim is a status-CAS updateMany that dead-letters ONLY a still-orphaned row", async () => {
      // Guarded compare-and-set: the WHERE re-asserts the full orphan shape (id + pending + nextRetryAt
      // NULL + stale), so a concurrent live sender (markSent/markFailed/markSkipped) that already moved
      // the row makes this match 0 rows. The write is a terminal dead-letter (status=failed); it NEVER
      // re-queues (nextRetryAt stays NULL) and NEVER triggers a send -> double-send-safe.
      prisma.robinRecoverySend.updateMany.mockResolvedValue({ count: 1 });
      const olderThan = new Date("2026-06-26T11:30:00.000Z");
      const out = await store.reapOrphanedClaim("rs_orphan", "org_1", olderThan);
      expect(prisma.robinRecoverySend.updateMany).toHaveBeenCalledWith({
        where: {
          id: "rs_orphan",
          organizationId: "org_1",
          status: "pending",
          nextRetryAt: null,
          updatedAt: { lt: olderThan },
        },
        data: {
          status: "failed",
          lastError: "reaped_orphaned_claim",
          nextRetryAt: null,
        },
      });
      expect(out).toEqual({ count: 1 });
    });

    it("reapOrphanedClaim passes through count===0 (a concurrent writer won the row -> benign race)", async () => {
      prisma.robinRecoverySend.updateMany.mockResolvedValue({ count: 0 });
      const out = await store.reapOrphanedClaim(
        "rs_raced",
        "org_1",
        new Date("2026-06-26T11:30:00.000Z"),
      );
      expect(out).toEqual({ count: 0 });
    });
  });
});
