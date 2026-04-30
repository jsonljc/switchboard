import { describe, expect, it } from "vitest";
import { mapNumbersStrip, mapOpStrip } from "../console-mappers";

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

describe("mapNumbersStrip", () => {
  const baseInput = { leadsToday: 7, leadsYesterday: 5, bookingsToday: [] };

  it("returns 5 cells", () => {
    const result = mapNumbersStrip(baseInput);
    expect(result.cells).toHaveLength(5);
  });

  it("Leads cell uses today vs yesterday delta", () => {
    const result = mapNumbersStrip(baseInput);
    const leads = result.cells.find((c) => c.label === "Leads today");
    expect(leads?.value).toBe("7");
    expect(leads?.placeholder).not.toBe(true);
    expect(leads?.tone).toBe("good");
  });

  it("Leads cell tone is coral when down vs yesterday", () => {
    const result = mapNumbersStrip({ ...baseInput, leadsToday: 3 });
    const leads = result.cells.find((c) => c.label === "Leads today");
    expect(leads?.tone).toBe("coral");
  });

  it("Appointments cell shows count + next time + contact", () => {
    const result = mapNumbersStrip({
      ...baseInput,
      bookingsToday: [
        { startsAt: "2026-04-30T11:00:00", contactName: "Sarah" },
        { startsAt: "2026-04-30T14:30:00", contactName: "Marisol" },
      ],
    });
    const appts = result.cells.find((c) => c.label === "Appointments");
    expect(appts?.value).toBe("2");
    const text = JSON.stringify(appts?.delta);
    expect(text).toContain("11:00");
    expect(text).toContain("Sarah");
  });

  it("Revenue / Spend / Reply Time are placeholder cells with '—'", () => {
    const result = mapNumbersStrip(baseInput);
    const rev = result.cells.find((c) => c.label === "Revenue today");
    const spend = result.cells.find((c) => c.label === "Spend today");
    const reply = result.cells.find((c) => c.label === "Reply time");
    for (const cell of [rev, spend, reply]) {
      expect(cell?.placeholder).toBe(true);
      expect(cell?.value).toBe("—");
    }
  });
});
