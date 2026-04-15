import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkill } from "./skill-loader.js";
import { SkillParseError, SkillValidationError } from "./types.js";

const TEST_DIR = join(import.meta.dirname, "__test_skills__");

function writeSkill(slug: string, content: string): void {
  writeFileSync(join(TEST_DIR, `${slug}.md`), content);
}

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("loadSkill", () => {
  it("loads a valid skill file", () => {
    writeSkill(
      "valid",
      `---
name: test-skill
slug: valid
version: 1.0.0
description: A test skill
author: test
parameters:
  - name: FOO
    type: string
    required: true
tools: []
---
Hello {{FOO}}`,
    );
    const skill = loadSkill("valid", TEST_DIR);
    expect(skill.name).toBe("test-skill");
    expect(skill.slug).toBe("valid");
    expect(skill.body).toContain("Hello {{FOO}}");
    expect(skill.parameters).toHaveLength(1);
  });

  it("throws SkillParseError for malformed YAML", () => {
    writeSkill(
      "bad-yaml",
      `---
name: [invalid yaml
---
body`,
    );
    expect(() => loadSkill("bad-yaml", TEST_DIR)).toThrow(SkillParseError);
  });

  it("throws SkillValidationError for missing slug", () => {
    writeSkill(
      "no-slug",
      `---
name: test
version: 1.0.0
description: test
author: test
parameters: []
tools: []
---
body`,
    );
    expect(() => loadSkill("no-slug", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for unknown parameter type", () => {
    writeSkill(
      "bad-type",
      `---
name: test
slug: bad-type
version: 1.0.0
description: test
author: test
parameters:
  - name: X
    type: map
    required: true
tools: []
---
body`,
    );
    expect(() => loadSkill("bad-type", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for enum without values", () => {
    writeSkill(
      "enum-no-vals",
      `---
name: test
slug: enum-no-vals
version: 1.0.0
description: test
author: test
parameters:
  - name: X
    type: enum
    required: true
tools: []
---
body`,
    );
    expect(() => loadSkill("enum-no-vals", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for object without schema", () => {
    writeSkill(
      "obj-no-schema",
      `---
name: test
slug: obj-no-schema
version: 1.0.0
description: test
author: test
parameters:
  - name: X
    type: object
    required: true
tools: []
---
body`,
    );
    expect(() => loadSkill("obj-no-schema", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for duplicate parameter names", () => {
    writeSkill(
      "dup-params",
      `---
name: test
slug: dup-params
version: 1.0.0
description: test
author: test
parameters:
  - name: X
    type: string
    required: true
  - name: X
    type: number
    required: false
tools: []
---
body`,
    );
    expect(() => loadSkill("dup-params", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for tool referenced in body but not declared", () => {
    writeSkill(
      "undeclared-tool",
      `---
name: test
slug: undeclared-tool
version: 1.0.0
description: test
author: test
parameters: []
tools:
  - crm-query
---
Use tool crm-write.stage.update to change stage`,
    );
    expect(() => loadSkill("undeclared-tool", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws SkillValidationError for empty body", () => {
    writeSkill(
      "empty-body",
      `---
name: test
slug: empty-body
version: 1.0.0
description: test
author: test
parameters: []
tools: []
---
`,
    );
    expect(() => loadSkill("empty-body", TEST_DIR)).toThrow(SkillValidationError);
  });

  it("throws for nonexistent skill slug", () => {
    expect(() => loadSkill("nonexistent", TEST_DIR)).toThrow();
  });

  it("loads a skill with output schema", () => {
    writeSkill(
      "with-output",
      `---
name: test
slug: with-output
version: 1.0.0
description: test
author: test
parameters: []
tools: []
output:
  fields:
    - name: summary
      type: string
      required: true
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
    - name: items
      type: array
      items: { type: string }
      required: false
---
Body here`,
    );
    const skill = loadSkill("with-output", TEST_DIR);
    expect(skill.output).toBeDefined();
    expect(skill.output!.fields).toHaveLength(3);
    expect(skill.output!.fields[0]!.name).toBe("summary");
    expect(skill.output!.fields[2]!.items).toEqual({ type: "string" });
  });

  it("loads a skill without output schema (optional)", () => {
    writeSkill(
      "no-output",
      `---
name: test
slug: no-output
version: 1.0.0
description: test
author: test
parameters: []
tools: []
---
Body`,
    );
    const skill = loadSkill("no-output", TEST_DIR);
    expect(skill.output).toBeUndefined();
  });
});

describe("loadSkill - real files", () => {
  it("loads the sales-pipeline skill file", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const skill = loadSkill("sales-pipeline", join(repoRoot, "skills"));
    expect(skill.slug).toBe("sales-pipeline");
    expect(skill.parameters).toHaveLength(5);
    expect(skill.tools).toEqual(["crm-query", "crm-write", "pipeline-handoff"]);
    expect(skill.body).toContain("Speed-to-Lead");
    expect(skill.body).toContain("Sales Closer");
    expect(skill.body).toContain("Nurture Specialist");
  });

  it("loads the website-profiler skill file", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const skill = loadSkill("website-profiler", join(repoRoot, "skills"));
    expect(skill.slug).toBe("website-profiler");
    expect(skill.tools).toEqual(["web-scanner"]);
    expect(skill.output).toBeDefined();
    expect(skill.output!.fields.length).toBeGreaterThan(0);
  });
});
