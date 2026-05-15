import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("chat sentry bootstrap", () => {
  // vi.stubEnv (instead of direct process.env mutation) keeps env state isolated
  // even if an assertion throws mid-test — vi.unstubAllEnvs in afterEach restores
  // the original values. Direct `process.env[...] = ...` mutation skipped cleanup
  // on throw and could bleed between tests.
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports initChatSentry and captureException", async () => {
    const sentry = await import("../bootstrap/sentry.js");
    expect(typeof sentry.initChatSentry).toBe("function");
    expect(typeof sentry.captureException).toBe("function");
  });

  it("is not initialized when SENTRY_DSN_SERVER is not set", async () => {
    vi.stubEnv("SENTRY_DSN_SERVER", "");
    const sentry = await import("../bootstrap/sentry.js");
    expect(sentry.isSentryInitialized()).toBe(false);
  });

  it("reads SENTRY_DSN_SERVER, not SENTRY_DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("SENTRY_DSN_SERVER", "https://example@sentry.example.com/1");
    // Reset module cache so initChatSentry picks up the new env
    vi.resetModules();
    const sentry = await import("../bootstrap/sentry.js");
    await sentry.initChatSentry();
    expect(sentry.isSentryInitialized()).toBe(true);
  });

  it("captureException does not throw when Sentry is not initialized", async () => {
    const sentry = await import("../bootstrap/sentry.js");
    expect(() => sentry.captureException(new Error("test"))).not.toThrow();
  });
});
