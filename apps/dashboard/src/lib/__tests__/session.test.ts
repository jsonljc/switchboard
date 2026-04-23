import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../auth.js", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

describe("getServerSession", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEV_BYPASS_AUTH;
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    // Restore NODE_ENV after each test
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).NEXTAUTH_SECRET = originalNextAuthSecret;
    (process.env as Record<string, string | undefined>).DEV_BYPASS_AUTH = originalDevBypass;
  });

  it("throws when bypass is enabled in production", async () => {
    process.env.DEV_BYPASS_AUTH = "true";
    process.env.NEXTAUTH_SECRET = "secret";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { getServerSession } = await import("../session.js");
    await expect(getServerSession()).rejects.toThrow(/DEV_BYPASS_AUTH/i);
  });

  it("returns dev session when bypass is enabled in development", async () => {
    process.env.DEV_BYPASS_AUTH = "true";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("dev-user");
  });

  it("returns null when bypass is disabled and auth has no session", async () => {
    process.env.NEXTAUTH_SECRET = "secret";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();

    expect(session).toBeNull();
  });

  it("throws in production when NEXTAUTH_SECRET is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { getServerSession } = await import("../session.js");

    await expect(getServerSession()).rejects.toThrow(/NEXTAUTH_SECRET/i);
  });
});
