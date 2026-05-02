import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "server.ts");

describe("API bootstrap DB sanity (B4)", () => {
  it("exits 1 with an actionable error when DATABASE_URL is set but DB is unreachable", () => {
    const result = spawnSync("npx", ["tsx", SERVER_ENTRY], {
      env: {
        ...process.env,
        // Port 1 is reserved + always closed — instant ECONNREFUSED.
        DATABASE_URL: "postgresql://nobody:nobody@127.0.0.1:1/nope",
        NEXTAUTH_SECRET: "test-secret",
      },
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("not reachable");
    expect(result.stderr).toContain("worktree:init");
  }, 25_000);
});
