# Thin Harness, Fat Skills — SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the sales pipeline agent can run from a markdown skill file with identical behavior to the current TypeScript implementation, feature-flagged alongside the legacy path.

**Architecture:** Markdown skill files define agent judgment/process. A minimal skill runtime in `packages/core/src/skill-runtime/` loads, validates, interpolates, and executes skills via the Anthropic tool-calling API. Deterministic tools (CRM queries, stage updates, handoff logic) live alongside the runtime. The existing governance pipeline wraps everything unchanged.

**Tech Stack:** TypeScript (ESM), Vitest, Anthropic SDK (`@anthropic-ai/sdk`), `yaml` package for frontmatter parsing, Zod for validation, Prisma stores for data access.

**Spec:** `docs/superpowers/specs/2026-04-14-thin-harness-fat-skills-design.md`

---

### Task 1: Types and Shared Interfaces

**Files:**

- Create: `packages/core/src/skill-runtime/types.ts`
- Create: `packages/core/src/skill-runtime/types.test.ts`

All shared types for the skill runtime. Every subsequent task imports from here.

- [ ] **Step 1: Write the type definitions**

```typescript
// packages/core/src/skill-runtime/types.ts
import type { OpportunityStage } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Skill Definition (output of loader)
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  parameters: ParameterDeclaration[];
  tools: string[];
  body: string;
}

export type ParameterType = "string" | "number" | "boolean" | "enum" | "object";

export interface ParameterDeclaration {
  name: string;
  type: ParameterType;
  required: boolean;
  description?: string;
  values?: string[];
  schema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Skill Execution (input/output of executor)
// ---------------------------------------------------------------------------

export interface SkillExecutionParams {
  skill: SkillDefinition;
  parameters: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  deploymentId: string;
  orgId: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
}

export interface ToolCallRecord {
  toolId: string;
  operation: string;
  params: unknown;
  result: unknown;
  durationMs: number;
  governanceDecision: "auto-approved" | "require-approval";
}

// ---------------------------------------------------------------------------
// Tool Interface
// ---------------------------------------------------------------------------

export interface SkillTool {
  id: string;
  operations: Record<string, SkillToolOperation>;
}

export interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>;
  execute(params: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillParseError";
  }
}

export class SkillValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "SkillValidationError";
  }
}

export class SkillParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillParameterError";
  }
}

export class SkillExecutionBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillExecutionBudgetError";
  }
}

// ---------------------------------------------------------------------------
// Tool Governance Policy (fixed table for SP1)
// ---------------------------------------------------------------------------

export type ToolGovernanceDecision = "auto-approve" | "require-approval";

/**
 * Fixed governance policy for SP1. Only crm-write.stage.update requires
 * approval in supervised mode. Everything else auto-approves.
 */
export function getToolGovernanceDecision(
  toolName: string,
  trustLevel: "supervised" | "guided" | "autonomous",
): ToolGovernanceDecision {
  if (toolName === "crm-write.stage.update" && trustLevel === "supervised") {
    return "require-approval";
  }
  return "auto-approve";
}
```

- [ ] **Step 2: Write tests for the governance decision function**

```typescript
// packages/core/src/skill-runtime/types.test.ts
import { describe, it, expect } from "vitest";
import { getToolGovernanceDecision } from "./types.js";

describe("getToolGovernanceDecision", () => {
  it("requires approval for crm-write.stage.update in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "supervised")).toBe(
      "require-approval",
    );
  });

  it("auto-approves crm-write.stage.update in guided mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "guided")).toBe("auto-approve");
  });

  it("auto-approves crm-write.stage.update in autonomous mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "autonomous")).toBe("auto-approve");
  });

  it("auto-approves all read operations in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-query.contact.get", "supervised")).toBe("auto-approve");
    expect(getToolGovernanceDecision("crm-query.activity.list", "supervised")).toBe("auto-approve");
    expect(getToolGovernanceDecision("pipeline-handoff.determine", "supervised")).toBe(
      "auto-approve",
    );
  });

  it("auto-approves crm-write.activity.log in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-write.activity.log", "supervised")).toBe("auto-approve");
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/types.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/types.test.ts
git commit -m "feat: add skill-runtime shared types and governance policy table"
```

---

### Task 2: Template Engine

**Files:**

- Create: `packages/core/src/skill-runtime/template-engine.ts`
- Create: `packages/core/src/skill-runtime/template-engine.test.ts`

Pure function that interpolates `{{PARAM}}` and `{{PARAM.field}}` templates. No LLM, no tools — just string replacement with strict validation.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/template-engine.test.ts
import { describe, it, expect } from "vitest";
import { interpolate } from "./template-engine.js";
import { SkillParameterError } from "./types.js";
import type { ParameterDeclaration } from "./types.js";

const stringParam: ParameterDeclaration = { name: "NAME", type: "string", required: true };
const enumParam: ParameterDeclaration = {
  name: "STAGE",
  type: "enum",
  required: true,
  values: ["a", "b"],
};
const objectParam: ParameterDeclaration = {
  name: "CONFIG",
  type: "object",
  required: true,
  schema: { tone: { type: "string", required: true } },
};
const optionalParam: ParameterDeclaration = { name: "OPT", type: "string", required: false };

describe("interpolate", () => {
  it("replaces {{PARAM}} with string value", () => {
    const result = interpolate("Hello {{NAME}}", { NAME: "World" }, [stringParam]);
    expect(result).toBe("Hello World");
  });

  it("replaces {{PARAM.field}} with nested object value", () => {
    const result = interpolate("Tone: {{CONFIG.tone}}", { CONFIG: { tone: "friendly" } }, [
      objectParam,
    ]);
    expect(result).toBe("Tone: friendly");
  });

  it("serializes object values to YAML when used without dot access", () => {
    const result = interpolate(
      "Config:\n{{CONFIG}}",
      { CONFIG: { tone: "friendly", style: "casual" } },
      [objectParam],
    );
    expect(result).toContain("style: casual");
    expect(result).toContain("tone: friendly");
  });

  it("throws SkillParameterError for missing required param", () => {
    expect(() => interpolate("{{NAME}}", {}, [stringParam])).toThrow(SkillParameterError);
  });

  it("leaves template untouched for missing optional param", () => {
    const result = interpolate("Value: {{OPT}}", {}, [optionalParam]);
    expect(result).toBe("Value: ");
  });

  it("throws SkillParameterError for missing nested field", () => {
    expect(() =>
      interpolate("{{CONFIG.missing}}", { CONFIG: { tone: "x" } }, [objectParam]),
    ).toThrow(SkillParameterError);
  });

  it("validates enum values", () => {
    expect(() => interpolate("{{STAGE}}", { STAGE: "invalid" }, [enumParam])).toThrow(
      SkillParameterError,
    );
  });

  it("accepts valid enum values", () => {
    const result = interpolate("{{STAGE}}", { STAGE: "a" }, [enumParam]);
    expect(result).toBe("a");
  });

  it("replaces multiple occurrences", () => {
    const result = interpolate("{{NAME}} is {{NAME}}", { NAME: "X" }, [stringParam]);
    expect(result).toBe("X is X");
  });

  it("handles template with no placeholders", () => {
    const result = interpolate("No params here", {}, []);
    expect(result).toBe("No params here");
  });

  it("serializes object YAML with sorted keys", () => {
    const result = interpolate("{{CONFIG}}", { CONFIG: { z: 1, a: 2 } }, [objectParam]);
    expect(result.indexOf("a:")).toBeLessThan(result.indexOf("z:"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/template-engine.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/template-engine.ts
import { SkillParameterError } from "./types.js";
import type { ParameterDeclaration } from "./types.js";

function sortedYaml(obj: Record<string, unknown>, indent = 0): string {
  const prefix = "  ".repeat(indent);
  return Object.keys(obj)
    .sort()
    .map((key) => {
      const val = obj[key];
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        return `${prefix}${key}:\n${sortedYaml(val as Record<string, unknown>, indent + 1)}`;
      }
      return `${prefix}${key}: ${String(val)}`;
    })
    .join("\n");
}

function resolveValue(
  paramName: string,
  field: string | undefined,
  params: Record<string, unknown>,
  decl: ParameterDeclaration | undefined,
): string {
  const value = params[paramName];

  if (value === undefined || value === null) {
    if (decl?.required) {
      throw new SkillParameterError(`Missing required parameter: ${paramName}`);
    }
    return "";
  }

  // Validate enum
  if (decl?.type === "enum" && decl.values) {
    if (!decl.values.includes(String(value))) {
      throw new SkillParameterError(
        `Parameter ${paramName} must be one of [${decl.values.join(", ")}], got "${String(value)}"`,
      );
    }
  }

  // Dot access: {{PARAM.field}}
  if (field) {
    if (typeof value !== "object" || value === null) {
      throw new SkillParameterError(`Cannot access .${field} on non-object parameter ${paramName}`);
    }
    const nested = (value as Record<string, unknown>)[field];
    if (nested === undefined) {
      throw new SkillParameterError(`Missing field "${field}" in parameter ${paramName}`);
    }
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      return sortedYaml(nested as Record<string, unknown>);
    }
    return String(nested);
  }

  // Full object → YAML
  if (typeof value === "object" && !Array.isArray(value)) {
    return sortedYaml(value as Record<string, unknown>);
  }

  return String(value);
}

export function interpolate(
  template: string,
  params: Record<string, unknown>,
  declarations: ParameterDeclaration[],
): string {
  const declMap = new Map(declarations.map((d) => [d.name, d]));

  // Validate all required params are present before interpolation
  for (const decl of declarations) {
    if (decl.required && !(decl.name in params)) {
      throw new SkillParameterError(`Missing required parameter: ${decl.name}`);
    }
  }

  // Replace {{PARAM}} and {{PARAM.field}}
  return template.replace(
    /\{\{(\w+)(?:\.(\w+))?\}\}/g,
    (_match, paramName: string, field?: string) => {
      const decl = declMap.get(paramName);
      return resolveValue(paramName, field, params, decl);
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/template-engine.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/template-engine.ts packages/core/src/skill-runtime/template-engine.test.ts
git commit -m "feat: add skill template engine with strict param validation"
```

---

### Task 3: Skill Loader

**Files:**

- Create: `packages/core/src/skill-runtime/skill-loader.ts`
- Create: `packages/core/src/skill-runtime/skill-loader.test.ts`
- Create: `skills/sales-pipeline.md` (the actual skill file)

Parses markdown skill files, validates frontmatter with Zod, and returns typed `SkillDefinition` objects.

- [ ] **Step 1: Install the `yaml` dependency**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add yaml`

Note: using `yaml` (pure ESM) instead of `gray-matter` (CJS) for ESM compatibility.

- [ ] **Step 2: Write the failing tests (brutal validation suite)**

```typescript
// packages/core/src/skill-runtime/skill-loader.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-loader.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/skill-runtime/skill-loader.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SkillParseError, SkillValidationError } from "./types.js";
import type { SkillDefinition, ParameterDeclaration } from "./types.js";

const ParameterDeclarationSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "enum", "object"]),
  required: z.boolean(),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  schema: z.record(z.unknown()).optional(),
});

const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  parameters: z.array(ParameterDeclarationSchema),
  tools: z.array(z.string()),
});

function splitFrontmatter(raw: string): { frontmatterStr: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new SkillParseError("Skill file must start with YAML frontmatter delimited by ---");
  }
  return { frontmatterStr: match[1]!, body: match[2]! };
}

function validateParameters(params: ParameterDeclaration[]): string[] {
  const issues: string[] = [];
  const names = new Set<string>();

  for (const p of params) {
    if (names.has(p.name)) {
      issues.push(`Duplicate parameter name: ${p.name}`);
    }
    names.add(p.name);

    if (p.type === "enum" && (!p.values || p.values.length === 0)) {
      issues.push(`Enum parameter "${p.name}" must have a non-empty values array`);
    }
    if (p.type === "object" && !p.schema) {
      issues.push(`Object parameter "${p.name}" must have a schema`);
    }
  }

  return issues;
}

function validateToolReferences(body: string, declaredTools: string[]): string[] {
  const issues: string[] = [];
  // Scan for tool references like `crm-write.stage.update` in the body
  const toolRefPattern = /\b([a-z][\w-]*)\.\w+\.\w+/g;
  let match: RegExpExecArray | null;
  const referencedToolIds = new Set<string>();

  while ((match = toolRefPattern.exec(body)) !== null) {
    referencedToolIds.add(match[1]!);
  }

  for (const toolId of referencedToolIds) {
    if (!declaredTools.includes(toolId)) {
      issues.push(`Tool "${toolId}" referenced in body but not declared in tools frontmatter`);
    }
  }

  return issues;
}

export function loadSkill(slug: string, skillsDir: string): SkillDefinition {
  const filePath = join(skillsDir, `${slug}.md`);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new SkillParseError(`Skill file not found: ${filePath}`);
  }

  const { frontmatterStr, body } = splitFrontmatter(raw);

  let frontmatterRaw: unknown;
  try {
    frontmatterRaw = parseYaml(frontmatterStr);
  } catch (err) {
    throw new SkillParseError(`Invalid YAML in frontmatter: ${(err as Error).message}`);
  }

  const parseResult = SkillFrontmatterSchema.safeParse(frontmatterRaw);
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new SkillValidationError("Invalid skill frontmatter", messages);
  }

  const frontmatter = parseResult.data;
  const issues: string[] = [];

  // Validate parameters
  issues.push(...validateParameters(frontmatter.parameters));

  // Validate body is not empty
  if (!body.trim()) {
    issues.push("Skill body must not be empty");
  }

  // Validate tool references in body match declared tools
  if (body.trim()) {
    issues.push(...validateToolReferences(body, frontmatter.tools));
  }

  if (issues.length > 0) {
    throw new SkillValidationError("Skill validation failed", issues);
  }

  return {
    name: frontmatter.name,
    slug: frontmatter.slug,
    version: frontmatter.version,
    description: frontmatter.description,
    author: frontmatter.author,
    parameters: frontmatter.parameters,
    tools: frontmatter.tools,
    body: body.trim(),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-loader.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-loader.ts packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "feat: add skill loader with brutal validation suite"
```

---

### Task 4: Sales Pipeline Skill File

**Files:**

- Create: `skills/sales-pipeline.md`

The actual skill file. Copy the markdown content from the spec verbatim — it has been reviewed and approved.

- [ ] **Step 1: Create the skills directory and file**

Create `skills/sales-pipeline.md` with the full skill content. The file must contain:

- YAML frontmatter with `name: sales-pipeline`, `slug: sales-pipeline`, `version: 1.0.0`, `author: switchboard`
- 5 parameters: `BUSINESS_NAME` (string), `PIPELINE_STAGE` (enum), `OPPORTUNITY_ID` (string), `LEAD_PROFILE` (object, optional), `PERSONA_CONFIG` (object with schema)
- 3 tools: `crm-query`, `crm-write`, `pipeline-handoff`
- Body with 4 stage sections: Speed-to-Lead (interested), Sales Closer (qualified/quoted/booked/showed), Nurture Specialist (nurturing), Terminal (won/lost)
- Each role section includes escalation rules with `{{PERSONA_CONFIG.escalationRules}}` interpolation
- Speed-to-Lead has 15-message cap and frustration/anger escalation triggers
- Nurture has two re-engagement paths: buying signals → qualified, needs qualification → interested
- Terminal stage refuses engagement and escalates

The full content is in the spec at `docs/superpowers/specs/2026-04-14-thin-harness-fat-skills-design.md` lines 73-213. Copy it verbatim — it has been through 3 review rounds.

- [ ] **Step 2: Write a loader integration test that loads the real skill file**

```typescript
// Add to skill-loader.test.ts
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("loadSkill - real files", () => {
  it("loads the sales-pipeline skill file", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const skill = loadSkill("sales-pipeline", join(repoRoot, "skills"));
    expect(skill.slug).toBe("sales-pipeline");
    expect(skill.parameters).toHaveLength(5);
    expect(skill.tools).toEqual(["crm-query", "crm-write", "pipeline-handoff"]);
    expect(skill.body).toContain("Speed-to-Lead");
    expect(skill.body).toContain("Sales Closer");
    expect(skill.body).toContain("Nurture Specialist");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-loader.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add skills/sales-pipeline.md packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "feat: add sales-pipeline skill file"
```

---

### Task 5: Pipeline Handoff Tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`
- Create: `packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts`

Extracted from `packages/core/src/sales-pipeline/pipeline-orchestrator.ts`. Pure deterministic function — no LLM, no DB. The tests are ported from `pipeline-orchestrator.test.ts` with the interface adapted to the tool contract.

- [ ] **Step 1: Write the failing tests (ported from existing)**

```typescript
// packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts
import { describe, it, expect } from "vitest";
import { createPipelineHandoffTool } from "./pipeline-handoff.js";

const tool = createPipelineHandoffTool();
const determine = tool.operations["determine"]!;

describe("pipeline-handoff.determine", () => {
  it("returns no-action for terminal stages", async () => {
    const result = await determine.execute({
      opportunityStage: "won",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("returns no-action for lost stage", async () => {
    const result = await determine.execute({
      opportunityStage: "lost",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("detects dormancy when hours exceeded", async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "go-dormant",
      toAgent: "nurture-specialist",
      reason: expect.stringContaining("No customer reply for"),
    });
  });

  it("does not trigger dormancy within threshold", async () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: recentDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("hands off to sales-closer when stage is qualified", async () => {
    const result = await determine.execute({
      opportunityStage: "qualified",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });
  });

  it("hands off to nurture-specialist when stage is nurturing", async () => {
    const result = await determine.execute({
      opportunityStage: "nurturing",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "handoff",
      toAgent: "nurture-specialist",
      reason: "Lead entered nurturing stage",
    });
  });

  it("returns no-action when stage and agent are aligned", async () => {
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: new Date().toISOString(),
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("does not trigger dormancy for nurture-specialist already assigned", async () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "nurturing",
      assignedAgent: "nurture-specialist",
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("has correct inputSchema with enums", () => {
    const schema = determine.inputSchema as Record<string, unknown>;
    expect(schema).toBeDefined();
    const props = (schema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props["assignedAgent"]?.enum).toEqual([
      "speed-to-lead",
      "sales-closer",
      "nurture-specialist",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/pipeline-handoff.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tools/pipeline-handoff.ts
import type { SkillTool } from "../types.js";
import type { OpportunityStage } from "@switchboard/schemas";

type AgentRole = "speed-to-lead" | "sales-closer" | "nurture-specialist";

interface HandoffInput {
  opportunityStage: OpportunityStage;
  assignedAgent: AgentRole;
  lastCustomerReplyAt: string | null;
  dormancyThresholdHours: number;
}

type HandoffResult =
  | { action: "none" }
  | { action: "handoff" | "go-dormant"; toAgent: AgentRole; reason: string };

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

const STAGE_TO_AGENT: Partial<Record<OpportunityStage, AgentRole>> = {
  interested: "speed-to-lead",
  qualified: "sales-closer",
  nurturing: "nurture-specialist",
};

function determine(input: HandoffInput): HandoffResult {
  if (TERMINAL_STAGES.includes(input.opportunityStage)) {
    return { action: "none" };
  }

  // Dormancy check
  if (
    input.lastCustomerReplyAt &&
    input.opportunityStage !== "nurturing" &&
    input.assignedAgent !== "nurture-specialist"
  ) {
    const hoursSinceReply =
      (Date.now() - new Date(input.lastCustomerReplyAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceReply > input.dormancyThresholdHours) {
      return {
        action: "go-dormant",
        toAgent: "nurture-specialist",
        reason: `No customer reply for ${Math.round(hoursSinceReply)} hours, entering nurture`,
      };
    }
  }

  // Stage-based handoff
  const expectedAgent = STAGE_TO_AGENT[input.opportunityStage];
  if (expectedAgent && expectedAgent !== input.assignedAgent) {
    const reasons: Record<AgentRole, string> = {
      "speed-to-lead": "Re-engaged lead needs qualification",
      "sales-closer": "Lead qualified, transitioning to Sales Closer",
      "nurture-specialist": "Lead entered nurturing stage",
    };
    return {
      action: "handoff",
      toAgent: expectedAgent,
      reason: reasons[expectedAgent],
    };
  }

  return { action: "none" };
}

export function createPipelineHandoffTool(): SkillTool {
  return {
    id: "pipeline-handoff",
    operations: {
      determine: {
        description:
          "Check if a lead should be handed off to a different pipeline agent based on current stage and time since last customer reply.",
        inputSchema: {
          type: "object",
          properties: {
            opportunityStage: {
              type: "string",
              enum: [
                "interested",
                "qualified",
                "quoted",
                "booked",
                "showed",
                "won",
                "lost",
                "nurturing",
              ],
            },
            assignedAgent: {
              type: "string",
              enum: ["speed-to-lead", "sales-closer", "nurture-specialist"],
              description: "Current agent role handling this lead",
            },
            lastCustomerReplyAt: {
              type: ["string", "null"],
              description: "ISO 8601 timestamp of last customer reply, or null if never replied",
            },
            dormancyThresholdHours: {
              type: "number",
              description: "Hours of silence before entering nurture",
            },
          },
          required: ["opportunityStage", "assignedAgent", "dormancyThresholdHours"],
        },
        execute: async (params: unknown) => determine(params as HandoffInput),
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/pipeline-handoff.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/pipeline-handoff.ts packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts
git commit -m "feat: extract pipeline-handoff as deterministic skill tool"
```

---

### Task 6: CRM Tools (crm-query + crm-write)

**Files:**

- Create: `packages/core/src/skill-runtime/tools/crm-query.ts`
- Create: `packages/core/src/skill-runtime/tools/crm-query.test.ts`
- Create: `packages/core/src/skill-runtime/tools/crm-write.ts`
- Create: `packages/core/src/skill-runtime/tools/crm-write.test.ts`
- Create: `packages/core/src/skill-runtime/tools/index.ts`

Thin wrappers around existing Prisma stores. Each tool receives stores via dependency injection.

- [ ] **Step 1: Write crm-query tests**

```typescript
// packages/core/src/skill-runtime/tools/crm-query.test.ts
import { describe, it, expect, vi } from "vitest";
import { createCrmQueryTool } from "./crm-query.js";

const mockContactStore = {
  findById: vi.fn().mockResolvedValue({ id: "c1", name: "Alice", phone: "+1234" }),
};

const mockActivityStore = {
  listByDeployment: vi.fn().mockResolvedValue([{ id: "a1", eventType: "message" }]),
};

describe("crm-query tool", () => {
  const tool = createCrmQueryTool(mockContactStore as any, mockActivityStore as any);

  it("has correct id", () => {
    expect(tool.id).toBe("crm-query");
  });

  it("contact.get delegates to contactStore.findById", async () => {
    const result = await tool.operations["contact.get"]!.execute({
      contactId: "c1",
      orgId: "org1",
    });
    expect(mockContactStore.findById).toHaveBeenCalledWith("org1", "c1");
    expect(result).toEqual({ id: "c1", name: "Alice", phone: "+1234" });
  });

  it("activity.list delegates to activityStore.listByDeployment", async () => {
    const result = await tool.operations["activity.list"]!.execute({
      orgId: "org1",
      deploymentId: "d1",
      limit: 10,
    });
    expect(mockActivityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 10 });
    expect(result).toHaveLength(1);
  });

  it("activity.list defaults limit to 20", async () => {
    await tool.operations["activity.list"]!.execute({
      orgId: "org1",
      deploymentId: "d1",
    });
    expect(mockActivityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 20 });
  });

  it("has valid inputSchema for contact.get", () => {
    const schema = tool.operations["contact.get"]!.inputSchema as { required: string[] };
    expect(schema.required).toContain("contactId");
    expect(schema.required).toContain("orgId");
  });
});
```

- [ ] **Step 2: Write crm-query implementation**

```typescript
// packages/core/src/skill-runtime/tools/crm-query.ts
import type { SkillTool } from "../types.js";

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface ActivityStoreSubset {
  listByDeployment(orgId: string, deploymentId: string, opts: { limit: number }): Promise<unknown>;
}

export function createCrmQueryTool(
  contactStore: ContactStoreSubset,
  activityStore: ActivityStoreSubset,
): SkillTool {
  return {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get a contact by ID. Returns name, phone, email, stage, source.",
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string", description: "Contact UUID" },
            orgId: { type: "string", description: "Organization ID" },
          },
          required: ["contactId", "orgId"],
        },
        execute: async (params: unknown) => {
          const { contactId, orgId } = params as { contactId: string; orgId: string };
          return contactStore.findById(orgId, contactId);
        },
      },
      "activity.list": {
        description: "List recent activity logs for a deployment.",
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["orgId", "deploymentId"],
        },
        execute: async (params: unknown) => {
          const { orgId, deploymentId, limit } = params as {
            orgId: string;
            deploymentId: string;
            limit?: number;
          };
          return activityStore.listByDeployment(orgId, deploymentId, { limit: limit ?? 20 });
        },
      },
    },
  };
}
```

- [ ] **Step 3: Write crm-write tests**

```typescript
// packages/core/src/skill-runtime/tools/crm-write.test.ts
import { describe, it, expect, vi } from "vitest";
import { createCrmWriteTool } from "./crm-write.js";

const mockOpportunityStore = {
  updateStage: vi.fn().mockResolvedValue({ id: "o1", stage: "qualified" }),
};

const mockActivityStore = {
  write: vi.fn().mockResolvedValue(undefined),
};

describe("crm-write tool", () => {
  const tool = createCrmWriteTool(mockOpportunityStore as any, mockActivityStore as any);

  it("has correct id", () => {
    expect(tool.id).toBe("crm-write");
  });

  it("stage.update delegates to opportunityStore.updateStage", async () => {
    const result = await tool.operations["stage.update"]!.execute({
      orgId: "org1",
      opportunityId: "o1",
      stage: "qualified",
    });
    expect(mockOpportunityStore.updateStage).toHaveBeenCalledWith("org1", "o1", "qualified");
    expect(result).toEqual({ id: "o1", stage: "qualified" });
  });

  it("activity.log delegates to activityStore.write", async () => {
    await tool.operations["activity.log"]!.execute({
      organizationId: "org1",
      deploymentId: "d1",
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(mockActivityStore.write).toHaveBeenCalledWith({
      organizationId: "org1",
      deploymentId: "d1",
      eventType: "opt-out",
      description: "Customer opted out",
    });
  });

  it("stage.update has enum constraint in inputSchema", () => {
    const schema = tool.operations["stage.update"]!.inputSchema as any;
    expect(schema.properties.stage.enum).toContain("qualified");
    expect(schema.properties.stage.enum).toContain("nurturing");
  });
});
```

- [ ] **Step 4: Write crm-write implementation**

```typescript
// packages/core/src/skill-runtime/tools/crm-write.ts
import type { SkillTool } from "../types.js";

interface OpportunityStoreSubset {
  updateStage(
    orgId: string,
    opportunityId: string,
    stage: string,
    closedAt?: Date | null,
  ): Promise<unknown>;
}

interface ActivityStoreSubset {
  write(input: {
    organizationId: string;
    deploymentId: string;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export function createCrmWriteTool(
  opportunityStore: OpportunityStoreSubset,
  activityStore: ActivityStoreSubset,
): SkillTool {
  return {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update an opportunity's pipeline stage.",
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            opportunityId: { type: "string", description: "Opportunity UUID" },
            stage: {
              type: "string",
              enum: [
                "interested",
                "qualified",
                "quoted",
                "booked",
                "showed",
                "won",
                "lost",
                "nurturing",
              ],
            },
          },
          required: ["orgId", "opportunityId", "stage"],
        },
        execute: async (params: unknown) => {
          const { orgId, opportunityId, stage } = params as {
            orgId: string;
            opportunityId: string;
            stage: string;
          };
          return opportunityStore.updateStage(orgId, opportunityId, stage);
        },
      },
      "activity.log": {
        description: "Log an activity event.",
        inputSchema: {
          type: "object",
          properties: {
            organizationId: { type: "string" },
            deploymentId: { type: "string" },
            eventType: { type: "string", description: "e.g. opt-out, qualification, handoff" },
            description: { type: "string" },
          },
          required: ["organizationId", "deploymentId", "eventType", "description"],
        },
        execute: async (params: unknown) => {
          const input = params as {
            organizationId: string;
            deploymentId: string;
            eventType: string;
            description: string;
          };
          await activityStore.write(input);
        },
      },
    },
  };
}
```

- [ ] **Step 5: Write the tools barrel export**

```typescript
// packages/core/src/skill-runtime/tools/index.ts
export { createCrmQueryTool } from "./crm-query.js";
export { createCrmWriteTool } from "./crm-write.js";
export { createPipelineHandoffTool } from "./pipeline-handoff.js";
```

- [ ] **Step 6: Run all tool tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/`
Expected: PASS (all tests across 3 tool files)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/
git commit -m "feat: add crm-query and crm-write skill tools"
```

---

### Task 7: Governance Injector

**Files:**

- Create: `packages/core/src/skill-runtime/governance-injector.ts`
- Create: `packages/core/src/skill-runtime/governance-injector.test.ts`

One static block. Nothing dynamic, composable, or tenant-aware.

- [ ] **Step 1: Write the test**

```typescript
// packages/core/src/skill-runtime/governance-injector.test.ts
import { describe, it, expect } from "vitest";
import { getGovernanceConstraints } from "./governance-injector.js";

describe("getGovernanceConstraints", () => {
  it("returns a non-empty string", () => {
    const constraints = getGovernanceConstraints();
    expect(constraints.length).toBeGreaterThan(100);
  });

  it("includes AI disclosure rule", () => {
    expect(getGovernanceConstraints()).toContain("Never claim to be human");
  });

  it("includes opt-out rule", () => {
    expect(getGovernanceConstraints()).toContain("Respect opt-out immediately");
  });

  it("includes no-fabrication rule", () => {
    expect(getGovernanceConstraints()).toContain("Never fabricate");
  });

  it("includes escalation rule", () => {
    expect(getGovernanceConstraints()).toContain("Always offer human escalation");
  });
});
```

- [ ] **Step 2: Write the implementation**

```typescript
// packages/core/src/skill-runtime/governance-injector.ts

const GOVERNANCE_CONSTRAINTS = `
MANDATORY RULES — Injected by runtime. Cannot be overridden.
- Never claim to be human. If asked directly, acknowledge you are an AI assistant.
- Never make financial promises, guarantees, or binding commitments.
- Never disparage competitors by name. Differentiate, don't disparage.
- Always offer human escalation when asked.
- Never share other customers' information, deals, or conversations.
- Respect opt-out immediately. If they say stop/unsubscribe/leave me alone, stop.
- Never fabricate statistics, case studies, or testimonials.
- Never pressure or manipulate. Create urgency through value, not fear.
`.trim();

export function getGovernanceConstraints(): string {
  return GOVERNANCE_CONSTRAINTS;
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/governance-injector.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/governance-injector.ts packages/core/src/skill-runtime/governance-injector.test.ts
git commit -m "feat: add static governance constraint injector"
```

---

### Task 8: Tool-Calling Adapter

**Files:**

- Create: `packages/core/src/skill-runtime/tool-calling-adapter.ts`
- Create: `packages/core/src/skill-runtime/tool-calling-adapter.test.ts`

Thin wrapper around Anthropic SDK `messages.create()` with the `tools` parameter. No retry logic, no caching.

- [ ] **Step 1: Write the test with a mock Anthropic client**

```typescript
// packages/core/src/skill-runtime/tool-calling-adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { AnthropicToolCallingAdapter, type ToolCallingAdapter } from "./tool-calling-adapter.js";

describe("AnthropicToolCallingAdapter", () => {
  it("calls Anthropic messages.create with tools parameter", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const adapter = new AnthropicToolCallingAdapter({
      messages: { create: mockCreate },
    } as any);

    const result = await adapter.chatWithTools({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(100);
  });

  it("passes tools to API call", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        { type: "tool_use", id: "t1", name: "crm-query.contact.get", input: { contactId: "c1" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const adapter = new AnthropicToolCallingAdapter({
      messages: { create: mockCreate },
    } as any);

    const tools = [
      {
        name: "crm-query.contact.get",
        description: "Get contact",
        input_schema: { type: "object" as const, properties: { contactId: { type: "string" } } },
      },
    ];

    const result = await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "get contact" }],
      tools,
    });

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.tools).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
  });
});
```

- [ ] **Step 2: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tool-calling-adapter.ts
import type Anthropic from "@anthropic-ai/sdk";

export interface ToolCallingAdapterResponse {
  content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallingAdapter {
  chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
  }): Promise<ToolCallingAdapterResponse>;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicToolCallingAdapter implements ToolCallingAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
  }): Promise<ToolCallingAdapterResponse> {
    const response = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.system,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
    });

    return {
      content: response.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>,
      stopReason: response.stop_reason as "end_turn" | "tool_use" | "max_tokens",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tool-calling-adapter.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/tool-calling-adapter.ts packages/core/src/skill-runtime/tool-calling-adapter.test.ts
git commit -m "feat: add Anthropic tool-calling adapter for skill execution"
```

---

### Task 9: Skill Executor

**Files:**

- Create: `packages/core/src/skill-runtime/skill-executor.ts`
- Create: `packages/core/src/skill-runtime/skill-executor.test.ts`

The core orchestration: interpolate → inject governance → call LLM with tools → run tool loop → enforce budgets.

- [ ] **Step 1: Write the tests with a mock adapter**

Test cases: basic execution, tool-call loop, budget enforcement, governance constraint injection, tool governance policy.

```typescript
// packages/core/src/skill-runtime/skill-executor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillExecutorImpl } from "./skill-executor.js";
import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type { SkillDefinition, SkillTool } from "./types.js";
import { SkillParameterError, SkillExecutionBudgetError } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "NAME", type: "string", required: true }],
  tools: [],
  body: "Hello {{NAME}}",
};

function createMockAdapter(
  responses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
  }>,
): ToolCallingAdapter {
  let callIndex = 0;
  return {
    chatWithTools: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex]!;
      callIndex++;
      return Promise.resolve({
        content: resp.content,
        stopReason: resp.stop_reason,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    }),
  };
}

describe("SkillExecutorImpl", () => {
  it("interpolates params and calls adapter with governance constraints", async () => {
    const adapter = createMockAdapter([
      {
        content: [{ type: "text", text: "Hi there" }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute({
      skill: mockSkill,
      parameters: { NAME: "Alice" },
      messages: [{ role: "user", content: "hello" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.response).toBe("Hi there");
    expect(result.toolCalls).toHaveLength(0);
    // Verify system prompt contains both skill body and governance
    const callArgs = (adapter.chatWithTools as any).mock.calls[0][0];
    expect(callArgs.system).toContain("Hello Alice");
    expect(callArgs.system).toContain("MANDATORY RULES");
    expect(callArgs.system).toContain("Never claim to be human");
  });

  it("throws SkillParameterError for missing required param", async () => {
    const adapter = createMockAdapter([]);
    const executor = new SkillExecutorImpl(adapter, new Map());
    await expect(
      executor.execute({
        skill: mockSkill,
        parameters: {},
        messages: [],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillParameterError);
  });

  it("executes tool calls in a loop", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["test-tool"],
      body: "Use test-tool.do to help {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "test-tool",
      operations: {
        do: {
          description: "do something",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ done: true }),
        },
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "test-tool.do", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Done!" }],
        stop_reason: "end_turn",
      },
    ]);

    const toolMap = new Map([["test-tool", mockTool]]);
    const executor = new SkillExecutorImpl(adapter, toolMap);
    const result = await executor.execute({
      skill: toolSkill,
      parameters: { NAME: "Bob" },
      messages: [{ role: "user", content: "help" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    });

    expect(result.response).toBe("Done!");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.toolId).toBe("test-tool");
    expect(result.toolCalls[0]!.operation).toBe("do");
    expect(mockTool.operations["do"]!.execute).toHaveBeenCalled();
  });

  it("enforces max tool calls budget", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["test-tool"],
      body: "Use test-tool.do {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "test-tool",
      operations: {
        do: {
          description: "do",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    };

    // Return tool_use 10 times — should hit budget at 5
    const responses = Array.from({ length: 10 }, (_, i) => ({
      content: [{ type: "tool_use" as const, id: `t${i}`, name: "test-tool.do", input: {} }],
      stop_reason: "tool_use",
    }));

    const adapter = createMockAdapter(responses);
    const executor = new SkillExecutorImpl(adapter, new Map([["test-tool", mockTool]]));

    await expect(
      executor.execute({
        skill: toolSkill,
        parameters: { NAME: "X" },
        messages: [{ role: "user", content: "go" }],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 50,
        trustLevel: "guided",
      }),
    ).rejects.toThrow(SkillExecutionBudgetError);
  });

  it("records governance decision for tool calls", async () => {
    const toolSkill: SkillDefinition = {
      ...mockSkill,
      tools: ["crm-write"],
      body: "Use crm-write.stage.update {{NAME}}",
    };
    const mockTool: SkillTool = {
      id: "crm-write",
      operations: {
        "stage.update": {
          description: "update stage",
          inputSchema: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    };

    const adapter = createMockAdapter([
      {
        content: [{ type: "tool_use", id: "t1", name: "crm-write.stage.update", input: {} }],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Updated" }],
        stop_reason: "end_turn",
      },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map([["crm-write", mockTool]]));

    // Supervised mode — stage.update requires approval
    await expect(
      executor.execute({
        skill: toolSkill,
        parameters: { NAME: "X" },
        messages: [{ role: "user", content: "update" }],
        deploymentId: "d1",
        orgId: "org1",
        trustScore: 10,
        trustLevel: "supervised",
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        {
          toolId: "crm-write",
          operation: "stage.update",
          governanceDecision: "require-approval",
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/skill-executor.ts
import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
} from "./types.js";
import { SkillExecutionBudgetError, getToolGovernanceDecision } from "./types.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_CALLS = 5;
const MAX_LLM_TURNS = 6;

export class SkillExecutorImpl {
  constructor(
    private adapter: ToolCallingAdapter,
    private tools: Map<string, SkillTool>,
  ) {}

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    // 1. Interpolate
    const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);

    // 2. Build system prompt
    const system = `${interpolated}\n\n${getGovernanceConstraints()}`;

    // 3. Convert tools to Anthropic format
    const anthropicTools = this.buildAnthropicTools(params.skill.tools);

    // 4. Run LLM loop
    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turnCount = 0;

    while (turnCount < MAX_LLM_TURNS) {
      turnCount++;
      const response = await this.adapter.chatWithTools({
        system,
        messages,
        tools: anthropicTools,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return {
          response: text,
          toolCalls: toolCallRecords,
          tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
        };
      }

      // Handle tool calls
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      // Add assistant message with tool use
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolCallRecords.length >= MAX_TOOL_CALLS) {
          throw new SkillExecutionBudgetError(`Exceeded maximum tool calls (${MAX_TOOL_CALLS})`);
        }

        const start = Date.now();
        const [toolId, ...opParts] = toolUse.name.split(".");
        const operation = opParts.join(".");
        const tool = this.tools.get(toolId!);
        const op = tool?.operations[operation];

        const governanceDecision = getToolGovernanceDecision(toolUse.name, params.trustLevel);

        let result: unknown;
        if (governanceDecision === "require-approval") {
          result = { status: "pending_approval", message: "This action requires human approval." };
        } else if (op) {
          result = await op.execute(toolUse.input);
        } else {
          result = { error: `Unknown tool: ${toolUse.name}` };
        }

        toolCallRecords.push({
          toolId: toolId!,
          operation,
          params: toolUse.input,
          result,
          durationMs: Date.now() - start,
          governanceDecision:
            governanceDecision === "require-approval" ? "require-approval" : "auto-approved",
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new SkillExecutionBudgetError(`Exceeded maximum LLM turns (${MAX_LLM_TURNS})`);
  }

  private buildAnthropicTools(toolIds: string[]): Anthropic.Tool[] {
    const result: Anthropic.Tool[] = [];
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) continue;
      for (const [opName, op] of Object.entries(tool.operations)) {
        result.push({
          name: `${toolId}.${opName}`,
          description: op.description,
          input_schema: op.inputSchema as Anthropic.Tool.InputSchema,
        });
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat: add skill executor with tool loop and budget enforcement"
```

---

### Task 10: Skill Handler + Barrel Export

**Files:**

- Create: `packages/core/src/skill-runtime/skill-handler.ts`
- Create: `packages/core/src/skill-runtime/skill-handler.test.ts`
- Create: `packages/core/src/skill-runtime/index.ts`

The glue between `AgentHandler` and `SkillExecutor`. Maps `AgentContext` to `SkillExecutionParams`, resolves opportunity, builds parameters.

- [ ] **Step 1: Write the tests**

Test: opportunity resolution, parameter mapping, escalation on no opportunity, message passthrough.

```typescript
// packages/core/src/skill-runtime/skill-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { SkillHandler } from "./skill-handler.js";
import type { SkillDefinition } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [
    { name: "BUSINESS_NAME", type: "string", required: true },
    { name: "PIPELINE_STAGE", type: "enum", required: true, values: ["interested", "qualified"] },
    { name: "OPPORTUNITY_ID", type: "string", required: true },
    {
      name: "PERSONA_CONFIG",
      type: "object",
      required: true,
      schema: { tone: { type: "string" } },
    },
  ],
  tools: [],
  body: "test",
};

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    persona: {
      businessName: "TestBiz",
      tone: "friendly",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules: {},
      bookingLink: null,
      customInstructions: null,
      ...((overrides.persona as object) ?? {}),
    },
    conversation: {
      id: "conv1",
      messages: [{ role: "user", content: "hi" }],
      ...((overrides.conversation as object) ?? {}),
    },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn(), sendToThread: vi.fn() },
    state: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    files: { read: vi.fn(), write: vi.fn() },
    browser: { navigate: vi.fn(), click: vi.fn(), extract: vi.fn(), screenshot: vi.fn() },
    llm: { chat: vi.fn() },
    notify: vi.fn(),
    handoff: vi.fn(),
    ...overrides,
  } as any;
}

describe("SkillHandler", () => {
  it("escalates when no active opportunity found", async () => {
    const mockOpportunityStore = {
      findActiveByContact: vi.fn().mockResolvedValue([]),
    };
    const mockContactStore = { findById: vi.fn().mockResolvedValue(null) };
    const mockExecutor = { execute: vi.fn() };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as any,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore } as any,
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("no active deal"));
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("resolves opportunity and calls executor", async () => {
    const mockOpportunityStore = {
      findActiveByContact: vi
        .fn()
        .mockResolvedValue([{ id: "opp1", stage: "interested", createdAt: new Date() }]),
    };
    const mockContactStore = {
      findById: vi.fn().mockResolvedValue({ id: "c1", name: "Alice" }),
    };
    const mockExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({
          response: "Hello!",
          toolCalls: [],
          tokenUsage: { input: 0, output: 0 },
        }),
    };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as any,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore } as any,
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    expect(mockExecutor.execute).toHaveBeenCalledOnce();
    const executorArgs = mockExecutor.execute.mock.calls[0]![0];
    expect(executorArgs.parameters.BUSINESS_NAME).toBe("TestBiz");
    expect(executorArgs.parameters.PIPELINE_STAGE).toBe("interested");
    expect(executorArgs.parameters.OPPORTUNITY_ID).toBe("opp1");
    expect(ctx.chat.send).toHaveBeenCalledWith("Hello!");
  });

  it("takes most recent opportunity when multiple exist", async () => {
    const older = { id: "opp1", stage: "interested", createdAt: new Date("2025-01-01") };
    const newer = { id: "opp2", stage: "qualified", createdAt: new Date("2026-01-01") };
    const mockOpportunityStore = {
      findActiveByContact: vi.fn().mockResolvedValue([older, newer]),
    };
    const mockContactStore = {
      findById: vi.fn().mockResolvedValue({ id: "c1", name: "Bob" }),
    };
    const mockExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({ response: "Hi", toolCalls: [], tokenUsage: { input: 0, output: 0 } }),
    };

    const handler = new SkillHandler(
      mockSkill,
      mockExecutor as any,
      { opportunityStore: mockOpportunityStore, contactStore: mockContactStore } as any,
      { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    );

    const ctx = createMockCtx();
    await handler.onMessage(ctx);

    const executorArgs = mockExecutor.execute.mock.calls[0]![0];
    expect(executorArgs.parameters.OPPORTUNITY_ID).toBe("opp2");
    expect(executorArgs.parameters.PIPELINE_STAGE).toBe("qualified");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-handler.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/skill-handler.ts
import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type { SkillExecutorImpl } from "./skill-executor.js";
import type { SkillDefinition } from "./types.js";

interface OpportunityStoreSubset {
  findActiveByContact(
    orgId: string,
    contactId: string,
  ): Promise<
    Array<{
      id: string;
      stage: string;
      createdAt: Date;
    }>
  >;
}

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface SkillHandlerStores {
  opportunityStore: OpportunityStoreSubset;
  contactStore: ContactStoreSubset;
}

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
  contactId: string;
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutorImpl,
    private stores: SkillHandlerStores,
    private config: SkillHandlerConfig,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    // Resolve opportunity
    const opportunities = await this.stores.opportunityStore.findActiveByContact(
      this.config.orgId,
      this.config.contactId,
    );

    if (opportunities.length === 0) {
      await ctx.chat.send(
        "I'd like to help, but there's no active deal found for this conversation. " +
          "Let me connect you with the team to get things started.",
      );
      return;
    }

    // Take most recently created
    const opportunity = opportunities.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0]!;

    // Resolve lead profile
    const leadProfile = await this.stores.contactStore.findById(
      this.config.orgId,
      this.config.contactId,
    );

    // Build parameters
    const parameters: Record<string, unknown> = {
      BUSINESS_NAME: ctx.persona.businessName,
      PIPELINE_STAGE: opportunity.stage,
      OPPORTUNITY_ID: opportunity.id,
      LEAD_PROFILE: leadProfile,
      PERSONA_CONFIG: {
        tone: ctx.persona.tone,
        qualificationCriteria: ctx.persona.qualificationCriteria,
        disqualificationCriteria: ctx.persona.disqualificationCriteria,
        escalationRules: ctx.persona.escalationRules,
        bookingLink: ctx.persona.bookingLink ?? "",
        customInstructions: ctx.persona.customInstructions ?? "",
      },
    };

    // Map messages
    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages,
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    await ctx.chat.send(result.response);
  }
}
```

- [ ] **Step 4: Write the barrel export**

```typescript
// packages/core/src/skill-runtime/index.ts
export { loadSkill } from "./skill-loader.js";
export { SkillExecutorImpl } from "./skill-executor.js";
export { SkillHandler } from "./skill-handler.js";
export { AnthropicToolCallingAdapter } from "./tool-calling-adapter.js";
export { interpolate } from "./template-engine.js";
export { getGovernanceConstraints } from "./governance-injector.js";
export {
  createCrmQueryTool,
  createCrmWriteTool,
  createPipelineHandoffTool,
} from "./tools/index.js";
export * from "./types.js";
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-handler.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run all skill-runtime tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/`
Expected: PASS (all tests across all files)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/skill-handler.ts packages/core/src/skill-runtime/skill-handler.test.ts packages/core/src/skill-runtime/index.ts
git commit -m "feat: add skill handler with opportunity resolution and barrel export"
```

---

### Task 11: Prisma Migration + Deployment Routing

**Files:**

- Create: `packages/db/prisma/migrations/20260414000000_add_skill_slug/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

Add `skillSlug` field to `AgentDeployment`.

- [ ] **Step 1: Add skillSlug to schema.prisma**

In `packages/db/prisma/schema.prisma`, find the `model AgentDeployment` block (around line 797) and add after the `connectionIds` field:

```prisma
  skillSlug           String?    // When set, use skill executor instead of TypeScript handler
```

- [ ] **Step 2: Generate the migration**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:generate`

Then create the migration SQL manually:

```sql
-- packages/db/prisma/migrations/20260414000000_add_skill_slug/migration.sql
-- AlterTable
ALTER TABLE "AgentDeployment" ADD COLUMN "skillSlug" TEXT;
```

- [ ] **Step 3: Verify Prisma client generates successfully**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:generate`
Expected: Prisma client generated with `skillSlug` on `AgentDeployment`

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260414000000_add_skill_slug/
git commit -m "feat: add skillSlug field to AgentDeployment"
```

---

### Task 13: Behavioral Parity Eval Suite

**Files:**

- Create: `packages/core/src/skill-runtime/__tests__/eval-suite.test.ts`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/` (16 JSON fixtures)

The core proof that SP1 works. Each test loads a fixture, runs it through the skill executor with a `MockToolCallingAdapter`, and asserts behavioral properties. Tests are deterministic — the mock adapter returns scripted LLM responses.

- [ ] **Step 1: Create the BehavioralAssertion types and test runner**

```typescript
// packages/core/src/skill-runtime/__tests__/eval-suite.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillExecutorImpl } from "../skill-executor.js";
import { loadSkill } from "../skill-loader.js";
import { createPipelineHandoffTool } from "../tools/pipeline-handoff.js";
import type { ToolCallingAdapter } from "../tool-calling-adapter.js";
import type { SkillTool, SkillExecutionParams } from "../types.js";
import { SkillParameterError, SkillExecutionBudgetError } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "eval-fixtures");
const REPO_ROOT = join(__dirname, "../../../../..");

interface EvalFixture {
  name: string;
  parameters: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  mockResponses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
  }>;
  assertions: Array<
    | { type: "tool_called"; toolName: string; paramsMatch?: Record<string, unknown> }
    | { type: "tool_not_called"; toolName: string }
    | { type: "response_contains"; substring: string }
    | { type: "response_not_contains"; substring: string }
    | { type: "error_thrown"; errorType: string }
  >;
  trustLevel?: "supervised" | "guided" | "autonomous";
  expectError?: boolean;
}

function loadFixture(name: string): EvalFixture {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8");
  return JSON.parse(raw) as EvalFixture;
}

function createMockAdapter(fixture: EvalFixture): ToolCallingAdapter {
  let callIndex = 0;
  return {
    chatWithTools: async () => {
      const resp = fixture.mockResponses[callIndex];
      if (!resp) {
        return {
          content: [{ type: "text" as const, text: "Mock exhausted" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      callIndex++;
      return {
        content: resp.content,
        stopReason: resp.stop_reason as "end_turn" | "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

function createMockTools(): Map<string, SkillTool> {
  const tools = new Map<string, SkillTool>();
  tools.set("crm-query", {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get contact",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ id: "c1", name: "Test Lead", stage: "new" }),
      },
      "activity.list": {
        description: "List activities",
        inputSchema: { type: "object", properties: {} },
        execute: async () => [],
      },
    },
  });
  tools.set("crm-write", {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "Update stage",
        inputSchema: { type: "object", properties: {} },
        execute: async (params: unknown) => ({ ...(params as object), updated: true }),
      },
      "activity.log": {
        description: "Log activity",
        inputSchema: { type: "object", properties: {} },
        execute: async () => undefined,
      },
    },
  });
  tools.set("pipeline-handoff", createPipelineHandoffTool());
  return tools;
}

async function runFixture(fixtureName: string): Promise<void> {
  const fixture = loadFixture(fixtureName);
  const skill = loadSkill("sales-pipeline", join(REPO_ROOT, "skills"));
  const adapter = createMockAdapter(fixture);
  const tools = createMockTools();
  const executor = new SkillExecutorImpl(adapter, tools);

  const params: SkillExecutionParams = {
    skill,
    parameters: fixture.parameters,
    messages: fixture.messages,
    deploymentId: "test-deployment",
    orgId: "test-org",
    trustScore: 50,
    trustLevel: fixture.trustLevel ?? "guided",
  };

  if (fixture.expectError) {
    const errorType = fixture.assertions.find((a) => a.type === "error_thrown");
    if (errorType && errorType.type === "error_thrown") {
      const ErrorClass =
        errorType.errorType === "SkillParameterError"
          ? SkillParameterError
          : SkillExecutionBudgetError;
      await expect(executor.execute(params)).rejects.toThrow(ErrorClass);
    }
    return;
  }

  const result = await executor.execute(params);

  for (const assertion of fixture.assertions) {
    switch (assertion.type) {
      case "tool_called": {
        const found = result.toolCalls.some(
          (tc) => `${tc.toolId}.${tc.operation}` === assertion.toolName,
        );
        expect(found, `Expected tool call: ${assertion.toolName}`).toBe(true);
        break;
      }
      case "tool_not_called": {
        const found = result.toolCalls.some(
          (tc) => `${tc.toolId}.${tc.operation}` === assertion.toolName,
        );
        expect(found, `Expected no call to: ${assertion.toolName}`).toBe(false);
        break;
      }
      case "response_contains":
        expect(result.response).toContain(assertion.substring);
        break;
      case "response_not_contains":
        expect(result.response).not.toContain(assertion.substring);
        break;
    }
  }
}

describe("Behavioral Parity Eval Suite", () => {
  // Create one test per fixture file. Fixtures are created in Step 2.
  // Each fixture name maps to a scenario from the spec's eval suite.
  const fixtures = [
    "01-new-interested-lead",
    "02-qualification-flow",
    "03-stage-transition",
    "04-price-objection",
    "05-prior-context-reference",
    "06-dormant-nurture",
    "07-opt-out",
    "08-escalation",
    "09-terminal-stage",
    "10-invalid-params",
    "11-loop-budget-exceeded",
    "12-dormancy-handoff",
    "13-frustration-escalation",
    "14-message-cap-escalation",
    "15-nurture-buying-signals",
    "16-nurture-needs-qualification",
  ];

  for (const fixtureName of fixtures) {
    it(`passes: ${fixtureName}`, async () => {
      await runFixture(fixtureName);
    });
  }
});
```

- [ ] **Step 2: Create JSON fixture files**

Create 16 JSON fixtures in `packages/core/src/skill-runtime/__tests__/eval-fixtures/`. Each fixture contains: `name`, `parameters`, `messages`, `mockResponses`, `assertions`, and optional `trustLevel`/`expectError`.

Example fixture — `10-invalid-params.json`:

```json
{
  "name": "Invalid parameter - missing BUSINESS_NAME",
  "parameters": {
    "PIPELINE_STAGE": "interested",
    "OPPORTUNITY_ID": "opp1",
    "PERSONA_CONFIG": {
      "tone": "friendly",
      "qualificationCriteria": {},
      "disqualificationCriteria": {},
      "escalationRules": {}
    }
  },
  "messages": [{ "role": "user", "content": "hi" }],
  "mockResponses": [],
  "expectError": true,
  "assertions": [{ "type": "error_thrown", "errorType": "SkillParameterError" }]
}
```

Example fixture — `03-stage-transition.json`:

```json
{
  "name": "Lead becomes qualified",
  "parameters": {
    "BUSINESS_NAME": "TestBiz",
    "PIPELINE_STAGE": "interested",
    "OPPORTUNITY_ID": "opp1",
    "PERSONA_CONFIG": {
      "tone": "friendly",
      "qualificationCriteria": { "budget": "has budget" },
      "disqualificationCriteria": { "location": "wrong country" },
      "escalationRules": { "pricing": true }
    }
  },
  "messages": [
    { "role": "user", "content": "Yes I have a budget of $5000 and I'm ready to proceed" }
  ],
  "mockResponses": [
    {
      "content": [
        {
          "type": "tool_use",
          "id": "t1",
          "name": "crm-write.stage.update",
          "input": { "orgId": "test-org", "opportunityId": "opp1", "stage": "qualified" }
        }
      ],
      "stop_reason": "tool_use"
    },
    {
      "content": [
        {
          "type": "text",
          "text": "Great news! You're all set. Let me connect you with our team to finalize the details."
        }
      ],
      "stop_reason": "end_turn"
    }
  ],
  "assertions": [{ "type": "tool_called", "toolName": "crm-write.stage.update" }]
}
```

Create all 16 fixtures following the same pattern. Each fixture maps to one row in the spec's eval suite table (spec lines 754-771). The `mockResponses` script the LLM's behavior so tests are deterministic.

- [ ] **Step 3: Run eval suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/__tests__/eval-suite.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/
git commit -m "feat: add behavioral parity eval suite with 16 fixture scenarios"
```

---

### Task 14: Runtime Routing + Package Export

**Files:**

- Modify: `packages/core/package.json` (add `skill-runtime` export path)
- Modify: App bootstrap code to wire `skillSlug` routing

Wires the feature flag so `AgentDeployment.skillSlug` actually takes effect.

- [ ] **Step 1: Add skill-runtime export path to packages/core/package.json**

In `packages/core/package.json`, add to the `"exports"` object:

```json
"./skill-runtime": {
  "types": "./dist/skill-runtime/index.d.ts",
  "import": "./dist/skill-runtime/index.js"
}
```

- [ ] **Step 2: Write the deployment handler factory**

This is the routing logic from the spec. It goes in the app bootstrap layer where deployments are created. Find the existing code that constructs `AgentRuntime` instances per deployment (likely in `apps/api/` or `apps/chat/` bootstrap). Add a routing function:

```typescript
// Add to the deployment bootstrapper:
import {
  loadSkill,
  SkillExecutorImpl,
  SkillHandler,
  AnthropicToolCallingAdapter,
} from "@switchboard/core/skill-runtime";
import {
  createCrmQueryTool,
  createCrmWriteTool,
  createPipelineHandoffTool,
} from "@switchboard/core/skill-runtime";
import Anthropic from "@anthropic-ai/sdk";

const SKILLS_DIR = join(process.cwd(), "skills");

function createHandlerForDeployment(
  deployment: { skillSlug: string | null; listingId: string },
  stores: {
    contactStore: PrismaContactStore;
    opportunityStore: PrismaOpportunityStore;
    activityStore: PrismaActivityLogStore;
  },
  config: { deploymentId: string; orgId: string; contactId: string },
): AgentHandler {
  if (deployment.skillSlug) {
    const skill = loadSkill(deployment.skillSlug, SKILLS_DIR);
    const anthropicClient = new Anthropic();
    const adapter = new AnthropicToolCallingAdapter(anthropicClient);
    const tools = new Map([
      ["crm-query", createCrmQueryTool(stores.contactStore, stores.activityStore)],
      ["crm-write", createCrmWriteTool(stores.opportunityStore, stores.activityStore)],
      ["pipeline-handoff", createPipelineHandoffTool()],
    ]);
    const executor = new SkillExecutorImpl(adapter, tools);
    return new SkillHandler(skill, executor, stores, config);
  }
  // Legacy path — existing TypeScript handler lookup
  return handlerRegistry.get(deployment.listingId);
}
```

The exact file and location depends on how the app currently bootstraps deployments. Search for existing `AgentRuntime` construction to find the right insertion point.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire skillSlug routing in deployment bootstrapper"
```

---

### Task 15: Executor Budget Enforcement (Token + Timeout)

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.test.ts`

Add the two missing operational limits from the spec: 64K token prompt size and 30s runtime timeout.

- [ ] **Step 1: Write the failing tests**

Add to `skill-executor.test.ts`:

```typescript
it("enforces runtime timeout", async () => {
  // Create an adapter that takes 35 seconds to respond
  const slowAdapter: ToolCallingAdapter = {
    chatWithTools: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      return {
        content: [{ type: "text" as const, text: "too slow" }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };

  const executor = new SkillExecutorImpl(slowAdapter, new Map());
  await expect(
    executor.execute({
      skill: mockSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "hi" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    }),
  ).rejects.toThrow(SkillExecutionBudgetError);
}, 40_000);

it("enforces token budget", async () => {
  // Create an adapter that reports huge token usage
  const bigAdapter: ToolCallingAdapter = {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text: "x" }],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 65_000, outputTokens: 1000 },
    }),
  };

  const toolSkill: SkillDefinition = {
    ...mockSkill,
    tools: ["test-tool"],
    body: "Use test-tool.do {{NAME}}",
  };
  const mockTool: SkillTool = {
    id: "test-tool",
    operations: {
      do: {
        description: "do",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({}),
      },
    },
  };

  const executor = new SkillExecutorImpl(bigAdapter, new Map([["test-tool", mockTool]]));
  await expect(
    executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "hi" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    }),
  ).rejects.toThrow(SkillExecutionBudgetError);
});
```

- [ ] **Step 2: Add the limits to the executor**

In `skill-executor.ts`, add constants and checks:

```typescript
const MAX_TOTAL_TOKENS = 64_000;
const MAX_RUNTIME_MS = 30_000;
```

In the `execute()` method:

- At the start: `const startTime = Date.now();`
- After each LLM response, check: `if (totalInputTokens + totalOutputTokens > MAX_TOTAL_TOKENS) { throw new SkillExecutionBudgetError(...) }`
- Before each LLM call, check: `if (Date.now() - startTime > MAX_RUNTIME_MS) { throw new SkillExecutionBudgetError(...) }`
- Wrap the adapter call with `Promise.race()` against a timeout:

```typescript
const timeoutMs = MAX_RUNTIME_MS - (Date.now() - startTime);
if (timeoutMs <= 0) throw new SkillExecutionBudgetError("Exceeded 30s runtime limit");
const response = await Promise.race([
  this.adapter.chatWithTools({ system, messages, tools: anthropicTools }),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new SkillExecutionBudgetError("Exceeded 30s runtime limit")),
      timeoutMs,
    ),
  ),
]);
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat: add token budget and runtime timeout enforcement to executor"
```

---

### Task 12: Typecheck + Lint + Full Test Suite

**Files:**

- No new files — verification only

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`
Expected: PASS (fix any lint issues)

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS (including all existing tests + new skill-runtime tests)

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "fix: resolve lint/type issues from skill-runtime integration"
```

---

### Summary

| Task      | What It Builds               | Files Created | Tests         |
| --------- | ---------------------------- | ------------- | ------------- |
| 1         | Types + governance policy    | 2             | 5             |
| 2         | Template engine              | 2             | 11            |
| 3         | Skill loader + validation    | 2             | 10            |
| 4         | Sales pipeline skill file    | 1 (+1 test)   | 1             |
| 5         | Pipeline handoff tool        | 2             | 9             |
| 6         | CRM tools (query + write)    | 5             | 10            |
| 7         | Governance injector          | 2             | 5             |
| 8         | Tool-calling adapter         | 2             | 2             |
| 9         | Skill executor               | 2             | 5             |
| 10        | Skill handler + barrel       | 3             | 3             |
| 11        | Prisma migration             | 2             | 0             |
| 12        | Integration verification     | 0             | 0             |
| 13        | Behavioral parity eval suite | 17            | 16            |
| 14        | Runtime routing + export     | 2 (modify)    | 0             |
| 15        | Token/timeout budget         | 2 (modify)    | 2             |
| **Total** |                              | **~30 files** | **~79 tests** |

Tasks 1-10 are the skill runtime. Task 11 is the database change. Tasks 13-15 are the proof layer (evals, routing, budgets). Task 12 is final verification. Each task is independently committable and testable.
