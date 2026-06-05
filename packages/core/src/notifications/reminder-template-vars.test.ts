import { describe, expect, it } from "vitest";
import { formatReminderDateTime } from "./reminder-template-vars.js";

describe("formatReminderDateTime", () => {
  it("renders date + time in the clinic timezone (SG, +8)", () => {
    // 02:00 UTC == 10:00 AM in Asia/Singapore on 13 May 2026
    const out = formatReminderDateTime(new Date("2026-05-13T02:00:00.000Z"), "Asia/Singapore");
    expect(out.date).toBe("13 May 2026");
    expect(out.time).toBe("10:00 AM");
  });
  it("respects a different timezone (MY shares +8)", () => {
    const out = formatReminderDateTime(new Date("2026-05-13T01:30:00.000Z"), "Asia/Kuala_Lumpur");
    expect(out.date).toBe("13 May 2026");
    expect(out.time).toBe("9:30 AM");
  });
});
