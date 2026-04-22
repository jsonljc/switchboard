import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard dev auth env", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DEV_BYPASS_AUTH;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).NEXTAUTH_SECRET = originalNextAuthSecret;
    (process.env as Record<string, string | undefined>).DEV_BYPASS_AUTH = originalDevBypass;
  });

  it("throws in production when NEXTAUTH_SECRET is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth.js");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/NEXTAUTH_SECRET/i);
  });

  it("throws in production when DEV_BYPASS_AUTH is enabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "secret";
    process.env.DEV_BYPASS_AUTH = "true";

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth.js");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/DEV_BYPASS_AUTH/i);
  });

  it("reports bypass enabled only in non-production environments", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DEV_BYPASS_AUTH = "true";

    const { isDevBypassEnabled } = await import("../dev-auth.js");

    expect(isDevBypassEnabled()).toBe(true);
  });
});
