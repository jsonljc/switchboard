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

const OutputFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "enum", "array"]),
  required: z.boolean(),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  items: z.record(z.string()).optional(),
});

const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  parameters: z.array(ParameterDeclarationSchema),
  tools: z.array(z.string()),
  output: z
    .object({
      fields: z.array(OutputFieldSchema),
    })
    .optional(),
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

  issues.push(...validateParameters(frontmatter.parameters));

  if (!body.trim()) {
    issues.push("Skill body must not be empty");
  }

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
    output: frontmatter.output,
  };
}
