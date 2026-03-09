import { describe, it, expect } from "vitest";
import { buildMinimalProfile } from "../profile-builder.js";

describe("buildMinimalProfile", () => {
  it("builds a valid profile for clinic skin", () => {
    const profile = buildMinimalProfile({
      orgId: "org_1",
      businessName: "Bright Smiles Dental",
      skinId: "clinic",
      timezone: "America/New_York",
    });

    expect(profile.id).toBe("auto_org_1");
    expect(profile.name).toBe("Bright Smiles Dental");
    expect(profile.business.name).toBe("Bright Smiles Dental");
    expect(profile.business.type).toBe("healthcare");
    expect(profile.business.timezone).toBe("America/New_York");
    expect(profile.services.catalog.length).toBeGreaterThan(0);
    expect(profile.journey.stages.length).toBe(3);
    expect(profile.journey.primaryKPI).toBe("appointments_booked");
  });

  it("builds a valid profile for commerce skin", () => {
    const profile = buildMinimalProfile({
      orgId: "org_2",
      businessName: "Style Shop",
      skinId: "commerce",
    });

    expect(profile.business.type).toBe("ecommerce");
    expect(profile.journey.primaryKPI).toBe("purchases");
    expect(profile.services.catalog.some((s) => s.category === "Retail")).toBe(true);
  });

  it("builds a valid profile for gym skin", () => {
    const profile = buildMinimalProfile({
      orgId: "org_3",
      businessName: "Peak Fitness",
      skinId: "gym",
    });

    expect(profile.business.type).toBe("fitness");
    expect(profile.journey.primaryKPI).toBe("memberships_sold");
  });

  it("falls back to generic for unknown skin", () => {
    const profile = buildMinimalProfile({
      orgId: "org_4",
      businessName: "My Biz",
      skinId: "unknown_skin_type",
    });

    expect(profile.business.type).toBe("general_business");
    expect(profile.journey.primaryKPI).toBe("leads_generated");
  });

  it("has required schema fields", () => {
    const profile = buildMinimalProfile({
      orgId: "org_5",
      businessName: "Test Biz",
      skinId: "generic",
    });

    // All required fields per BusinessProfileSchema
    expect(profile.id).toBeTruthy();
    expect(profile.name).toBeTruthy();
    expect(profile.version).toBeTruthy();
    expect(profile.business.name).toBeTruthy();
    expect(profile.business.type).toBeTruthy();
    expect(profile.services.catalog.length).toBeGreaterThanOrEqual(1);
    expect(profile.journey.stages.length).toBeGreaterThanOrEqual(1);
    expect(profile.journey.primaryKPI).toBeTruthy();
  });

  it("resolves through ProfileResolver without errors", async () => {
    const { ProfileResolver } = await import("../../profile/resolver.js");
    const profile = buildMinimalProfile({
      orgId: "org_6",
      businessName: "Resolve Test",
      skinId: "clinic",
      timezone: "UTC",
    });

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve(profile);

    expect(resolved.profile).toBe(profile);
    expect(resolved.systemPromptFragment).toContain("Resolve Test");
    expect(resolved.systemPromptFragment).toContain("healthcare");
    expect(resolved.scoring).toBeDefined();
    expect(resolved.compliance).toBeDefined();
  });
});
