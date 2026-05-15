import { describe, it, expect, vi, beforeEach } from "vitest";

describe("chat sentry bootstrap", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports initChatSentry and captureException", async () => {
    const sentry = await import("../bootstrap/sentry.js");
    expect(typeof sentry.initChatSentry).toBe("function");
    expect(typeof sentry.captureException).toBe("function");
  });

  it("is not initialized when SENTRY_DSN_SERVER is not set", async () => {
    delete process.env["SENTRY_DSN_SERVER"];
    const sentry = await import("../bootstrap/sentry.js");
    expect(sentry.isSentryInitialized()).toBe(false);
  });

  it("reads SENTRY_DSN_SERVER, not SENTRY_DSN", async () => {
    delete process.env["SENTRY_DSN"];
    process.env["SENTRY_DSN_SERVER"] = "https://example@sentry.example.com/1";
    // Reset module cache so initChatSentry picks up the new env
    vi.resetModules();
    const sentry = await import("../bootstrap/sentry.js");
    await sentry.initChatSentry();
    expect(sentry.isSentryInitialized()).toBe(true);
    delete process.env["SENTRY_DSN_SERVER"];
  });

  it("captureException does not throw when Sentry is not initialized", async () => {
    const sentry = await import("../bootstrap/sentry.js");
    expect(() => sentry.captureException(new Error("test"))).not.toThrow();
  });
});
