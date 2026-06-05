import { describe, expect, it } from "vitest";
import { ScheduledReminderStatusSchema, buildReminderDedupeKey } from "./scheduled-reminder.js";

describe("scheduled-reminder primitives", () => {
  it("status enum", () => {
    expect(ScheduledReminderStatusSchema.options).toEqual(["pending", "sent", "skipped", "failed"]);
  });
  it("dedupe key is booking + exact startsAt (reschedule-safe)", () => {
    const at = new Date("2026-05-13T02:00:00.000Z");
    expect(buildReminderDedupeKey("bk_1", at)).toBe("reminder:bk_1:2026-05-13T02:00:00.000Z");
  });
});
