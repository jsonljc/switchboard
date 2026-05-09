import { describe, expect, it } from "vitest";
import {
  ContactDetailProfileSchema,
  ContactDetailOpportunitySchema,
  ContactDetailThreadSchema,
  ContactDetailOpenDecisionSchema,
  ContactDetailRevenueEventSchema,
  ContactDetailResponseSchema,
} from "../contacts.js";

const profileFixture = {
  id: "c-1",
  displayName: "Maya Rahman",
  primaryChannel: "whatsapp" as const,
  stage: "active" as const,
  phone: "+6591234567",
  email: "maya@example.com",
  source: "ctwa",
  sourceType: "ctwa",
  attributionSummary: "ad set 'summer pricing v3'",
  messagingConsent: {
    optedIn: true,
    optedInAt: "2026-04-29T00:00:00Z",
    source: "organic_inbound",
    optedOutAt: null,
  },
  firstContactAt: "2026-04-27T00:00:00Z",
  lastActivityAt: "2026-05-09T00:00:00Z",
};

describe("ContactDetailProfileSchema", () => {
  it("parses a fully populated profile", () => {
    expect(() => ContactDetailProfileSchema.parse(profileFixture)).not.toThrow();
  });
  it("accepts null for optional string fields", () => {
    expect(() =>
      ContactDetailProfileSchema.parse({
        ...profileFixture,
        phone: null,
        email: null,
        source: null,
        sourceType: null,
        attributionSummary: null,
      }),
    ).not.toThrow();
  });
  it("rejects an invalid stage", () => {
    expect(() =>
      ContactDetailProfileSchema.parse({ ...profileFixture, stage: "banana" }),
    ).toThrow();
  });
  it("rejects an unknown primaryChannel", () => {
    expect(() =>
      ContactDetailProfileSchema.parse({ ...profileFixture, primaryChannel: "fax" }),
    ).toThrow();
  });
});

describe("ContactDetailOpportunitySchema", () => {
  it("accepts null estimatedValue and closedAt", () => {
    expect(() =>
      ContactDetailOpportunitySchema.parse({
        id: "o-1",
        serviceName: "Wedding day",
        stage: "interested",
        estimatedValue: null,
        openedAt: "2026-05-01T00:00:00Z",
        closedAt: null,
      }),
    ).not.toThrow();
  });
  it("rejects an invalid stage", () => {
    expect(() =>
      ContactDetailOpportunitySchema.parse({
        id: "o-1",
        serviceName: "Wedding day",
        stage: "banana",
        estimatedValue: null,
        openedAt: "2026-05-01T00:00:00Z",
        closedAt: null,
      }),
    ).toThrow();
  });
});

describe("ContactDetailThreadSchema", () => {
  it("parses a thread tile", () => {
    expect(() =>
      ContactDetailThreadSchema.parse({
        id: "t-1",
        assignedAgent: "alex",
        summary: "Following up on quote.",
        lastMessageAt: "2026-05-09T00:00:00Z",
      }),
    ).not.toThrow();
  });
  it("accepts null lastMessageAt", () => {
    expect(() =>
      ContactDetailThreadSchema.parse({
        id: "t-1",
        assignedAgent: "alex",
        summary: "",
        lastMessageAt: null,
      }),
    ).not.toThrow();
  });
});

describe("ContactDetailOpenDecisionSchema", () => {
  it("accepts both kinds", () => {
    for (const kind of ["approval", "handoff"] as const) {
      expect(() =>
        ContactDetailOpenDecisionSchema.parse({
          id: "d-1",
          kind,
          agentKey: "alex",
          title: "Approve quote draft",
          createdAt: "2026-05-09T00:00:00Z",
        }),
      ).not.toThrow();
    }
  });
  it("rejects an unknown kind", () => {
    expect(() =>
      ContactDetailOpenDecisionSchema.parse({
        id: "d-1",
        kind: "rejection",
        agentKey: null,
        title: "x",
        createdAt: "2026-05-09T00:00:00Z",
      }),
    ).toThrow();
  });
});

describe("ContactDetailRevenueEventSchema", () => {
  it("parses a revenue event", () => {
    expect(() =>
      ContactDetailRevenueEventSchema.parse({
        id: "r-1",
        amount: 1200,
        currency: "SGD",
        type: "payment",
        status: "confirmed",
        recordedAt: "2026-05-09T00:00:00Z",
      }),
    ).not.toThrow();
  });
});

describe("ContactDetailResponseSchema", () => {
  it("composes all five sections", () => {
    expect(() =>
      ContactDetailResponseSchema.parse({
        profile: profileFixture,
        opportunities: [],
        threads: [],
        openDecisions: [],
        revenueEvents: [],
      }),
    ).not.toThrow();
  });
});
