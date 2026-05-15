import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const SCRIPT = "scripts/check-seed-counts.ts";

describe("check-seed-counts", () => {
  it("skips with exit 0 when DATABASE_URL is unset (offline-friendly)", () => {
    const env = { ...process.env };
    delete env["DATABASE_URL"];
    const result = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skipping seed-count check/);
  }, 30_000);
});
