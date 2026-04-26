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
