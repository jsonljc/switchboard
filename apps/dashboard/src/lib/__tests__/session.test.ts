import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../auth.js", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

describe("getServerSession", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH;
  });

  afterEach(() => {
    // Restore NODE_ENV after each test
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it("returns null when bypass is enabled in production", async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = "true";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();

    expect(session).toBeNull();
  });

  it("returns dev session when bypass is enabled in development", async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = "true";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { getServerSession } = await import("../session.js");
    const session = await getServerSession();

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("dev-user");
  });
});
