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
      businessName: "Glow Med Spa",
      vertical: "clinic",
      services: ["Botox", "Fillers", "Facials"],
      targetCustomer: "Women 25-45",
      pricingRange: "$200-$800",
      bookingPlatform: "calendly",
      bookingUrl: "https://calendly.com/glow-spa",
      purchasedAgents: ["lead-responder", "sales-closer"],
      tonePreset: "warm-professional",
      language: "en",
    };

    const content = buildWizardKnowledgeContent(data);
    expect(content).toContain("Glow Med Spa");
    expect(content).toContain("clinic");
    expect(content).toContain("Botox, Fillers, Facials");
    expect(content).toContain("calendly.com/glow-spa");
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
      purchasedAgents: ["lead-responder"],
      tonePreset: "direct-efficient",
      language: "en",
    };

    const content = buildWizardKnowledgeContent(data);
    expect(content).toContain("Test Biz");
    expect(content).toContain("Services Offered: ");
  });
});
