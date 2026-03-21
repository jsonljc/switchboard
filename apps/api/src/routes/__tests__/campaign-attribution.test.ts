import { describe, it, expect } from "vitest";
import { aggregateCampaignAttribution } from "../campaign-attribution.js";

describe("aggregateCampaignAttribution", () => {
  it("groups contacts by sourceCampaignId and counts leads, bookings, paid, revenue", () => {
    const contacts = [
      { id: "c1", sourceCampaignId: "camp1", sourceAdId: "ad1" },
      { id: "c2", sourceCampaignId: "camp1", sourceAdId: "ad2" },
      { id: "c3", sourceCampaignId: "camp2", sourceAdId: "ad3" },
    ];
    const deals = [
      { id: "d1", contactId: "c1", stage: "booked", amount: null },
      { id: "d2", contactId: "c2", stage: "won", amount: 500 },
      { id: "d3", contactId: "c3", stage: "lead", amount: null },
    ];
    const revenueEvents = [{ contactId: "c2", amount: 500 }];
    const campaignSpend = new Map([
      ["camp1", { name: "Campaign 1", spend: 200 }],
      ["camp2", { name: "Campaign 2", spend: 100 }],
    ]);

    const result = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);

    expect(result).toHaveLength(2);

    const camp1 = result.find((r) => r.campaignId === "camp1")!;
    expect(camp1.name).toBe("Campaign 1");
    expect(camp1.leads).toBe(2);
    expect(camp1.bookings).toBe(2); // booked + won both count
    expect(camp1.paid).toBe(1); // only won
    expect(camp1.revenue).toBe(500);
    expect(camp1.spend).toBe(200);
    expect(camp1.roas).toBeCloseTo(2.5);

    const camp2 = result.find((r) => r.campaignId === "camp2")!;
    expect(camp2.leads).toBe(1);
    expect(camp2.bookings).toBe(0);
    expect(camp2.paid).toBe(0);
    expect(camp2.revenue).toBe(0);
  });

  it("counts bookings correctly when contact has booked deal followed by a lead-stage deal", () => {
    const contacts = [{ id: "c1", sourceCampaignId: "camp1", sourceAdId: "ad1" }];
    const deals = [
      { id: "d1", contactId: "c1", stage: "booked", amount: 200 },
      { id: "d2", contactId: "c1", stage: "lead", amount: null },
    ];
    const revenueEvents: { contactId: string; amount: number }[] = [];
    const campaignSpend = new Map([["camp1", { name: "Camp 1", spend: 100 }]]);

    const result = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);
    const camp = result.find((r) => r.campaignId === "camp1")!;

    expect(camp.bookings).toBe(1);
    expect(camp.paid).toBe(0);
  });

  it("returns empty array when no contacts have campaign attribution", () => {
    const result = aggregateCampaignAttribution([], [], [], new Map());
    expect(result).toEqual([]);
  });
});
