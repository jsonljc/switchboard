import { describe, it, expect } from "vitest";
import { AgentPersonaConfigSchema, resolvePersona } from "../agent-persona-config.js";

describe("AgentPersonaConfigSchema", () => {
  it("validates a minimal persona", () => {
    expect(AgentPersonaConfigSchema.parse({ businessName: "Acme", tone: "professional" })).toEqual({
      businessName: "Acme",
      tone: "professional",
    });
  });

  it("accepts optional string-array fields", () => {
    expect(
      AgentPersonaConfigSchema.parse({
        businessName: "Acme",
        tone: "casual",
        qualificationCriteria: ["budget>1000"],
        escalationRules: ["after 3 fails"],
      }),
    ).toEqual({
      businessName: "Acme",
      tone: "casual",
      qualificationCriteria: ["budget>1000"],
      escalationRules: ["after 3 fails"],
    });
  });

  it("requires businessName + tone", () => {
    expect(() => AgentPersonaConfigSchema.parse({ tone: "professional" })).toThrow();
    expect(() => AgentPersonaConfigSchema.parse({ businessName: "Acme" })).toThrow();
  });
});

describe("resolvePersona", () => {
  it("returns undefined for null/undefined/non-object inputs", () => {
    expect(resolvePersona(null)).toBeUndefined();
    expect(resolvePersona(undefined)).toBeUndefined();
  });

  it("returns undefined when businessName is missing", () => {
    expect(resolvePersona({ tone: "professional" })).toBeUndefined();
  });

  it("returns undefined when businessName is non-string", () => {
    expect(resolvePersona({ businessName: 42 })).toBeUndefined();
  });

  it("defaults tone to 'professional' when missing", () => {
    expect(resolvePersona({ businessName: "Acme" })).toEqual({
      businessName: "Acme",
      tone: "professional",
      qualificationCriteria: undefined,
      disqualificationCriteria: undefined,
      escalationRules: undefined,
      bookingLink: undefined,
      customInstructions: undefined,
    });
  });

  it("preserves array criteria + string fields when supplied", () => {
    const result = resolvePersona({
      businessName: "Acme",
      tone: "casual",
      qualificationCriteria: ["budget>1000", "decision-maker"],
      disqualificationCriteria: ["competitor employee"],
      escalationRules: ["after 3 fails", "negative sentiment"],
      bookingLink: "https://cal.com/acme",
      customInstructions: "Be brief and direct.",
    });
    expect(result).toEqual({
      businessName: "Acme",
      tone: "casual",
      qualificationCriteria: ["budget>1000", "decision-maker"],
      disqualificationCriteria: ["competitor employee"],
      escalationRules: ["after 3 fails", "negative sentiment"],
      bookingLink: "https://cal.com/acme",
      customInstructions: "Be brief and direct.",
    });
  });

  it("omits non-array criteria fields", () => {
    const result = resolvePersona({
      businessName: "Acme",
      tone: "professional",
      qualificationCriteria: "not an array",
      bookingLink: 123,
    });
    expect(result?.qualificationCriteria).toBeUndefined();
    expect(result?.bookingLink).toBeUndefined();
  });
});
