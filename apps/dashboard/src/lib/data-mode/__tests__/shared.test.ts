import { describe, it, expect } from "vitest";
import { resolveDataMode, isFixtureModeAllowed } from "../shared";

describe("resolveDataMode", () => {
  const allowedEnv = { NODE_ENV: "development" };
  const deniedEnv = { NODE_ENV: "production", VERCEL_ENV: "production" };

  it("returns 'demo' for cookie='demo' when allowed", () => {
    expect(resolveDataMode("demo", allowedEnv)).toBe("demo");
  });

  it("returns 'live' for cookie='live' when allowed", () => {
    expect(resolveDataMode("live", allowedEnv)).toBe("live");
  });

  it("returns 'live' when cookie is undefined", () => {
    expect(resolveDataMode(undefined, allowedEnv)).toBe("live");
  });

  it("returns 'live' for unknown cookie values", () => {
    expect(resolveDataMode("garbage", allowedEnv)).toBe("live");
  });

  it("returns 'live' for empty string cookie", () => {
    expect(resolveDataMode("", allowedEnv)).toBe("live");
  });

  it("returns 'live' for cookie='demo' when fixture mode is denied", () => {
    expect(resolveDataMode("demo", deniedEnv)).toBe("live");
  });

  it("returns 'live' for cookie='live' when fixture mode is denied", () => {
    expect(resolveDataMode("live", deniedEnv)).toBe("live");
  });
});

describe("isFixtureModeAllowed", () => {
  it("REGRESSION: VERCEL_ENV=production hard-denies even with ALLOW_FIXTURE_DATA_MODE=true", () => {
    // This is the safety-critical regression test. If this fails, a misconfigured
    // production deployment could expose demo data.
    expect(
      isFixtureModeAllowed({
        VERCEL_ENV: "production",
        ALLOW_FIXTURE_DATA_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("denies on VERCEL_ENV=production without explicit opt-in", () => {
    expect(isFixtureModeAllowed({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
  });

  it("allows on Vercel preview with explicit opt-in", () => {
    expect(
      isFixtureModeAllowed({
        VERCEL_ENV: "preview",
        ALLOW_FIXTURE_DATA_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });

  it("denies on Vercel preview without explicit opt-in", () => {
    expect(isFixtureModeAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });

  it("allows on non-Vercel staging with explicit opt-in", () => {
    expect(isFixtureModeAllowed({ ALLOW_FIXTURE_DATA_MODE: "true", NODE_ENV: "production" })).toBe(
      true,
    );
  });

  it("denies on non-Vercel production without opt-in", () => {
    expect(isFixtureModeAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows on local development", () => {
    expect(isFixtureModeAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("allows when env is entirely empty (local dev default)", () => {
    expect(isFixtureModeAllowed({})).toBe(true);
  });
});
