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

  it("refuses to boot in production when ALLOW_SELF_APPROVAL is unacknowledged (F7)", () => {
    // Dummy DATABASE_URL/NEXTAUTH_SECRET satisfy assertRequiredEnv so we reach
    // buildServer; the self-approval guard is buildServer's first statement and
    // throws before any DB connection, so the dummy URL is never dialed. This
    // proves a real production boot fails fast on the unacknowledged flag.
    const result = spawnSync("npx", ["tsx", SERVER_ENTRY], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        NEXTAUTH_SECRET: "test-secret",
        ALLOW_SELF_APPROVAL: "true",
        // No acknowledgement: the guard must refuse the boot. Explicit
        // undefined keeps the child env free of any inherited ack value.
        ALLOW_SELF_APPROVAL_IN_PRODUCTION: undefined,
      },
      encoding: "utf8",
      timeout: 15_000,
    });

    // Exit code 1 (not just any non-zero): the guard throws synchronously at
    // buildServer's first line, which exits 1 via Node's default unhandled-
    // rejection termination. Asserting 1 (rather than not-0) also fails if the
    // boot ever hangs to the timeout (spawnSync would report status null).
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ALLOW_SELF_APPROVAL_IN_PRODUCTION");
  }, 20_000);
});
