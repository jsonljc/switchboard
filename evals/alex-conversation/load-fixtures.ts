import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConversationFixtureSchema, type ConversationFixture } from "./schema.js";

export function loadConversationFixtures(dir: string): ConversationFixture[] {
  const rows: ConversationFixture[] = [];
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
      const parsed = ConversationFixtureSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}:${i + 1} — schema violation: ${parsed.error.message}`);
      }
      if (seen.has(parsed.data.id)) {
        throw new Error(`duplicate fixture id: ${parsed.data.id}`);
      }
      seen.add(parsed.data.id);
      rows.push(parsed.data);
    }
  }
  return rows;
}
