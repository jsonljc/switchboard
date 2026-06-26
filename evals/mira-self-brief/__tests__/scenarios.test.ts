import { describe, expect, it } from "vitest";
import { loadSkill, interpolate } from "@switchboard/core/skill-runtime";
import { SCENARIOS, REQUIRED_MIRA_PARAM_KEYS, corpusHash } from "../scenarios.js";
import { MiraScenarioSchema } from "../schema.js";

// The real Mira skill pack (skills/mira/SKILL.md). From this test file:
// __tests__ -> mira-self-brief -> evals -> repo root, then /skills.
const SKILLS_DIR = new URL("../../../skills", import.meta.url).pathname;

describe("mira-self-brief scenarios corpus", () => {
  it("every scenario parses against MiraScenarioSchema", () => {
    for (const s of SCENARIOS) {
      const r = MiraScenarioSchema.safeParse(s);
      expect(r.success, `scenario "${s.id}": ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("has at least six golden scenarios with unique ids", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(6);
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each scenario carries exactly the required Mira parameter keys", () => {
    for (const s of SCENARIOS) {
      expect(Object.keys(s.params).sort(), `scenario "${s.id}"`).toEqual(
        [...REQUIRED_MIRA_PARAM_KEYS].sort(),
      );
    }
  });

  it("corpusHash is stable and non-empty", () => {
    expect(corpusHash()).toBe(corpusHash());
    expect(corpusHash().length).toBeGreaterThan(0);
  });
});

describe("faithfulness to the real skills/mira/SKILL.md", () => {
  it("REQUIRED_MIRA_PARAM_KEYS equals the skill's declared parameters", () => {
    // If the real skill adds/removes a parameter, the goldens must follow or the
    // prompt renders a literal {{TOKEN}}. This binds the corpus to the real contract.
    const skill = loadSkill("mira", SKILLS_DIR);
    const declared = skill.parameters.map((p) => p.name).sort();
    expect([...REQUIRED_MIRA_PARAM_KEYS].sort()).toEqual(declared);
  });

  it("every scenario fully renders the real skill body with no leftover tokens", () => {
    // Drives the REAL interpolate over the REAL skill body — proves each golden's
    // params satisfy every {{TOKEN}} the production prompt references.
    const skill = loadSkill("mira", SKILLS_DIR);
    for (const s of SCENARIOS) {
      const rendered = interpolate(skill.body, s.params, skill.parameters);
      expect(rendered, `scenario "${s.id}" left an unresolved token`).not.toMatch(
        /\{\{[A-Z_]+\}\}/,
      );
      // The business name always renders into the heading.
      expect(rendered).toContain(s.params.BUSINESS_NAME);
    }
  });
});
