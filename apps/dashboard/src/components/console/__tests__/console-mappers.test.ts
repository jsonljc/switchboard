import { describe, expect, it } from "vitest";
import { mapOpStrip } from "../console-mappers";

describe("mapOpStrip", () => {
  it("formats now as 'Day HH:MM AM/PM' and passes through orgName + dispatch", () => {
    const now = new Date("2026-04-30T10:42:00");
    const result = mapOpStrip("Aurora Dental", now, "live");
    expect(result.orgName).toBe("Aurora Dental");
    expect(result.dispatch).toBe("live");
    // e.g. "Thu 10:42 AM"
    expect(result.now).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)$/);
  });
});
