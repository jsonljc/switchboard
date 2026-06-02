/**
 * Production-path invariant: exercises resolvePersona -> PERSONA_CONFIG -> interpolate,
 * the live seam the alex-conversation eval bypasses (run-conversation.ts:174).
 *
 * The seeded Alex deployment (packages/db/prisma/seed-marketplace.ts:639-657) stores
 * qualificationCriteria/disqualificationCriteria/escalationRules as OBJECTS. This test
 * confirms the full chain does NOT throw and renders object content into the prompt.
 */

import { describe, it, expect } from "vitest";
import { resolvePersona } from "@switchboard/schemas";
import { interpolate } from "../template-engine.js";
import type { ParameterDeclaration } from "../types.js";

// Exact shape from seed-marketplace.ts:639-657
const SEEDED_INPUT_CONFIG = {
  businessName: "Glow Aesthetics",
  businessType: "aesthetics_clinic",
  tone: "friendly",
  bookingLink: "https://cal.com/glow-aesthetics",
  qualificationCriteria: {
    ageRequirement: "21+",
    noContraindications: true,
  },
  disqualificationCriteria: {
    underage: true,
    activeInfection: true,
  },
  escalationRules: {
    medicalQuestions: true,
    pricingNegotiation: true,
    complaints: true,
  },
};

describe("alex persona live path (production-path invariant)", () => {
  it("resolvePersona preserves object-shaped criteria from the seeded inputConfig", () => {
    const persona = resolvePersona(SEEDED_INPUT_CONFIG);
    expect(persona).toBeDefined();
    expect(persona?.qualificationCriteria).toEqual({
      ageRequirement: "21+",
      noContraindications: true,
    });
    expect(persona?.disqualificationCriteria).toEqual({
      underage: true,
      activeInfection: true,
    });
    expect(persona?.escalationRules).toEqual({
      medicalQuestions: true,
      pricingNegotiation: true,
      complaints: true,
    });
  });

  it("PERSONA_CONFIG built from resolved persona interpolates without throwing", () => {
    const persona = resolvePersona(SEEDED_INPUT_CONFIG)!;

    // Mirrors builders/alex.ts:131-138
    const PERSONA_CONFIG = {
      tone: persona.tone,
      qualificationCriteria: persona.qualificationCriteria,
      disqualificationCriteria: persona.disqualificationCriteria,
      escalationRules: persona.escalationRules,
      bookingLink: persona.bookingLink ?? "",
      customInstructions: persona.customInstructions ?? "",
    };

    const personaConfigDecl: ParameterDeclaration = {
      name: "PERSONA_CONFIG",
      type: "object",
      required: true,
    };

    const fragment =
      "qual: {{PERSONA_CONFIG.qualificationCriteria}}\ndisqual: {{PERSONA_CONFIG.disqualificationCriteria}}\nescalation: {{PERSONA_CONFIG.escalationRules}}";

    let result: string;
    // The key invariant: must NOT throw SkillParameterError
    expect(() => {
      result = interpolate(fragment, { PERSONA_CONFIG }, [personaConfigDecl]);
    }).not.toThrow();

    result = interpolate(fragment, { PERSONA_CONFIG }, [personaConfigDecl]);

    // Object content should appear in the rendered prompt
    expect(result).toContain("ageRequirement");
    expect(result).toContain("medicalQuestions");
  });
});
