import { describe, it, expect, vi } from "vitest";
import { classifyBusinessFacts } from "@switchboard/db";
import { loadSkill } from "@switchboard/core/skill-runtime";
import { createBusinessFactsStore, createStubBusinessFacts } from "../stub-context-store.js";
import { resolveParameters, defaultSkillsDir } from "../run-conversation.js";
import type { ConversationFixture } from "../schema.js";

describe("createBusinessFactsStore (real PrismaBusinessFactsStore over mock Prisma)", () => {
  it("operator config → present facts (the canonical blob round-trips, render unchanged)", async () => {
    const blob = createStubBusinessFacts();
    const classified = classifyBusinessFacts(blob);
    expect(classified.status).toBe("present");
    expect(classified.facts).toEqual(blob);

    const store = createBusinessFactsStore(blob);
    await expect(store.get("eval-org")).resolves.toEqual(blob);
  });

  it("absent config (no row) → null", async () => {
    const store = createBusinessFactsStore(null);
    await expect(store.get("eval-org")).resolves.toBeNull();
  });

  it("malformed config → null + a warn (degrade, no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createBusinessFactsStore({ businessName: "X" });
    await expect(store.get("eval-org")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[BusinessFacts] malformed BusinessConfig.config",
      expect.objectContaining({ organizationId: "eval-org" }),
    );
    warn.mockRestore();
  });
});

const SKILL = loadSkill("alex", defaultSkillsDir());

function fixture(businessFacts: "operator" | "absent"): ConversationFixture {
  return {
    id: `bf-${businessFacts}`,
    vertical: "medspa",
    locale: "sg",
    scenario: "faithfulness probe",
    businessFacts,
    turns: [
      { role: "lead", content: "what are your prices?" },
      { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
    ],
  };
}

describe("resolveParameters — production-path faithfulness (the gate)", () => {
  it("operator facts reach BUSINESS_FACTS via the BUILDER seam", async () => {
    const params = await resolveParameters(SKILL, fixture("operator"));
    const bf = params.BUSINESS_FACTS as string;
    expect(bf).toContain("Acme Medspa");
    expect(bf).toContain("10:00");
    expect(bf).toContain("Consultation");
  });

  it("ABSENT facts ⇒ empty BUSINESS_FACTS (escalate, no fabrication, no throw)", async () => {
    const params = await resolveParameters(SKILL, fixture("absent"));
    expect(params.BUSINESS_FACTS).toBe("");
  });

  it("persona flows through the real resolvePersona (PERSONA_CONFIG + BUSINESS_NAME)", async () => {
    const params = await resolveParameters(SKILL, fixture("operator"));
    expect(params.BUSINESS_NAME).toBe("Acme Medspa");
    expect(params.PERSONA_CONFIG).toMatchObject({
      tone: "consultative",
      qualificationCriteria: {
        treatmentInterest: "Which treatment or concern brought them in",
        timeline: "How soon they want to start",
      },
      escalationRules: {
        medicalAdvice: "Escalate any request for diagnosis or medical advice",
        pricingDispute: "Escalate hard pricing negotiations",
      },
      bookingLink: "https://example.com/book",
      customInstructions: expect.stringContaining("Locale: sg"),
    });
  });
});
