import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaRobinRecoverySendStore } from "../prisma-robin-recovery-send-store.js";

function makePrisma() {
  return { robinRecoverySend: { create: vi.fn(), update: vi.fn() } };
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

  it("markSkipped / markFailed set terminal state", async () => {
    prisma.robinRecoverySend.update.mockResolvedValue({});
    await store.markSkipped("rs_1", "template_not_approved");
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
    await store.markFailed("rs_1", "boom");
    expect(prisma.robinRecoverySend.update).toHaveBeenCalledWith({
      where: { id: "rs_1" },
      data: { status: "failed", lastError: "boom" },
    });
  });
});
