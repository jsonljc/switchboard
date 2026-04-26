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

  it("is not initialized when SENTRY_DSN is not set", async () => {
    delete process.env["SENTRY_DSN"];
    const sentry = await import("../bootstrap/sentry.js");
    expect(sentry.isSentryInitialized()).toBe(false);
  });

  it("captureException does not throw when Sentry is not initialized", async () => {
    const sentry = await import("../bootstrap/sentry.js");
    expect(() => sentry.captureException(new Error("test"))).not.toThrow();
  });
});
