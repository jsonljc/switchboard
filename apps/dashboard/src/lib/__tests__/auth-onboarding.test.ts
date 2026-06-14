import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

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
  // The KnowledgeKind enum is read at module-load by @switchboard/db's
  // seed-alex-skill-pack, which auth.ts pulls in transitively. Mirror the
  // schema enum (playbook|policy|knowledge) so the mocked module is complete.
  KnowledgeKind: { playbook: "playbook", policy: "policy", knowledge: "knowledge" },
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

// F-05: stub provisioning so the createUser backstop test asserts on calls without a real DB write.
const { provisionDashboardUserMock } = vi.hoisted(() => ({
  provisionDashboardUserMock: vi.fn(async () => ({
    id: "du_new",
    email: "new@clinic.test",
    name: null,
    emailVerified: null,
  })),
}));
vi.mock("../provision-dashboard-user", () => ({
  provisionDashboardUser: provisionDashboardUserMock,
}));

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

describe("authConfig host trust (F-09)", () => {
  it("sets trustHost explicitly so prod-mode login works off Vercel, not only via VERCEL=1", () => {
    // Config-pin: next-auth is mocked here, so this asserts the explicit setting, not runtime
    // behavior. The dashboard runs on Vercel, where trustHost already resolves true via the
    // injected VERCEL=1; setting it explicitly removes that implicit dependency so login also
    // works in local prod-mode and on any future off-Vercel host.
    expect(authConfig.trustHost).toBe(true);
  });
});

describe("auth signIn gate (F-05 launch mode)", () => {
  const signIn = (args: unknown) =>
    (authConfig.callbacks!.signIn as (a: unknown) => Promise<boolean>)(args);

  beforeEach(() => {
    dashboardUserFindUnique.mockReset();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("allows any sign-in when launch mode is open (public), without a DB lookup", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");
    await expect(
      signIn({ user: { email: "new@clinic.test" }, account: { provider: "google" } }),
    ).resolves.toBe(true);
    expect(dashboardUserFindUnique).not.toHaveBeenCalled();
  });

  it("allows credentials logins even when closed (existing user, never the adapter)", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    await expect(
      signIn({
        user: { id: "u1", email: "owner@clinic.test" },
        account: { provider: "credentials" },
      }),
    ).resolves.toBe(true);
  });

  it("denies a NET-NEW oauth signup when closed (waitlist)", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    dashboardUserFindUnique.mockResolvedValue(null); // email not in DB => new user
    await expect(
      signIn({ user: { email: "stranger@example.com" }, account: { provider: "google" } }),
    ).resolves.toBe(false);
  });

  it("ALLOWS an existing pre-provisioned user when closed (no lockout invariant)", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    dashboardUserFindUnique.mockResolvedValue({ id: "u1", email: "pilot@clinic.test" });
    await expect(
      signIn({ user: { email: "pilot@clinic.test" }, account: { provider: "google" } }),
    ).resolves.toBe(true);
  });

  it("allows an existing user's magic-link request phase when closed (verificationRequest, account null)", async () => {
    // @auth/core populates user.email even in the email request phase (real row or a
    // defaultUser built from the typed address), so an existing pilot requesting a magic
    // link is never wrongly denied. Pins the no-lockout property against a future bump.
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    dashboardUserFindUnique.mockResolvedValue({ id: "u1", email: "pilot@clinic.test" });
    await expect(
      signIn({
        user: { email: "pilot@clinic.test" },
        account: null,
        email: { verificationRequest: true },
      }),
    ).resolves.toBe(true);
  });
});

describe("auth createUser backstop (F-05 launch mode)", () => {
  const createUser = (u: unknown) =>
    (authConfig.adapter!.createUser as (a: unknown) => Promise<unknown>)(u);

  beforeEach(() => {
    provisionDashboardUserMock.mockClear();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("throws and does NOT provision when signup is closed", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    await expect(
      createUser({ email: "stranger@example.com", emailVerified: null }),
    ).rejects.toThrow();
    expect(provisionDashboardUserMock).not.toHaveBeenCalled();
  });

  it("provisions when signup is open", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");
    await createUser({ email: "new@clinic.test", emailVerified: null });
    expect(provisionDashboardUserMock).toHaveBeenCalledTimes(1);
  });
});
