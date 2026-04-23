import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {
      GET: vi.fn(),
      POST: vi.fn(),
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config) => config),
}));

vi.mock("next-auth/providers/email", () => ({
  default: vi.fn((config) => config),
}));

vi.mock("next-auth/providers/google", () => ({
  default: vi.fn((config) => config),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => ({
    dashboardUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dashboardVerificationToken: {
      create: vi.fn(),
      delete: vi.fn(),
    },
  })),
}));

describe("auth module import", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;

  beforeEach(() => {
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

  it("does not throw on import in production when NEXTAUTH_SECRET is missing", async () => {
    await expect(import("../auth.js")).resolves.toBeDefined();
  });
});
