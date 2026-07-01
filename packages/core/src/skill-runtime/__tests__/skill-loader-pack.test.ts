import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkill } from "../skill-loader.js";
import { SkillValidationError } from "../types.js";

let skillsDir: string;

const frontmatter = (pack?: string) =>
  `---\nname: t\nslug: t\nversion: 1.0.0\ndescription: d\nauthor: a\n${
    pack ? `pack: ${pack}\n` : ""
  }parameters: []\ntools: []\n---\n`;

beforeAll(() => {
  skillsDir = mkdtempSync(join(tmpdir(), "skill-loader-pack-"));

  // declares pack:kit + a body marker + the pack file present -> splices
  mkdirSync(join(skillsDir, "composed", "packs", "kit"), { recursive: true });
  writeFileSync(
    join(skillsDir, "composed", "SKILL.md"),
    frontmatter("kit") + "Body start.\n\n<!-- @pack:block -->\n\nBody end.\n",
  );
  writeFileSync(join(skillsDir, "composed", "packs", "kit", "block.md"), "SPLICED CONTENT\n");

  // no marker at all -> unchanged
  mkdirSync(join(skillsDir, "plain"), { recursive: true });
  writeFileSync(join(skillsDir, "plain", "SKILL.md"), frontmatter() + "Just a body, no markers.\n");

  // orphan marker: a marker but NO pack declared -> fail-closed
  mkdirSync(join(skillsDir, "orphan"), { recursive: true });
  writeFileSync(
    join(skillsDir, "orphan", "SKILL.md"),
    frontmatter() + "x\n\n<!-- @pack:block -->\n\ny\n",
  );

  // pack declared but the referenced file is absent -> fail-closed
  mkdirSync(join(skillsDir, "missing", "packs", "kit"), { recursive: true });
  writeFileSync(
    join(skillsDir, "missing", "SKILL.md"),
    frontmatter("kit") + "x\n\n<!-- @pack:absent -->\n\ny\n",
  );
});
afterAll(() => rmSync(skillsDir, { recursive: true, force: true }));

describe("loadSkill pack composition (wiring)", () => {
  it("splices the declared pack block into the skeleton body", () => {
    const skill = loadSkill("composed", skillsDir);
    expect(skill.body).toContain("SPLICED CONTENT");
    expect(skill.body).not.toContain("@pack:block");
  });

  it("leaves a marker-less skill body unchanged", () => {
    const skill = loadSkill("plain", skillsDir);
    expect(skill.body).toBe("Just a body, no markers.");
  });

  it("throws (fail-closed) on an orphan marker with no pack declared", () => {
    expect(() => loadSkill("orphan", skillsDir)).toThrow(SkillValidationError);
  });

  it("throws (fail-closed) when the declared pack file is missing", () => {
    expect(() => loadSkill("missing", skillsDir)).toThrow(/absent/);
  });
});
