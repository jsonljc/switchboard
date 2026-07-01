import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard dev auth env", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalCredsKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DEV_BYPASS_AUTH;
    delete process.env.DATABASE_URL;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).NEXTAUTH_SECRET = originalNextAuthSecret;
    (process.env as Record<string, string | undefined>).DEV_BYPASS_AUTH = originalDevBypass;
    (process.env as Record<string, string | undefined>).DATABASE_URL = originalDatabaseUrl;
    (process.env as Record<string, string | undefined>).CREDENTIALS_ENCRYPTION_KEY =
      originalCredsKey;
  });

  it("throws in production when NEXTAUTH_SECRET is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/NEXTAUTH_SECRET/i);
  });

  it("throws in production when DEV_BYPASS_AUTH is enabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "secret";
    process.env.DEV_BYPASS_AUTH = "true";

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/DEV_BYPASS_AUTH/i);
  });

  it("throws in production when DATABASE_URL is missing", async () => {
    // The dashboard reads Postgres directly (auth adapter + per-org api client),
    // so a missing DATABASE_URL must fail fast at startup, not lazily at the first
    // query with a cryptic Prisma error.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "secret";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "creds";
    // DATABASE_URL intentionally unset

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/DATABASE_URL/i);
  });

  it("throws in production when CREDENTIALS_ENCRYPTION_KEY is missing", async () => {
    // CREDENTIALS_ENCRYPTION_KEY decrypts per-org API credentials and must match
    // the API server. Without it, every authed dashboard request fails lazily at
    // the first decrypt; preflight it so the deploy refuses to start instead.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgres://localhost/db";
    // CREDENTIALS_ENCRYPTION_KEY intentionally unset

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth");

    expect(() => assertSafeDashboardAuthEnv()).toThrow(/CREDENTIALS_ENCRYPTION_KEY/i);
  });

  it("passes in production when all required secrets are present", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "creds";

    const { assertSafeDashboardAuthEnv } = await import("../dev-auth");

    expect(() => assertSafeDashboardAuthEnv()).not.toThrow();
  });

  it("reports bypass enabled only in non-production environments", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DEV_BYPASS_AUTH = "true";

    const { isDevBypassEnabled } = await import("../dev-auth");

    expect(isDevBypassEnabled()).toBe(true);
  });
});
