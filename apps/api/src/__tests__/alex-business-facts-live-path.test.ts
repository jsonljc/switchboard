/**
 * Production-path invariant: operator-written BusinessFacts reach Alex's prompt
 * through the REAL PrismaBusinessFactsStore (incl. safeParse) + the REAL alexBuilder
 * — the seam the alex-conversation eval bypasses.
 */
import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "@switchboard/core";
import { PrismaBusinessFactsStore } from "@switchboard/db";

const OPERATOR_FACTS = {
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [{ name: "Orchard", address: "391 Orchard Rd", parkingNotes: "Basement parking" }],
  openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
  services: [
    { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
  ],
  bookingPolicies: { advanceBookingDays: 60 },
  escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
  additionalFaqs: [],
};

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

describe("alex business-facts live path (production-path invariant)", () => {
  it("operator facts in BusinessConfig reach parameters.BUSINESS_FACTS via the real store", async () => {
    const stores = { ...baseStores, businessFactsStore: storeOver(OPERATOR_FACTS) };
    const result = await alexBuilder(ctx, config, stores as never);
    const bf = result.parameters.BUSINESS_FACTS as string;
    expect(bf).toContain("10:00");
    expect(bf).toContain("from $18/unit");
    expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
  });

  it("a malformed stored config degrades to empty BUSINESS_FACTS (no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stores = { ...baseStores, businessFactsStore: storeOver({ businessName: "X" }) };
    const result = await alexBuilder(ctx, config, stores as never);
    expect(result.parameters.BUSINESS_FACTS).toBe("");
    // proves the REAL store's degrade path runs end-to-end (not silently swallowed)
    expect(warn).toHaveBeenCalledWith(
      "[BusinessFacts] malformed BusinessConfig.config",
      expect.objectContaining({ organizationId: "org_1" }),
    );
    warn.mockRestore();
  });
});
