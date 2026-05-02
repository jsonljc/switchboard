import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "server.ts");

describe("API bootstrap smoke (B3)", () => {
  it("exits 1 with an actionable error when DATABASE_URL is unset", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.NEXTAUTH_SECRET;

    const result = spawnSync("npx", ["tsx", SERVER_ENTRY], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).toContain("worktree:init");
  }, 20_000);
});
