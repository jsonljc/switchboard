import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolverCase } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo-root-relative path to the human-read resolver doc. */
export const DEFAULT_RESOLVER_MD_PATH = join(__dirname, "..", "..", ".agent", "RESOLVER.md");

/** Read the resolver doc (thin wrapper so callers/tests can inject their own content). */
export function loadResolverMarkdown(path: string = DEFAULT_RESOLVER_MD_PATH): string {
  return readFileSync(path, "utf-8");
}

/**
 * Extract the set of documented routing targets from RESOLVER.md.
 *
 * HONEST FRAMING: there is NO programmatic resolver in this codebase.
 * `.agent/RESOLVER.md` is a doc a human or agent reads, so this extraction does NOT
 * simulate routing and does NOT measure routing accuracy. It pins one machine-checkable
 * FACT: each documented route names a skill via a `.agent/skills/<slug>/SKILL.md` load
 * path, and that `<slug>` is the stable token the dataset's `expected_skill` values must
 * match. A file path is a far more robust anchor than a prose heading, so headings are
 * deliberately not parsed.
 */
const SKILL_PATH_RE = /\.agent\/skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md/g;

export function extractRouteTargets(resolverMarkdown: string): Set<string> {
  const targets = new Set<string>();
  for (const match of resolverMarkdown.matchAll(SKILL_PATH_RE)) {
    const slug = match[1];
    if (slug) targets.add(slug);
  }
  return targets;
}

export interface ConsistencyReport {
  /** A case whose expected_skill is not a documented target. Non-empty ⇒ drift ⇒ exit 1. */
  mismatches: string[];
  /** Documented targets that at least one case exercises (sorted). */
  covered: string[];
  /** Documented targets no case exercises (sorted) - informational under-coverage, not drift. */
  uncovered: string[];
}

/**
 * Deterministic drift guard. Asserts every case's `expected_skill` is a real
 * documented route target; a case pointing at an undocumented or renamed slug is a
 * MISMATCH (the drift we block on). Also reports which documented targets are and are
 * not exercised (coverage is informational and never blocks).
 */
export function checkDatasetConsistency(
  cases: ReadonlyArray<ResolverCase>,
  targets: ReadonlySet<string>,
): ConsistencyReport {
  const mismatches: string[] = [];
  const exercised = new Set<string>();
  cases.forEach((c, i) => {
    if (targets.has(c.expected_skill)) {
      exercised.add(c.expected_skill);
    } else {
      mismatches.push(
        `case[${i}] expected_skill "${c.expected_skill}" is not a documented ` +
          `RESOLVER.md target (input: "${truncate(c.input)}")`,
      );
    }
  });
  const covered = [...exercised].sort();
  const uncovered = [...targets].filter((t) => !exercised.has(t)).sort();
  return { mismatches, covered, uncovered };
}

/** Shorten a task input for a one-line report row. */
export function truncate(text: string, max = 64): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
