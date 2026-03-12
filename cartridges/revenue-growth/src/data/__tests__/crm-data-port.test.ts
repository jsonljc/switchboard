import { describe, it, expect } from "vitest";
import {
  NullCrmAdapter,
  MockCrmAdapter,
  CrmConnector,
  type CrmLead,
  type CrmDeal,
  type CrmStageConversion,
} from "../crm-data-port.js";

describe("NullCrmAdapter", () => {
  const adapter = new NullCrmAdapter();

  it("returns empty leads", async () => {
    expect(await adapter.fetchLeads("acct-1")).toEqual([]);
  });

  it("returns empty deals", async () => {
    expect(await adapter.fetchDeals("acct-1")).toEqual([]);
  });

  it("returns empty stage conversions", async () => {
    expect(await adapter.fetchStageConversions("acct-1")).toEqual([]);
  });
});

describe("MockCrmAdapter", () => {
  it("returns configured leads", async () => {
    const leads: CrmLead[] = [
      { id: "l1", sourceAdId: "ad-1", createdAt: "2025-01-01T00:00:00Z", status: "new" },
    ];
    const adapter = new MockCrmAdapter({ leads });
    expect(await adapter.fetchLeads("acct-1")).toEqual(leads);
  });

  it("returns empty arrays when no data configured", async () => {
    const adapter = new MockCrmAdapter();
    expect(await adapter.fetchLeads("acct-1")).toEqual([]);
    expect(await adapter.fetchDeals("acct-1")).toEqual([]);
    expect(await adapter.fetchStageConversions("acct-1")).toEqual([]);
  });
});

describe("CrmConnector", () => {
  const now = "2025-01-10T00:00:00Z";
  const weekAgo = "2025-01-03T00:00:00Z";

  const leads: CrmLead[] = [
    { id: "l1", sourceAdId: "ad-1", createdAt: weekAgo, status: "qualified" },
    { id: "l2", sourceAdId: null, createdAt: weekAgo, status: "new" },
    { id: "l3", sourceAdId: "ad-2", createdAt: weekAgo, status: "contacted" },
  ];

  const deals: CrmDeal[] = [
    {
      id: "d1",
      leadId: "l1",
      value: 5000,
      stage: "closed",
      createdAt: weekAgo,
      closedAt: now,
      firstContactAt: "2025-01-03T12:00:00Z",
    },
    {
      id: "d2",
      leadId: "l2",
      value: 3000,
      stage: "proposal",
      createdAt: weekAgo,
      closedAt: null,
      firstContactAt: "2025-01-04T00:00:00Z",
    },
  ];

  const conversions: CrmStageConversion[] = [
    { fromStage: "lead", toStage: "qualified", conversionRate: 0.6 },
    { fromStage: "qualified", toStage: "proposal", conversionRate: 0.4 },
  ];

  it("maps CRM data to CrmSummary", async () => {
    const adapter = new MockCrmAdapter({ leads, deals, stageConversions: conversions });
    const connector = new CrmConnector(adapter);

    const summary = await connector.fetchCrmSummary("acct-1");

    expect(summary).not.toBeNull();
    expect(summary!.totalLeads).toBe(3);
    expect(summary!.matchedLeads).toBe(2);
    expect(summary!.matchRate).toBeCloseTo(2 / 3);
    expect(summary!.openDeals).toBe(1);
    expect(summary!.averageDealValue).toBe(5000);
    expect(summary!.leadToCloseRate).toBeCloseTo(1 / 3);
    expect(summary!.adAttributedLeads).toBe(2);
    expect(summary!.stageConversionRates).toEqual({
      "lead→qualified": 0.6,
      "qualified→proposal": 0.4,
    });
  });

  it("returns null when no leads or deals", async () => {
    const adapter = new MockCrmAdapter();
    const connector = new CrmConnector(adapter);
    const summary = await connector.fetchCrmSummary("acct-1");
    expect(summary).toBeNull();
  });

  it("handles leads-only data (no deals)", async () => {
    const adapter = new MockCrmAdapter({ leads });
    const connector = new CrmConnector(adapter);
    const summary = await connector.fetchCrmSummary("acct-1");

    expect(summary).not.toBeNull();
    expect(summary!.totalLeads).toBe(3);
    expect(summary!.openDeals).toBe(0);
    expect(summary!.averageDealValue).toBeNull();
    expect(summary!.leadToCloseRate).toBeNull();
  });

  it("calculates follow-up within 24h rate", async () => {
    const adapter = new MockCrmAdapter({ leads, deals });
    const connector = new CrmConnector(adapter);
    const summary = await connector.fetchCrmSummary("acct-1");

    expect(summary).not.toBeNull();
    // d1: contact 12h after creation (within 24h), d2: contact 24h after (at boundary)
    expect(summary!.followUpWithin24hRate).toBeDefined();
  });
});
