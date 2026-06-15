import { describe, expect, it } from "vitest";
import { loadSkill } from "./skill-loader.js";

// Boot-safety test for the REAL skills/mira/SKILL.md (slice-4 spec 3.2):
// bootstrap loads this file at API startup, so a malformed frontmatter or a
// dotted-triple body token (the validateToolReferences trap) would break boot.
// This test fails it at unit-test time instead.
const SKILLS_DIR = new URL("../../../../skills", import.meta.url).pathname;

describe("skills/mira/SKILL.md (real file)", () => {
  it("loads, with the runtime slug and compose intent", () => {
    const skill = loadSkill("mira", SKILLS_DIR);
    expect(skill.name).toBe("Mira");
    // Frontmatter slug is the RUNTIME identity (= deployment skillSlug);
    // the directory is the product identity (spec 3.2).
    expect(skill.slug).toBe("creative");
    expect(skill.intent).toBe("creative.brief.compose");
    expect(skill.tools).toEqual([]);
    expect(skill.context).toEqual([]);
  });

  it("declares every parameter the builder supplies", () => {
    const skill = loadSkill("mira", SKILLS_DIR);
    const names = skill.parameters.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        "BUSINESS_FACTS",
        "BUSINESS_NAME",
        "CURRENT_DATETIME",
        "FRONTLINE_CONVERSION_CONTEXT",
        "PERFORMANCE_CONTEXT",
        "PIPELINE_STATE",
        "TASTE_CONTEXT",
        "TRIGGER_CONTEXT",
      ].sort(),
    );
  });

  it("keeps the body free of dotted-triple tokens (loader trap)", () => {
    // loadSkill itself throws on a violation (validateToolReferences), so
    // loading without throw IS the assertion; this test names the trap for
    // future editors of the skill body.
    expect(() => loadSkill("mira", SKILLS_DIR)).not.toThrow();
  });
});
