import { describe, it, expect } from "vitest";

interface WizardData {
  businessName: string;
  vertical: string;
  services: string[];
  targetCustomer: string;
  pricingRange: string;
  bookingPlatform: string;
  bookingUrl: string;
  purchasedAgents: string[];
  tonePreset: string;
  language: string;
}

function buildWizardKnowledgeContent(data: WizardData): string {
  const lines = [
    `Business Name: ${data.businessName}`,
    `Vertical: ${data.vertical}`,
    `Services Offered: ${data.services.join(", ")}`,
    `Target Customer: ${data.targetCustomer}`,
    `Pricing Range: ${data.pricingRange}`,
    `Booking Platform: ${data.bookingPlatform}`,
    `Booking URL: ${data.bookingUrl}`,
  ];
  return lines.join("\n");
}

describe("Wizard Data Processing", () => {
  it("builds knowledge content from wizard data", () => {
    const data: WizardData = {
      businessName: "Acme Inc",
      vertical: "generic",
      services: ["Content Creation", "Social Media", "Design"],
      targetCustomer: "Series A/B SaaS companies",
      pricingRange: "$3000-$8000/mo",
      bookingPlatform: "calendly",
      bookingUrl: "https://calendly.com/acme",
      purchasedAgents: ["creative"],
      tonePreset: "warm-professional",
      language: "en",
    };

    const content = buildWizardKnowledgeContent(data);
    expect(content).toContain("Acme Inc");
    expect(content).toContain("generic");
    expect(content).toContain("Content Creation, Social Media, Design");
    expect(content).toContain("calendly.com/acme");
  });

  it("handles empty services array", () => {
    const data: WizardData = {
      businessName: "Test Biz",
      vertical: "generic",
      services: [],
      targetCustomer: "",
      pricingRange: "",
      bookingPlatform: "custom",
      bookingUrl: "https://example.com",
      purchasedAgents: ["creative"],
      tonePreset: "direct-efficient",
      language: "en",
    };

    const content = buildWizardKnowledgeContent(data);
    expect(content).toContain("Test Biz");
    expect(content).toContain("Services Offered: ");
  });
});
