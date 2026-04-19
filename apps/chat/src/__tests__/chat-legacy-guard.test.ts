import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const SRC_DIR = resolve(import.meta.dirname, "..");

const DELETED_MODULES = [
  "runtime.ts",
  "bootstrap.ts",
  "managed-runtime.ts",
  "api-orchestrator-adapter.ts",
  "message-pipeline.ts",
];

describe("chat legacy guard", () => {
  for (const mod of DELETED_MODULES) {
    it(`${mod} does not exist`, () => {
      expect(existsSync(resolve(SRC_DIR, mod))).toBe(false);
    });
  }

  it("no source file imports deleted modules", () => {
    const patterns = [
      /from\s+["']\.\/runtime/,
      /from\s+["']\.\/bootstrap/,
      /from\s+["']\.\/managed-runtime/,
      /from\s+["']\.\/api-orchestrator-adapter/,
      /from\s+["']\.\/message-pipeline/,
    ];

    // Walk src/ for .ts files, excluding __tests__ and node_modules
    function walkTs(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "__tests__" && entry.name !== "node_modules") {
          results.push(...walkTs(full));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
          results.push(full);
        }
      }
      return results;
    }

    const files = walkTs(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of patterns) {
        expect(content, `${file} imports deleted module`).not.toMatch(pattern);
      }
    }
  });
});
