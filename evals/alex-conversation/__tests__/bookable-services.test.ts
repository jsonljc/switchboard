import { describe, it, expect } from "vitest";
import { loadSkill } from "@switchboard/core/skill-runtime";
import { resolveParameters, defaultSkillsDir } from "../run-conversation.js";
import { ConversationFixtureSchema } from "../schema.js";

// Deterministic: no ANTHROPIC_API_KEY, no DB. resolveParameters drives the REAL
// alexBuilder over the REAL PrismaPlaybookReader (mock Prisma), so this proves the
// production seam wires BOOKABLE_SERVICES from the playbook.

const skill = loadSkill("alex", defaultSkillsDir());

function fixture(playbook: "operator" | "absent") {
  return ConversationFixtureSchema.parse({
    id: `bookable-services-${playbook}`,
    vertical: "medspa",
    locale: "sg",
    scenario: "bookable services wiring",
    playbook,
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  });
}

describe("D3-1: eval harness wires BOOKABLE_SERVICES from the playbook", () => {
  it("the real alex SKILL.md carries the {{BOOKABLE_SERVICES}} token (loads without error)", () => {
    expect(skill.body).toContain("{{BOOKABLE_SERVICES}}");
  });

  it("playbook:operator -> Alex's prompt carries the canonical bookable service names", async () => {
    const params = await resolveParameters(skill, fixture("operator"));
    expect(params.BOOKABLE_SERVICES).toContain("- Botox");
    expect(params.BOOKABLE_SERVICES).toContain("- Dermal Filler");
    expect(params.BOOKABLE_SERVICES).toContain("- HydraFacial");
  });

  it("playbook:absent (default) -> BOOKABLE_SERVICES is '' (free-text fallback)", async () => {
    const params = await resolveParameters(skill, fixture("absent"));
    expect(params.BOOKABLE_SERVICES).toBe("");
  });
});
