import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/lib/auth", () => ({
  handlers: {
    GET: mockGet,
    POST: mockPost,
  },
}));

describe("/api/auth/[...nextauth]", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DEV_BYPASS_AUTH;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).NEXTAUTH_SECRET = originalNextAuthSecret;
    (process.env as Record<string, string | undefined>).DEV_BYPASS_AUTH = originalDevBypass;
  });

  it("throws for auth requests in production when NEXTAUTH_SECRET is missing", async () => {
    const { GET } = await import("../route");
    const request = new NextRequest("http://localhost/api/auth/session");

    expect(() => GET(request)).toThrow(/NEXTAUTH_SECRET/i);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
