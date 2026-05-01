#!/usr/bin/env npx tsx
/**
 * Validates a findings markdown file against the rules in
 * docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md §13.2.
 *
 * Usage: tsx scripts/audit-validate-findings.ts <findings.md>
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SEVERITIES = new Set(["Launch-blocker", "High", "Medium", "Low", "Defer"]);
const DIMENSIONS = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "I-light", "J"]);
const STATUS_PATTERNS = [
  /^Open$/,
  /^Accepted \(ship-with(, .+)?\)$/,
  /^Fixed \(PR #\d+\)$/,
  /^False positive(.+)?$/,
];
const REQUIRED_FIELDS = [
  "Surface",
  "Sub-surface",
  "Dimension",
  "Severity",
  "Affects",
  "Status",
  "Discovered-at",
  "Effort",
];
const PLACEHOLDER_REGEX = /<[^>]*>/;

interface Finding {
  id: string;
  fields: Record<string, string>;
  evidenceTypes: Set<"File" | "Screenshot" | "Repro">;
  rawBlock: string;
}

export interface ValidationResult {
  errors: string[];
}

function parseFindings(doc: string): Finding[] {
  const findings: Finding[] = [];
  const blocks = doc.split(/^## (?=[A-Z]{2}-\d+)/m).slice(1);
  for (const block of blocks) {
    const idMatch = block.match(/^([A-Z]{2}-\d+)/);
    if (!idMatch || !idMatch[1]) continue;
    const id = idMatch[1];
    const fields: Record<string, string> = {};
    for (const field of REQUIRED_FIELDS) {
      const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*([^\\n]+)`);
      const m = block.match(re);
      if (m && m[1]) fields[field] = m[1].trim();
    }
    const evidenceMatch = block.match(/\*\*Evidence:\*\*([\s\S]*?)(?=\n\*\*Fix:\*\*|$)/);
    const evidenceTypes = new Set<"File" | "Screenshot" | "Repro">();
    if (evidenceMatch && evidenceMatch[1]) {
      const evidenceBody = evidenceMatch[1];
      // Allow optional leading whitespace before each bullet (handles 2-space-indented evidence blocks).
      if (/^\s*- File:/m.test(evidenceBody)) evidenceTypes.add("File");
      if (/^\s*- Screenshot:/m.test(evidenceBody)) evidenceTypes.add("Screenshot");
      if (/^\s*- Repro:/m.test(evidenceBody)) evidenceTypes.add("Repro");
    }
    findings.push({ id, fields, evidenceTypes, rawBlock: block });
  }
  return findings;
}

function shaExists(sha: string): boolean {
  try {
    execSync(`git rev-parse --verify ${sha}^{commit}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function validateFindings(doc: string, opts: { checkSha?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  const findings = parseFindings(doc);

  // Detect headings that *look* like finding IDs but didn't match the canonical
  // `## <PREFIX>-<NN>` form (PREFIX = two uppercase letters). Without this pass,
  // drifts like `## dc-01` or `## DCO-01` would silently produce zero findings.
  const parsedIds = new Set(findings.map((f) => f.id));
  const headingPattern = /^## ([A-Za-z]{2,4}-?\d+\w*)/gm;
  const seenHeadings = new Set<string>();
  let h: RegExpExecArray | null;
  while ((h = headingPattern.exec(doc)) !== null) {
    const heading = h[1];
    if (!heading || seenHeadings.has(heading)) continue;
    seenHeadings.add(heading);
    const isCanonical = /^[A-Z]{2}-\d+$/.test(heading);
    if (!isCanonical && !parsedIds.has(heading)) {
      errors.push(
        `Heading "## ${heading}" looks like a finding ID but doesn't match the required form "## <PREFIX>-<NN>" (PREFIX is two uppercase letters, e.g., DC, DS, MK).`,
      );
    }
  }

  // Detect duplicate finding IDs. The parser splits cleanly on each heading so
  // duplicates produce two parsed Finding entries with the same id; the rollup
  // downstream would otherwise conflate them.
  const seenIds = new Set<string>();
  for (const f of findings) {
    if (seenIds.has(f.id)) {
      errors.push(`${f.id}: duplicate finding ID — IDs must be unique within a surface`);
    } else {
      seenIds.add(f.id);
    }
  }

  if (findings.length === 0) {
    // Empty findings docs are valid — surface may have no findings.
    // (Orphan-heading errors above still surface if any exist.)
    return { errors };
  }
  for (const f of findings) {
    for (const field of REQUIRED_FIELDS) {
      if (!f.fields[field]) {
        errors.push(`${f.id}: missing required field "${field}"`);
        continue;
      }
      if (PLACEHOLDER_REGEX.test(f.fields[field])) {
        errors.push(`${f.id}: placeholder left in field "${field}" (value: ${f.fields[field]})`);
      }
    }
    const sev = f.fields.Severity;
    if (sev && !SEVERITIES.has(sev)) {
      errors.push(`${f.id}: unknown Severity "${sev}"`);
    }
    const dim = f.fields.Dimension;
    if (dim) {
      const codes = dim.split(",").map((s) => s.trim());
      for (const code of codes) {
        if (!DIMENSIONS.has(code)) {
          errors.push(`${f.id}: unknown Dimension "${code}"`);
        }
      }
    }
    const status = f.fields.Status;
    if (status && !STATUS_PATTERNS.some((p) => p.test(status))) {
      errors.push(`${f.id}: unknown Status "${status}"`);
    }
    if (sev === "Launch-blocker") {
      if (f.evidenceTypes.size < 2) {
        errors.push(
          `${f.id}: Launch-blocker requires ≥2 evidence types (has ${f.evidenceTypes.size})`,
        );
      }
      if (!f.evidenceTypes.has("File") && !f.evidenceTypes.has("Repro")) {
        errors.push(`${f.id}: Launch-blocker evidence must include File or Repro`);
      }
    } else if (sev === "High" || sev === "Medium") {
      if (f.evidenceTypes.size < 1) {
        errors.push(`${f.id}: ${sev} severity requires ≥1 evidence type`);
      }
    }
    if (opts.checkSha && f.fields["Discovered-at"]) {
      const sha = f.fields["Discovered-at"];
      if (sha !== "HEAD" && !shaExists(sha)) {
        errors.push(`${f.id}: Discovered-at SHA "${sha}" does not exist in repo`);
      }
    }
  }
  return { errors };
}

// CLI entry point — only runs when this file is the script being executed,
// not when imported by tests.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: tsx scripts/audit-validate-findings.ts <findings.md>");
    process.exit(2);
  }
  const file = argv[0];
  if (!file) {
    console.error("Usage: tsx scripts/audit-validate-findings.ts <findings.md>");
    process.exit(2);
  }
  const doc = readFileSync(file, "utf8");
  const result = validateFindings(doc, { checkSha: true });
  if (result.errors.length > 0) {
    console.error(`Validation failed for ${file}:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const findingCount = doc.match(/^## [A-Z]{2}-\d+/gm)?.length ?? 0;
  console.warn(`OK: ${file} (${findingCount} findings)`);
}
