import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ContextRequirementSchema, ReferenceMetadataSchema } from "@switchboard/schemas";
import type { ContextRequirement } from "@switchboard/schemas";
import { SkillParseError, SkillValidationError } from "./types.js";
import type { SkillDefinition, ParameterDeclaration, SkillReferenceFile } from "./types.js";

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
  items: z.object({ type: z.string() }).optional(),
});

const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  parameters: z.array(ParameterDeclarationSchema),
  tools: z.array(z.string()),
  minimumModelTier: z.enum(["default", "premium", "critical"]).optional(),
  intent: z.string().optional(),
  output: z
    .object({
      fields: z.array(OutputFieldSchema),
    })
    .optional(),
  context: z
    .array(
      z.object({
        kind: z.string(),
        scope: z.string(),
        inject_as: z.string(),
        required: z.boolean().default(true),
      }),
    )
    .default([]),
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

function validateContext(
  rawContext: Array<{ kind: string; scope: string; inject_as: string; required: boolean }>,
): { normalized: ContextRequirement[]; issues: string[] } {
  const issues: string[] = [];
  const normalized: ContextRequirement[] = [];
  const injectAsNames = new Set<string>();

  for (const entry of rawContext) {
    const req = {
      kind: entry.kind,
      scope: entry.scope,
      injectAs: entry.inject_as,
      required: entry.required,
    };
    const parsed = ContextRequirementSchema.safeParse(req);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((i) => `context[${entry.inject_as}]: ${i.message}`));
      continue;
    }

    if (injectAsNames.has(parsed.data.injectAs)) {
      issues.push(`Duplicate injectAs value: ${parsed.data.injectAs}`);
    }
    injectAsNames.add(parsed.data.injectAs);
    normalized.push(parsed.data);
  }

  return { normalized, issues };
}

function loadReferences(skillDir: string): SkillReferenceFile[] | undefined {
  const referencesRoot = join(skillDir, "references");
  if (!existsSync(referencesRoot)) {
    return undefined;
  }

  const files: SkillReferenceFile[] = [];

  function walk(dir: string): void {
    // Deterministic ordering — readdirSync order is platform/inode-dependent
    // and produces flaky tests / noisy diffs without explicit sort.
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md")) {
        const raw = readFileSync(full, "utf-8");
        const split = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!split) {
          throw new SkillParseError(`Reference file ${full} missing YAML frontmatter`);
        }
        const [, fm, body] = split;
        let parsed: unknown;
        try {
          parsed = parseYaml(fm!);
        } catch (err) {
          throw new SkillParseError(
            `Reference file ${full} has invalid YAML: ${(err as Error).message}`,
          );
        }
        const result = ReferenceMetadataSchema.safeParse(parsed);
        if (!result.success) {
          throw new SkillValidationError(
            `Reference ${full} failed validation: ${JSON.stringify(result.error.issues)}`,
            result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          );
        }
        // Normalize to POSIX-style forward slashes so paths are stable
        // across host OS (matters if CI ever runs on Windows).
        const posixPath = relative(skillDir, full).split(sep).join("/");
        files.push({
          path: posixPath,
          metadata: result.data,
          body: body!,
        });
      }
    }
  }

  walk(referencesRoot);
  // Final sort by path so the returned array is fully deterministic
  // regardless of recursion order.
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function loadSkill(slug: string, skillsDir: string): SkillDefinition {
  const dirSkillPath = join(skillsDir, slug, "SKILL.md");
  const fileSkillPath = join(skillsDir, `${slug}.md`);

  let skillPath: string;
  let references: SkillReferenceFile[] | undefined;
  if (existsSync(dirSkillPath)) {
    skillPath = dirSkillPath;
    references = loadReferences(join(skillsDir, slug));
  } else if (existsSync(fileSkillPath)) {
    skillPath = fileSkillPath;
  } else {
    throw new SkillParseError(`Skill "${slug}" not found at ${dirSkillPath} or ${fileSkillPath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(skillPath, "utf-8");
  } catch {
    throw new SkillParseError(`Skill file not found: ${skillPath}`);
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

  const { normalized: context, issues: contextIssues } = validateContext(frontmatter.context);
  issues.push(...contextIssues);

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
    context,
    minimumModelTier: frontmatter.minimumModelTier,
    intent: frontmatter.intent,
    references,
  };
}
