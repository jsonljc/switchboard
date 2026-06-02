import { describe, expect, it, vi } from "vitest";
import { executeAppointmentReminderDispatch } from "../appointment-reminder-dispatch.js";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const NOW = new Date("2026-05-12T01:00:00.000Z");
function booking(o = {}) {
  return {
    id: "bk_1",
    organizationId: "org_1",
    contactId: "c_1",
    startsAt: new Date("2026-05-13T02:00:00.000Z"),
    timezone: "Asia/Singapore",
    attendeeName: "Mei",
    ...o,
  };
}
function deps(over = {}) {
  return {
    failure: {} as never,
    findUpcomingConfirmed: vi.fn().mockResolvedValue([booking()]),
    findReminderByDedupeKey: vi.fn().mockResolvedValue(null),
    createReminder: vi.fn().mockResolvedValue({ id: "rm_1" }),
    submitReminderSend: vi
      .fn()
      .mockResolvedValue({ ok: true, result: { outputs: { sent: true } } }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    now: () => NOW,
    ...over,
  };
}

describe("appointment reminder dispatch", () => {
  it("queries the [now+23h, now+25h] window", async () => {
    const d = deps();
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.findUpcomingConfirmed).toHaveBeenCalledWith(
      new Date("2026-05-13T00:00:00.000Z"),
      new Date("2026-05-13T02:00:00.000Z"),
    );
  });

  it("creates a reminder (dedupe key) and marks sent", async () => {
    const d = deps();
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "bk_1",
        organizationId: "org_1",
        contactId: "c_1",
        timezone: "Asia/Singapore",
        channel: "whatsapp",
        templateIntentClass: "appointment-reminder",
        dedupeKey: "reminder:bk_1:2026-05-13T02:00:00.000Z",
      }),
    );
    expect(d.submitReminderSend).toHaveBeenCalledWith(
      expect.objectContaining({ reminderId: "rm_1", bookingId: "bk_1", channel: "whatsapp" }),
    );
    expect(d.markSent).toHaveBeenCalledWith("rm_1");
  });

  it("skips a booking already terminally handled", async () => {
    const d = deps({
      findReminderByDedupeKey: vi.fn().mockResolvedValue({ id: "rm_1", status: "sent" }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.createReminder).not.toHaveBeenCalled();
    expect(d.submitReminderSend).not.toHaveBeenCalled();
  });

  it("maps sent:false → markSkipped(reason)", async () => {
    const d = deps({
      submitReminderSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("rm_1", "template_not_approved");
  });

  it("maps !ok → markFailed (terminal, no retry)", async () => {
    const d = deps({
      submitReminderSend: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { type: "upstream_error" } }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.markFailed).toHaveBeenCalledWith("rm_1", "upstream_error");
  });
});
