import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStartupChecks } from "./startup-checks.js";

describe("runStartupChecks: INTERNAL_API_SECRET (F-15)", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t"); // satisfy the channel check
  });
  afterEach(() => vi.unstubAllEnvs());

  it("errors when DATABASE_URL is set but INTERNAL_API_SECRET is empty (managed mode)", () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(true);
  });

  it("passes when DATABASE_URL and INTERNAL_API_SECRET are both set", () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });

  it("does not require the secret when there is no database (non-managed dev mode)", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });
});
