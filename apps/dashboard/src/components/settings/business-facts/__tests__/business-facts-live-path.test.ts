import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "@switchboard/core";
import { PrismaBusinessFactsStore } from "@switchboard/db";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { emptyBusinessFacts, serializeBusinessFacts } from "../scaffold";

function storeOver(config: unknown) {
  const prisma = {
    businessConfig: {
      findUnique: vi.fn().mockResolvedValue(config ? { organizationId: "org_1", config } : null),
    },
  };
  return new PrismaBusinessFactsStore(prisma as never);
}

const ctx = {
  persona: {
    businessName: "Glow Aesthetics",
    tone: "friendly",
    qualificationCriteria: {},
    disqualificationCriteria: {},
    escalationRules: {},
    bookingLink: "",
    customInstructions: "",
  },
} as never;
const baseStores = {
  opportunityStore: {
    findActiveByContact: vi
      .fn()
      .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
  },
  contactStore: { findById: vi.fn().mockResolvedValue({ name: "Sarah", source: "whatsapp" }) },
};
const config = { deploymentId: "dep_1", orgId: "org_1", contactId: "contact_1" };

describe("business-facts editor — production-path keystone", () => {
  it("form output is schema-valid and reaches BUSINESS_FACTS via the real builder", async () => {
    const filled = {
      ...emptyBusinessFacts(),
      businessName: "Glow Aesthetics",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      openingHours: {
        ...emptyBusinessFacts().openingHours,
        monday: { open: "10:00", close: "20:00", closed: false },
      },
      services: [
        { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
      ],
      bookingPolicies: { advanceBookingDays: 60 },
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
      additionalFaqs: [],
    };
    const facts = serializeBusinessFacts(filled);
    expect(BusinessFactsSchema.safeParse(facts).success).toBe(true);

    const stores = { ...baseStores, businessFactsStore: storeOver(facts) };
    const result = await alexBuilder(ctx, config, stores as never);
    const bf = result.parameters.BUSINESS_FACTS as string;
    expect(bf).toContain("10:00");
    expect(bf).toContain("from $18/unit");
    expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
  });
});
