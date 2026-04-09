import { describe, it, expect } from "vitest";
import { AgentPersonaSchema, PersonaTone } from "../agent-persona.js";

describe("AgentPersonaSchema", () => {
  const valid = {
    id: "persona_1",
    organizationId: "org_1",
    businessName: "Acme Corp",
    businessType: "SaaS",
    productService: "Project management software",
    valueProposition: "Ship faster with less overhead",
    tone: "professional" as const,
    qualificationCriteria: { problemFit: true, timeline: "immediate" },
    disqualificationCriteria: { noCompetitor: true },
    escalationRules: { onFrustration: true, onCompetitorMention: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("parses a valid persona", () => {
    const result = AgentPersonaSchema.parse(valid);
    expect(result.businessName).toBe("Acme Corp");
    expect(result.tone).toBe("professional");
  });

  it("rejects invalid tone", () => {
    expect(() => AgentPersonaSchema.parse({ ...valid, tone: "aggressive" })).toThrow();
  });

  it("allows optional bookingLink and customInstructions", () => {
    const result = AgentPersonaSchema.parse({
      ...valid,
      bookingLink: "https://cal.com/acme",
      customInstructions: "Always mention free trial",
    });
    expect(result.bookingLink).toBe("https://cal.com/acme");
    expect(result.customInstructions).toBe("Always mention free trial");
  });

  it("defaults bookingLink and customInstructions to null", () => {
    const result = AgentPersonaSchema.parse(valid);
    expect(result.bookingLink).toBeNull();
    expect(result.customInstructions).toBeNull();
  });
});

describe("PersonaTone", () => {
  it("accepts valid tones", () => {
    expect(PersonaTone.parse("casual")).toBe("casual");
    expect(PersonaTone.parse("professional")).toBe("professional");
    expect(PersonaTone.parse("consultative")).toBe("consultative");
  });
});
