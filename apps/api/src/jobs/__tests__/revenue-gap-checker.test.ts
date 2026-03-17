import { describe, it, expect } from "vitest";
import { findUnrecordedAppointments } from "../revenue-gap-checker.js";

describe("findUnrecordedAppointments", () => {
  it("returns appointments past grace period with no revenue event", async () => {
    const mockDeals = [
      {
        id: "deal_1",
        name: "John Cleaning",
        stage: "consultation_completed",
        contactIds: ["ct_1"],
        closeDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3hrs ago
        amount: 200,
      },
    ];
    const mockRevenueEvents: string[] = []; // no matching events

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].dealId).toBe("deal_1");
  });

  it("excludes appointments within grace period", async () => {
    const mockDeals = [
      {
        id: "deal_2",
        name: "Sarah Checkup",
        stage: "consultation_completed",
        contactIds: ["ct_2"],
        closeDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1hr ago
        amount: 150,
      },
    ];
    const mockRevenueEvents: string[] = [];

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(0);
  });

  it("excludes appointments that already have revenue recorded", async () => {
    const mockDeals = [
      {
        id: "deal_3",
        name: "Tom Crown",
        stage: "consultation_completed",
        contactIds: ["ct_3"],
        closeDate: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        amount: 500,
      },
    ];
    const mockRevenueEvents = ["ct_3"]; // already recorded

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(0);
  });
});
