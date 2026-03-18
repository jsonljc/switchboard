import { describe, it, expect, vi } from "vitest";
import { HubSpotConnectorAdapter } from "../connectors/hubspot-adapter.js";
import { createEventEnvelope } from "../events.js";

function mockCrmProvider() {
  return {
    searchContacts: vi.fn().mockResolvedValue([]),
    getContact: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    listDeals: vi.fn().mockResolvedValue([]),
    listActivities: vi.fn().mockResolvedValue([]),
    getPipelineStatus: vi.fn().mockResolvedValue([]),
    createContact: vi.fn().mockResolvedValue({
      id: "hs-c1",
      externalId: null,
      channel: null,
      email: "test@example.com",
      firstName: "Test",
      lastName: null,
      company: null,
      phone: null,
      tags: [],
      status: "active",
      assignedStaffId: null,
      sourceAdId: null,
      sourceCampaignId: null,
      gclid: null,
      fbclid: null,
      ttclid: null,
      normalizedPhone: null,
      normalizedEmail: null,
      utmSource: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      properties: {},
    }),
    updateContact: vi.fn().mockResolvedValue({ id: "hs-c1" }),
    archiveContact: vi.fn(),
    createDeal: vi.fn().mockResolvedValue({
      id: "hs-d1",
      name: "Lead c1",
      stage: "qualified",
      pipeline: "default",
      amount: null,
      closeDate: null,
      contactIds: ["c1"],
      assignedStaffId: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      properties: {},
    }),
    archiveDeal: vi.fn(),
    logActivity: vi.fn().mockResolvedValue({
      id: "hs-a1",
      type: "note",
      subject: "test",
      body: null,
      contactIds: [],
      dealIds: [],
      createdAt: "2026-01-01",
    }),
    healthCheck: vi.fn().mockResolvedValue({ connected: true }),
  };
}

describe("HubSpotConnectorAdapter", () => {
  it("creates a contact on lead.received", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId: "c1",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        phone: "+60123456789",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
      }),
    );
  });

  it("creates a deal on lead.qualified", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId: "c1",
        score: 85,
        tier: "hot",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("c1"),
        stage: "qualified",
        contactIds: ["c1"],
      }),
    );
  });

  it("logs activity on revenue.recorded", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "conversion-bus-bridge" },
      payload: {
        contactId: "c1",
        amount: 350,
        type: "purchased",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "note",
        contactIds: ["c1"],
      }),
    );
  });

  it("logs activity on stage.advanced", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: {
        contactId: "c1",
        stage: "booked",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "note",
        contactIds: ["c1"],
        subject: expect.stringContaining("booked"),
      }),
    );
  });

  it("returns failure for unsupported events", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {},
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(false);
    expect(result.error).toContain("unsupported");
  });

  it("returns failure when CRM call throws", async () => {
    const crm = mockCrmProvider();
    crm.createContact.mockRejectedValue(new Error("HubSpot 429"));
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1", email: "test@example.com" },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(false);
    expect(result.error).toBe("HubSpot 429");
  });

  it("declares correct connector type and supported events", () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    expect(adapter.connectorType).toBe("hubspot");
    expect(adapter.supportedEvents).toContain("lead.received");
    expect(adapter.supportedEvents).toContain("lead.qualified");
    expect(adapter.supportedEvents).toContain("revenue.recorded");
    expect(adapter.supportedEvents).toContain("stage.advanced");
  });
});
