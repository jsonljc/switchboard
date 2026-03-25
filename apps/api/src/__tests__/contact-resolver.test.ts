// apps/api/src/__tests__/contact-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactResolver } from "../bootstrap/contact-resolver.js";

function makeMockLifecycleService() {
  return {
    findContactByPhone: vi.fn().mockResolvedValue(null),
    createContact: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: "contact-uuid-1",
      organizationId: input.organizationId,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: null,
      primaryChannel: input.primaryChannel ?? "whatsapp",
      stage: "new",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    createOpportunity: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: "opp-uuid-1",
      organizationId: input.organizationId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      stage: "interested",
      objections: [],
      qualificationComplete: false,
      revenueTotal: 0,
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getContactWithOpportunities: vi.fn().mockResolvedValue(null),
  };
}

describe("ContactResolver", () => {
  let service: ReturnType<typeof makeMockLifecycleService>;
  let resolver: ContactResolver;

  beforeEach(() => {
    service = makeMockLifecycleService();
    resolver = new ContactResolver(service as never);
  });

  describe("resolveForMessage", () => {
    it("creates new Contact and Opportunity on first touch", async () => {
      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(true);
      expect(result.contact.id).toBe("contact-uuid-1");
      expect(result.opportunity.stage).toBe("interested");
      expect(service.findContactByPhone).toHaveBeenCalledWith("org-1", "+6591234567");
      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          phone: "+6591234567",
          primaryChannel: "whatsapp",
        }),
      );
      expect(service.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          contactId: "contact-uuid-1",
          serviceId: "general-inquiry",
          serviceName: "General Inquiry",
          assignedAgent: "lead-responder",
        }),
      );
    });

    it("returns existing Contact and active Opportunity for returning lead", async () => {
      const existingContact = {
        id: "contact-existing",
        organizationId: "org-1",
        phone: "+6591234567",
        stage: "active",
      };
      const existingOpp = {
        id: "opp-existing",
        contactId: "contact-existing",
        stage: "qualified",
      };
      service.findContactByPhone.mockResolvedValue(existingContact);
      service.getContactWithOpportunities.mockResolvedValue({
        contact: existingContact,
        opportunities: [existingOpp],
      });

      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(false);
      expect(result.contact.id).toBe("contact-existing");
      expect(result.opportunity.id).toBe("opp-existing");
      expect(result.opportunity.stage).toBe("qualified");
      expect(service.createContact).not.toHaveBeenCalled();
      expect(service.createOpportunity).not.toHaveBeenCalled();
    });

    it("creates new Opportunity if existing Contact has no active opportunities", async () => {
      const existingContact = {
        id: "contact-existing",
        organizationId: "org-1",
        phone: "+6591234567",
        stage: "customer",
      };
      service.findContactByPhone.mockResolvedValue(existingContact);
      service.getContactWithOpportunities.mockResolvedValue({
        contact: existingContact,
        opportunities: [
          { id: "opp-old", stage: "won" },
          { id: "opp-lost", stage: "lost" },
        ],
      });

      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(false);
      expect(result.contact.id).toBe("contact-existing");
      expect(service.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: "contact-existing" }),
      );
    });

    it("passes attribution metadata when provided", async () => {
      await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
        attribution: { fbclid: "abc123", utmSource: "facebook" },
      });

      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { fbclid: "abc123", utmSource: "facebook" },
          source: "facebook",
        }),
      );
    });

    it("uses telegram as primaryChannel for telegram messages", async () => {
      await resolver.resolveForMessage({
        channelContactId: "tg-12345",
        channel: "telegram",
        organizationId: "org-1",
      });

      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({ primaryChannel: "telegram" }),
      );
    });
  });
});

describe("ContactResolver edge cases", () => {
  let service: ReturnType<typeof makeMockLifecycleService>;
  let resolver: ContactResolver;

  beforeEach(() => {
    service = makeMockLifecycleService();
    resolver = new ContactResolver(service as never);
  });

  it("picks most recent non-terminal opportunity when multiple exist", async () => {
    const existingContact = {
      id: "contact-1",
      organizationId: "org-1",
      phone: "+6591234567",
      stage: "active",
    };
    service.findContactByPhone.mockResolvedValue(existingContact);
    service.getContactWithOpportunities.mockResolvedValue({
      contact: existingContact,
      opportunities: [
        { id: "opp-won", stage: "won", closedAt: new Date() },
        { id: "opp-active", stage: "quoted" },
        { id: "opp-lost", stage: "lost", closedAt: new Date() },
      ],
    });

    const result = await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
    });

    expect(result.opportunity.id).toBe("opp-active");
    expect(service.createOpportunity).not.toHaveBeenCalled();
  });

  it("treats nurturing stage as active (not terminal)", async () => {
    const existingContact = {
      id: "contact-1",
      organizationId: "org-1",
      phone: "+6591234567",
      stage: "active",
    };
    service.findContactByPhone.mockResolvedValue(existingContact);
    service.getContactWithOpportunities.mockResolvedValue({
      contact: existingContact,
      opportunities: [{ id: "opp-nurture", stage: "nurturing" }],
    });

    const result = await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
    });

    expect(result.opportunity.id).toBe("opp-nurture");
    expect(service.createOpportunity).not.toHaveBeenCalled();
  });

  it("handles dashboard channel correctly", async () => {
    await resolver.resolveForMessage({
      channelContactId: "dashboard-user-1",
      channel: "dashboard",
      organizationId: "org-1",
    });

    expect(service.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ primaryChannel: "dashboard" }),
    );
  });

  it("does not set source when attribution has no utmSource", async () => {
    await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
      attribution: { fbclid: "abc123" },
    });

    expect(service.createContact).toHaveBeenCalledWith(expect.objectContaining({ source: null }));
  });
});
