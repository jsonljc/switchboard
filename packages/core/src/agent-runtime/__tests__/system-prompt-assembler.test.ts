import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../system-prompt-assembler.js";
import type { AgentPersona } from "@switchboard/schemas";

function makePersona(overrides?: Partial<AgentPersona>): AgentPersona {
  return {
    id: "p_1",
    organizationId: "org_1",
    businessName: "Bloom Flowers",
    businessType: "small_business",
    productService: "Wedding and event floral arrangements",
    valueProposition: "Handcrafted artisan bouquets using locally-sourced flowers",
    tone: "professional",
    qualificationCriteria: { description: "Planning a wedding or event, budget over $300" },
    disqualificationCriteria: {},
    bookingLink: "https://cal.com/bloom",
    escalationRules: {
      frustrated: true,
      askForPerson: true,
      mentionCompetitor: false,
    },
    customInstructions: "Never promise same-day delivery",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("assembleSystemPrompt", () => {
  it("includes business name and product info", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("Bloom Flowers");
    expect(prompt).toContain("Wedding and event floral arrangements");
    expect(prompt).toContain("Handcrafted artisan bouquets");
  });

  it("includes tone", () => {
    const prompt = assembleSystemPrompt(makePersona({ tone: "casual" }));
    expect(prompt).toContain("casual");
  });

  it("includes custom instructions when present", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("Never promise same-day delivery");
  });

  it("omits custom instructions section when null", () => {
    const prompt = assembleSystemPrompt(makePersona({ customInstructions: null }));
    expect(prompt).not.toContain("Additional instructions");
  });

  it("includes booking link when present", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("https://cal.com/bloom");
  });

  it("omits booking section when null", () => {
    const prompt = assembleSystemPrompt(makePersona({ bookingLink: null }));
    expect(prompt).not.toContain("Booking");
  });

  it("serializes qualification criteria from object", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("budget over $300");
  });

  it("handles empty qualification criteria", () => {
    const prompt = assembleSystemPrompt(makePersona({ qualificationCriteria: {} }));
    expect(prompt).toContain("best judgment");
  });

  it("serializes escalation rules — only enabled ones", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("frustrated");
    expect(prompt).toContain("askForPerson");
    expect(prompt).not.toContain("mentionCompetitor");
  });

  it("handles empty escalation rules", () => {
    const prompt = assembleSystemPrompt(makePersona({ escalationRules: {} }));
    expect(prompt).not.toContain("Hand off");
  });
});
