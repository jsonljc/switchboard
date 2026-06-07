import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/db/src/seed/__tests__ -> packages/db
const DB_ROOT = join(__dirname, "..", "..", "..");

function seedFiles(): string[] {
  const out: string[] = [];
  const prismaDir = join(DB_ROOT, "prisma");
  if (existsSync(prismaDir)) {
    for (const f of readdirSync(prismaDir)) {
      if (f.startsWith("seed") && f.endsWith(".ts") && !f.endsWith(".d.ts"))
        out.push(join(prismaDir, f));
    }
  }
  const seedDir = join(DB_ROOT, "src", "seed");
  if (existsSync(seedDir)) {
    for (const f of readdirSync(seedDir)) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
        out.push(join(seedDir, f));
    }
  }
  return out;
}

// A seed file that writes one of these models must stamp origin explicitly (R4).
const MODEL_WRITE =
  /\.(booking|conversionRecord|lifecycleRevenueEvent)\.(create|createMany|upsert)\b/;

describe("seed origin stamping guard (R4)", () => {
  it("every seed file that creates booking/conversionRecord/lifecycleRevenueEvent stamps origin explicitly", () => {
    const offenders: string[] = [];
    for (const path of seedFiles()) {
      const src = readFileSync(path, "utf8");
      if (MODEL_WRITE.test(src) && !/origin\s*:/.test(src)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("actually discovered seed files to scan (guard is not silently empty)", () => {
    expect(seedFiles().length).toBeGreaterThan(0);
  });
});
