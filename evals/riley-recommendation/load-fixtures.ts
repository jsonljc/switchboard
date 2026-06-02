import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RileyCaseSchema, type RileyCase } from "./schema.js";

/**
 * Load every `*.jsonl` riley case directly under `dir` (no recursion).
 * Mirrors the loader convention of the other eval harnesses: one JSON object per
 * line, `#` comment lines and blank lines skipped, duplicate ids rejected.
 */
export function loadRileyCases(dir: string): RileyCase[] {
  const rows: RileyCase[] = [];
  const seen = new Set<string>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const fullPath = join(dir, file);
    const lines = readFileSync(fullPath, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (e) {
        throw new Error(`${file}:${i + 1} — invalid JSON: ${(e as Error).message}`);
      }
      const parsed = RileyCaseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}:${i + 1} — schema violation: ${parsed.error.message}`);
      }
      if (seen.has(parsed.data.id)) {
        throw new Error(`duplicate case id: ${parsed.data.id}`);
      }
      seen.add(parsed.data.id);
      rows.push(parsed.data);
    }
  }
  return rows;
}
