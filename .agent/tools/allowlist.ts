import { readFileSync } from "fs";
import { parse } from "yaml";
import micromatch from "micromatch";

export interface AllowlistEntry {
  path: string;
  reason: string;
}

export function loadAllowlist(filePath: string): AllowlistEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Allowlist at ${filePath} must be a YAML list of entries.`);
  }

  return parsed.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Allowlist entry ${idx} is not an object.`);
    }
    const path = (entry as { path?: unknown }).path;
    const reason = (entry as { reason?: unknown }).reason;

    if (typeof path !== "string" || !path.trim()) {
      throw new Error(`Allowlist entry ${idx} is missing a non-empty 'path' field.`);
    }
    if (typeof reason !== "string" || !reason.trim()) {
      throw new Error(
        `Allowlist entry ${idx} (path=${path}) is missing a non-empty 'reason' field. Reason is required for every allowlist entry.`,
      );
    }
    return { path, reason };
  });
}

export function isAllowlisted(filePath: string, entries: AllowlistEntry[]): boolean {
  return entries.some((entry) => micromatch.isMatch(filePath, entry.path));
}

const TEMP_PREFIX = "Temporarily justified:";
const ISSUE_REF_PATTERN = /#\d+/;

/**
 * For any entry whose `reason` starts with `Temporarily justified:`, the
 * reason itself (not a YAML comment above the entry) must cite a `#NNN`
 * GitHub issue. Returns one error message per offending entry; empty array
 * when all temporary entries comply.
 */
export function validateTemporaryEntries(entries: AllowlistEntry[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.reason.startsWith(TEMP_PREFIX)) continue;
    if (ISSUE_REF_PATTERN.test(entry.reason)) continue;
    errors.push(
      `Temporary allowlist entry for "${entry.path}" must cite an open issue (e.g., #562) in its reason field.`,
    );
  }
  return errors;
}
