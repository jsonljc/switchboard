import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaScheduledReminderStore } from "../prisma-scheduled-reminder-store.js";

function makePrisma() {
  return { scheduledReminder: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() } };
}

describe("PrismaScheduledReminderStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaScheduledReminderStore;
  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaScheduledReminderStore(prisma as never);
  });

  it("create persists pending row", async () => {
    prisma.scheduledReminder.create.mockResolvedValue({ id: "rm_1" });
    const out = await store.create({
      organizationId: "org_1",
      contactId: "c_1",
      bookingId: "bk_1",
      startsAt: new Date("2026-05-13T02:00:00.000Z"),
      timezone: "Asia/Singapore",
      channel: "whatsapp",
      templateIntentClass: "appointment-reminder",
      dedupeKey: "reminder:bk_1:2026-05-13T02:00:00.000Z",
    });
    expect(out).toEqual({ id: "rm_1" });
    expect(prisma.scheduledReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending" }),
        select: { id: true },
      }),
    );
  });

  it("findByDedupeKey returns id+status or null", async () => {
    prisma.scheduledReminder.findUnique.mockResolvedValue({ id: "rm_1", status: "sent" });
    expect(await store.findByDedupeKey("k")).toEqual({ id: "rm_1", status: "sent" });
    expect(prisma.scheduledReminder.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: "k" },
      select: { id: true, status: true },
    });
    prisma.scheduledReminder.findUnique.mockResolvedValue(null);
    expect(await store.findByDedupeKey("k")).toBeNull();
  });

  it("markSent / markSkipped / markFailed set terminal state", async () => {
    prisma.scheduledReminder.update.mockResolvedValue({});
    await store.markSent("rm_1");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rm_1" },
        data: expect.objectContaining({ status: "sent" }),
      }),
    );
    await store.markSkipped("rm_1", "template_not_approved");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: "rm_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
    await store.markFailed("rm_1", "boom");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: "rm_1" },
      data: { status: "failed", lastError: "boom" },
    });
  });
});
