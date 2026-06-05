import { describe, it, expect } from "vitest";
import type { BusinessFacts } from "@switchboard/schemas";
import { synthesizeCreativeBrief } from "../creative-brief-synthesis.js";

function facts(overrides: Partial<BusinessFacts> = {}): BusinessFacts {
  return {
    businessName: "Glow Aesthetics",
    timezone: "Asia/Singapore",
    locations: [{ name: "Orchard", address: "1 Orchard Rd" }],
    openingHours: {},
    services: [
      {
        name: "Botox",
        description: "Anti-wrinkle injections",
        currency: "SGD",
        idealFor: "Women 30-45, anti-aging curious",
      },
      { name: "HydraFacial", description: "Deep-cleanse facial", currency: "SGD" },
    ],
    escalationContact: { name: "Front desk", channel: "whatsapp", address: "+65" },
    additionalFaqs: [],
    ...overrides,
  };
}

describe("synthesizeCreativeBrief", () => {
  it("derives a product description from the business name + service names", () => {
    const brief = synthesizeCreativeBrief(facts());
    expect(brief.productDescription).toContain("Glow Aesthetics");
    expect(brief.productDescription).toContain("Botox");
    expect(brief.productDescription).toContain("HydraFacial");
  });

  it("uses the first service idealFor as the target audience when present", () => {
    const brief = synthesizeCreativeBrief(facts());
    expect(brief.targetAudience).toBe("Women 30-45, anti-aging curious");
  });

  it("falls back to a medspa-vertical audience when no service has idealFor", () => {
    const brief = synthesizeCreativeBrief(
      facts({ services: [{ name: "Botox", description: "x", currency: "SGD" }] }),
    );
    expect(brief.targetAudience.length).toBeGreaterThan(0);
    expect(brief.targetAudience).not.toBe("");
  });

  it("returns a non-empty brief when BusinessFacts is absent (null)", () => {
    const brief = synthesizeCreativeBrief(null);
    // CreativeConceptDraftInput requires .min(1) on both fields or the handoff
    // fails INVALID_HANDOFF post-approval — the synthesizer must never emit empty.
    expect(brief.productDescription.length).toBeGreaterThan(0);
    expect(brief.targetAudience.length).toBeGreaterThan(0);
  });

  it("never emits an empty field even when the business name is whitespace-thin", () => {
    // services has min(1) name in the schema, but defense-in-depth: empty names
    // must not collapse the product description to an empty string.
    const brief = synthesizeCreativeBrief(facts({ businessName: "Clinic" }));
    expect(brief.productDescription.trim().length).toBeGreaterThan(0);
    expect(brief.targetAudience.trim().length).toBeGreaterThan(0);
  });
});
