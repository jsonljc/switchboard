import { describe, it, expect } from "vitest";
import {
  ContactStageSchema,
  OpportunityStageSchema,
  ThreadStatusSchema,
  ContactSchema,
  OpportunitySchema,
  LifecycleRevenueEventSchema,
  OwnerTaskSchema,
} from "../lifecycle.js";

describe("ContactStageSchema", () => {
  it.each(["new", "active", "customer", "retained", "dormant"])("accepts %s", (stage) => {
    expect(ContactStageSchema.parse(stage)).toBe(stage);
  });

  it("rejects invalid stage", () => {
    expect(() => ContactStageSchema.parse("invalid")).toThrow();
  });
});

describe("OpportunityStageSchema", () => {
  it.each(["interested", "qualified", "quoted", "booked", "showed", "won", "lost", "nurturing"])(
    "accepts %s",
    (stage) => {
      expect(OpportunityStageSchema.parse(stage)).toBe(stage);
    },
  );
});

describe("ThreadStatusSchema", () => {
  it.each(["open", "waiting_on_customer", "waiting_on_business", "stale", "closed"])(
    "accepts %s",
    (status) => {
      expect(ThreadStatusSchema.parse(status)).toBe(status);
    },
  );
});

describe("ContactSchema", () => {
  it("validates a complete contact", () => {
    const contact = {
      id: "c-1",
      organizationId: "org-1",
      name: "Jason",
      phone: "+6591234567",
      email: null,
      primaryChannel: "whatsapp",
      firstTouchChannel: "whatsapp",
      stage: "new",
      source: "instagram_ad",
      attribution: {
        fbclid: "abc123",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp-1",
        sourceAdId: "ad-1",
        utmSource: "instagram",
        utmMedium: "paid",
        utmCampaign: "botox-promo",
      },
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => ContactSchema.parse(contact)).not.toThrow();
  });

  it("defaults stage to new", () => {
    const minimal = {
      id: "c-1",
      organizationId: "org-1",
      primaryChannel: "whatsapp",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = ContactSchema.parse(minimal);
    expect(result.stage).toBe("new");
  });

  it("accepts qualificationData on Contact", () => {
    const validContact = {
      id: "c-1",
      organizationId: "org-1",
      primaryChannel: "whatsapp",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contact = ContactSchema.parse({
      ...validContact,
      qualificationData: { problemFit: true, timeline: "immediate" },
    });
    expect(contact.qualificationData).toEqual({ problemFit: true, timeline: "immediate" });
  });

  it("defaults qualificationData to undefined", () => {
    const validContact = {
      id: "c-1",
      organizationId: "org-1",
      primaryChannel: "whatsapp",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contact = ContactSchema.parse(validContact);
    expect(contact.qualificationData).toBeUndefined();
  });
});

describe("OpportunitySchema", () => {
  it("validates a complete opportunity", () => {
    const opp = {
      id: "o-1",
      organizationId: "org-1",
      contactId: "c-1",
      serviceId: "svc-botox",
      serviceName: "Botox",
      stage: "interested",
      timeline: "immediate",
      priceReadiness: "ready",
      objections: [],
      qualificationComplete: false,
      estimatedValue: 50000,
      revenueTotal: 0,
      assignedAgent: "employee-a",
      assignedStaff: null,
      notes: null,
      openedAt: new Date(),
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => OpportunitySchema.parse(opp)).not.toThrow();
  });
});

describe("LifecycleRevenueEventSchema", () => {
  it("validates a revenue event", () => {
    const event = {
      id: "r-1",
      organizationId: "org-1",
      contactId: "c-1",
      opportunityId: "o-1",
      amount: 50000,
      currency: "SGD",
      type: "payment",
      status: "confirmed",
      recordedBy: "owner",
      externalReference: null,
      verified: false,
      sourceCampaignId: "camp-1",
      sourceAdId: null,
      recordedAt: new Date(),
      createdAt: new Date(),
    };
    expect(() => LifecycleRevenueEventSchema.parse(event)).not.toThrow();
  });
});

describe("OwnerTaskSchema", () => {
  it("validates an owner task", () => {
    const task = {
      id: "t-1",
      organizationId: "org-1",
      contactId: "c-1",
      opportunityId: "o-1",
      type: "fallback_handoff",
      title: "Follow up qualified lead",
      description: "Jason qualified for Botox — no Sales Closer active",
      suggestedAction: "Call within 24h",
      status: "pending",
      priority: "high",
      triggerReason: "no_sales_closer_active",
      sourceAgent: "employee-a",
      fallbackReason: "not_configured",
      dueAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
    };
    expect(() => OwnerTaskSchema.parse(task)).not.toThrow();
  });
});
