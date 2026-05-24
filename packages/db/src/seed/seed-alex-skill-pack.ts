import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { KnowledgeKind } from "@prisma/client";

/**
 * Strips the leading YAML frontmatter block (--- ... ---) from a markdown
 * string and returns the trimmed body. The body has no other --- delimiters,
 * so a simple regex on the first fenced block is safe.
 *
 * We intentionally do NOT import splitFrontmatter from @switchboard/core
 * because that function is private (not exported from core's public index).
 */
function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    return match[1]!.trim();
  }
  // No frontmatter found — return as-is trimmed
  return raw.trim();
}

export interface SkillPackScope {
  kind: KnowledgeKind;
  scope: string;
  file: string;
  title: string;
}

export const ALEX_SKILL_PACK_SCOPES: SkillPackScope[] = [
  {
    kind: KnowledgeKind.playbook,
    scope: "objection-handling",
    file: "objection-handling.md",
    title: "Medspa objection handling",
  },
  {
    kind: KnowledgeKind.playbook,
    scope: "qualification-framework",
    file: "qualification-framework.md",
    title: "Medspa qualification framework",
  },
  {
    kind: KnowledgeKind.policy,
    scope: "claim-boundaries",
    file: "claim-boundaries.md",
    title: "Medspa claim boundaries (system-owned)",
  },
];

/**
 * Walk up the directory tree from `start` until a directory containing
 * `pnpm-workspace.yaml` is found. Returns that directory as the repo root.
 * Throws a clear error if no marker is found before the filesystem root.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== parse(dir).root) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    `seed-alex-skill-pack: could not locate repo root (pnpm-workspace.yaml) from ${start}`,
  );
}

/**
 * Default refs directory: resolved by walking up to the repo root marker
 * (`pnpm-workspace.yaml`) from wherever this file lives. Works correctly in
 * both the source tree (`packages/db/src/seed/`) and the built package
 * (`packages/db/dist/src/seed/`) without needing a fixed number of `../`
 * levels.
 */
function defaultRefsDir(): string {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  return join(repoRoot, "skills", "alex", "references", "medspa");
}

/**
 * Seeds KnowledgeEntry rows for the medspa skill-pack at version 1.
 *
 * Operator safety: the `update` branch refreshes `title` and `content` only.
 * It does NOT touch `active` — an operator may have deactivated v1 and
 * promoted a v2; we must leave that alone.
 *
 * @param prisma  A PrismaClient (or compatible mock).
 * @param orgId   The organization to seed into.
 * @param refsDir Override the directory that contains the .md files.
 *                Defaults to the canonical skills/alex/references/medspa path.
 */
export async function seedAlexSkillPack(
  prisma: PrismaClient,
  orgId: string,
  refsDir?: string,
): Promise<void> {
  const dir = refsDir ?? defaultRefsDir();

  for (const entry of ALEX_SKILL_PACK_SCOPES) {
    const raw = readFileSync(join(dir, entry.file), "utf-8");
    const content = stripFrontmatter(raw);

    await prisma.knowledgeEntry.upsert({
      where: {
        organizationId_kind_scope_version: {
          organizationId: orgId,
          kind: entry.kind,
          scope: entry.scope,
          version: 1,
        },
      },
      update: {
        title: entry.title,
        content,
        // Intentionally NOT touching `active` — operator override must survive
        // a re-seed (e.g. operator deactivated v1 and activated v2).
      },
      create: {
        organizationId: orgId,
        kind: entry.kind,
        scope: entry.scope,
        title: entry.title,
        content,
        version: 1,
        active: true,
        priority: 0,
      },
    });
  }
}
