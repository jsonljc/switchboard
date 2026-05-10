import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("context block parsing", () => {
  it("parses valid context block from frontmatter", () => {
    writeSkill(
      "test-with-context",
      `---
name: test-with-context
slug: test-with-context
version: 1.0.0
description: Test skill with context block
author: test
parameters: []
tools: []
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: knowledge
    scope: offer-catalog
    inject_as: KNOWLEDGE_CONTEXT
    required: false
---

Test body with {{PLAYBOOK_CONTEXT}} and {{KNOWLEDGE_CONTEXT}}.`,
    );
    const skill = loadSkill("test-with-context", TEST_DIR);
    expect(skill.context).toHaveLength(2);
    expect(skill.context[0]!.injectAs).toBe("PLAYBOOK_CONTEXT");
    expect(skill.context[0]!.required).toBe(true);
    expect(skill.context[1]!.required).toBe(false);
  });

  it("defaults to empty context array when no context block", () => {
    writeSkill(
      "no-context",
      `---
name: test
slug: no-context
version: 1.0.0
description: test
author: test
parameters: []
tools: []
---
body`,
    );
    const skill = loadSkill("no-context", TEST_DIR);
    expect(skill.context).toEqual([]);
  });

  it("rejects duplicate injectAs values", () => {
    writeSkill(
      "test-duplicate-inject-as",
      `---
name: test-duplicate-inject-as
slug: test-duplicate-inject-as
version: 1.0.0
description: Test skill with duplicate injectAs
author: test
parameters: []
tools: []
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: PLAYBOOK_CONTEXT
---

Test body.`,
    );
    expect(() => loadSkill("test-duplicate-inject-as", TEST_DIR)).toThrow(SkillValidationError);
    try {
      loadSkill("test-duplicate-inject-as", TEST_DIR);
    } catch (error) {
      expect((error as SkillValidationError).issues).toContain(
        "Duplicate injectAs value: PLAYBOOK_CONTEXT",
      );
    }
  });

  it("normalizes inject_as to injectAs", () => {
    writeSkill(
      "test-normalize",
      `---
name: test-normalize
slug: test-normalize
version: 1.0.0
description: Test normalization
author: test
parameters: []
tools: []
context:
  - kind: playbook
    scope: test-scope
    inject_as: TEST_CONTEXT
---

body`,
    );
    const skill = loadSkill("test-normalize", TEST_DIR);
    expect(skill.context[0]).toHaveProperty("injectAs");
    expect(skill.context[0]).not.toHaveProperty("inject_as");
  });
});

describe("loadSkill - real files", () => {
  it("loads the sales-pipeline skill file", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const skill = loadSkill("sales-pipeline", join(repoRoot, "skills"));
    expect(skill.slug).toBe("sales-pipeline");
    expect(skill.parameters).toHaveLength(5);
    expect(skill.tools).toEqual(["crm-query", "crm-write"]);
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

  it("loads the ad-optimizer skill file", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const skill = loadSkill("ad-optimizer", join(repoRoot, "skills"));
    expect(skill.slug).toBe("ad-optimizer");
    expect(skill.tools).toEqual(["ads-analytics"]);
    expect(skill.output).toBeDefined();
    expect(skill.output!.fields.length).toBeGreaterThan(0);
  });
});

describe("loadSkill directory mode", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-loader-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads a skill from <slug>/SKILL.md when both <slug>.md and <slug>/SKILL.md exist", () => {
    const dirSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: Directory-mode test
author: switchboard
parameters: []
tools: []
context: []
---
# Alex (directory mode)
`;
    const fileSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: File-mode test
author: switchboard
parameters: []
tools: []
context: []
---
# Alex (file mode)
`;
    mkdirSync(join(testDir, "alex"), { recursive: true });
    writeFileSync(join(testDir, "alex", "SKILL.md"), dirSkillContent);
    writeFileSync(join(testDir, "alex.md"), fileSkillContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.description).toBe("Directory-mode test");
  });

  it("falls back to <slug>.md when no directory exists", () => {
    const fileSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: File-mode only
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
    writeFileSync(join(testDir, "alex.md"), fileSkillContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.description).toBe("File-mode only");
  });

  it("throws SkillParseError when neither file nor directory exists", () => {
    expect(() => loadSkill("missing", testDir)).toThrow();
  });

  it("loads and validates references when present", () => {
    const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: With references
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
    const refContent = `---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
---
# SG rules
Banned phrases follow.
`;
    mkdirSync(join(testDir, "alex", "references", "regulatory"), { recursive: true });
    writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);
    writeFileSync(join(testDir, "alex", "references", "regulatory", "sg-rules.md"), refContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.references).toBeDefined();
    expect(skill.references).toHaveLength(1);
    expect(skill.references![0]!.metadata.jurisdiction).toBe("SG");
    expect(skill.references![0]!.metadata.riskLevel).toBe("critical");
    expect(skill.references![0]!.path).toBe("references/regulatory/sg-rules.md");
  });

  it("throws when a reference frontmatter is invalid", () => {
    const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: With bad reference
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
    const badRefContent = `---
jurisdiction: US
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
---
`;
    mkdirSync(join(testDir, "alex", "references", "regulatory"), { recursive: true });
    writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);
    writeFileSync(join(testDir, "alex", "references", "regulatory", "us-rules.md"), badRefContent);

    expect(() => loadSkill("alex", testDir)).toThrow();
  });

  it("returns references undefined when no references directory exists", () => {
    const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: No references
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
    mkdirSync(join(testDir, "alex"), { recursive: true });
    writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.references).toBeUndefined();
  });
});
