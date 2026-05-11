#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { ReferenceMetadataSchema } from "@switchboard/schemas";

const SKILLS_DIR = join(process.cwd(), "skills");
const STALE_DAYS = 180;
const today = new Date();

let warnings = 0;
let errors = 0;

function walk(dir) {
  // Deterministic order: matches loader's reference discovery.
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (
      entry.endsWith(".md") &&
      full.includes(`${sep}references${sep}`)
    ) {
      auditOne(full);
    }
  }
}

function auditOne(path) {
  const display = relative(process.cwd(), path).split(sep).join("/");
  const raw = readFileSync(path, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) {
    console.error(`ERROR: ${display} missing YAML frontmatter`);
    errors++;
    return;
  }

  let parsed;
  try {
    parsed = parseYaml(m[1]);
  } catch (e) {
    console.error(`ERROR: ${display} frontmatter not valid YAML: ${e.message}`);
    errors++;
    return;
  }

  // Reuse the same Zod schema the loader uses. One contract, not two.
  const result = ReferenceMetadataSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `ERROR: ${display} fails ReferenceMetadataSchema: ` +
        JSON.stringify(result.error.issues),
    );
    errors++;
    return;
  }
  const fm = result.data;

  // Policy: staleness
  const reviewed = new Date(fm.lastReviewedAt);
  const ageDays = (today - reviewed) / (1000 * 60 * 60 * 24);
  if (ageDays > STALE_DAYS) {
    console.warn(
      `WARN: ${display} lastReviewedAt ${fm.lastReviewedAt} is ` +
        `${Math.round(ageDays)} days old (>${STALE_DAYS})`,
    );
    warnings++;
  }

  // Policy: critical riskLevel requires at least one source
  if (fm.riskLevel === "critical" && (!fm.sources || fm.sources.length === 0)) {
    console.error(
      `ERROR: ${display} riskLevel=critical requires at least one entry in sources`,
    );
    errors++;
  }
}

if (!existsSync(SKILLS_DIR)) {
  console.log("No skills/ directory; skipping reference audit");
  process.exit(0);
}

walk(SKILLS_DIR);

console.log(`Reference audit: ${warnings} warnings, ${errors} errors`);
process.exit(errors > 0 ? 1 : 0);
