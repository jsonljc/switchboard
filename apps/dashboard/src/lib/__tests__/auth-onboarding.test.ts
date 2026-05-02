import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth/Prisma at the module level so `import("../auth")` does not
// pull in Next.js server runtime (which is unavailable under vitest's jsdom
// environment) and does not open a real DB connection. The JWT callback in
// auth.ts uses the module-scoped Prisma client; tests assert against the
// shared mock fns below. `vi.hoisted` is required because `vi.mock` factories
// run before regular module-scope variables are initialized.
const { organizationConfigFindUnique, dashboardUserFindUnique } = vi.hoisted(() => ({
  organizationConfigFindUnique: vi.fn(),
  dashboardUserFindUnique: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    organizationConfig: { findUnique: organizationConfigFindUnique },
    dashboardUser: { findUnique: dashboardUserFindUnique },
  })),
}));

vi.mock("next-auth", () => ({
  default: vi.fn().mockReturnValue({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  }),
}));

vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn(() => ({})) }));
vi.mock("next-auth/providers/email", () => ({ default: vi.fn(() => ({})) }));
vi.mock("next-auth/providers/google", () => ({ default: vi.fn(() => ({})) }));

// We test the callbacks in isolation by importing the config object.
// If auth.ts doesn't export the config, refactor to export `authConfig`
// alongside the NextAuth() invocation.
import { authConfig } from "../auth";

describe("auth callbacks: onboardingComplete plumbing", () => {
  beforeEach(() => {
    organizationConfigFindUnique.mockReset();
    dashboardUserFindUnique.mockReset();
    // emailVerified refresh path always runs after the user branch; default
    // it to a no-op so it doesn't pollute assertions.
    dashboardUserFindUnique.mockResolvedValue({ emailVerified: null });
  });

  it("populates token.onboardingComplete from Prisma on initial sign-in", async () => {
    organizationConfigFindUnique.mockResolvedValue({ onboardingComplete: true });

    const callbacks = authConfig.callbacks!;
    const token = await callbacks.jwt!({
      token: {},
      user: {
        id: "u-1",
        email: "a@b.c",
        organizationId: "org-1",
        principalId: "p-1",
      } as unknown as never,
    } as never);

    expect(token!.onboardingComplete).toBe(true);
    expect(organizationConfigFindUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { onboardingComplete: true },
    });
  });

  it("does NOT re-query onboardingComplete on token refresh (no user object)", async () => {
    const callbacks = authConfig.callbacks!;
    const token = await callbacks.jwt!({
      token: { id: "u-1", organizationId: "org-1", onboardingComplete: true },
      user: undefined,
    } as never);

    expect(organizationConfigFindUnique).not.toHaveBeenCalled();
    expect(token!.onboardingComplete).toBe(true);
  });

  it("session callback copies onboardingComplete from token", async () => {
    const callbacks = authConfig.callbacks!;
    const session = await callbacks.session!({
      session: { user: { id: "", email: "a@b.c" } } as never,
      token: {
        id: "u-1",
        organizationId: "org-1",
        principalId: "p-1",
        onboardingComplete: false,
      } as never,
    } as never);

    expect((session as { onboardingComplete: boolean }).onboardingComplete).toBe(false);
  });
});
