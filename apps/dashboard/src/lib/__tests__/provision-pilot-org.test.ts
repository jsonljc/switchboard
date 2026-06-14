import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PilotOrgExistsError,
  PilotOwnerNotFoundError,
  SETUP_LINK_EXPIRY_HOURS,
  provisionPilotOrg,
  reissueSetupLink,
  type ProvisionPilotDeps,
} from "../provision-pilot-org";

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Minimal Prisma double: only the two methods the orchestration touches
 * directly (existence check + token mint). The heavy multi-step transactions
 * (provisionDashboardUser, provisionOrgAgentDeployments) are injected deps, so
 * we never need to mock their internals here.
 */
function makePrisma(opts: { existingUser?: unknown } = {}) {
  const created: Array<{ userId: string; tokenHash: string; expiresAt: Date }> = [];
  return {
    created,
    dashboardUser: {
      findUnique: vi.fn(async () => opts.existingUser ?? null),
    },
    dashboardPasswordResetToken: {
      create: vi.fn(
        async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
          created.push(data);
          return data;
        },
      ),
    },
  };
}

function makeDeps(overrides: Partial<ProvisionPilotDeps> = {}): ProvisionPilotDeps {
  return {
    provisionDashboardUser: vi.fn(
      async (_prisma: unknown, input: { email: string; name?: string | null }) => ({
        id: "user_new",
        organizationId: "org_new",
        email: input.email,
      }),
    ) as unknown as ProvisionPilotDeps["provisionDashboardUser"],
    provisionOrgAgentDeployments: vi.fn(async () => ({
      riley: { deploymentId: "dep_riley" },
    })) as unknown as ProvisionPilotDeps["provisionOrgAgentDeployments"],
    ...overrides,
  };
}

const NOW = Date.UTC(2026, 5, 14, 12, 0, 0);

describe("provisionPilotOrg", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let deps: ProvisionPilotDeps;

  beforeEach(() => {
    prisma = makePrisma();
    deps = makeDeps();
  });

  it("refuses to clobber an already-provisioned email", async () => {
    prisma = makePrisma({ existingUser: { id: "user_old", organizationId: "org_old" } });
    await expect(
      provisionPilotOrg(prisma as never, { email: "owner@clinic.com", nowMs: NOW }, deps),
    ).rejects.toBeInstanceOf(PilotOrgExistsError);
    // must NOT have attempted any provisioning side effects
    expect(deps.provisionDashboardUser).not.toHaveBeenCalled();
    expect(deps.provisionOrgAgentDeployments).not.toHaveBeenCalled();
    expect(prisma.dashboardPasswordResetToken.create).not.toHaveBeenCalled();
  });

  it("provisions the canonical onboarding then eagerly seeds Riley (mira:false)", async () => {
    const result = await provisionPilotOrg(
      prisma as never,
      { email: "Owner@Clinic.com", name: "  Glow Clinic  ", nowMs: NOW },
      deps,
    );

    // email normalized (trim + lowercase) before the canonical create
    expect(deps.provisionDashboardUser).toHaveBeenCalledWith(prisma, {
      email: "owner@clinic.com",
      name: "  Glow Clinic  ",
    });
    // Riley deployment + governance eagerly seeded for the resolved org, Mira withheld
    expect(deps.provisionOrgAgentDeployments).toHaveBeenCalledWith(prisma, "org_new", {
      mira: false,
    });

    expect(result.organizationId).toBe("org_new");
    expect(result.ownerEmail).toBe("owner@clinic.com");
    expect(result.rileyDeploymentId).toBe("dep_riley");
  });

  it("mints a consumable set-password link (token hashes to the stored row, future expiry)", async () => {
    const result = await provisionPilotOrg(
      prisma as never,
      { email: "owner@clinic.com", baseUrl: "https://app.example.com/", nowMs: NOW },
      deps,
    );

    // exactly one token row, keyed to the new owner
    expect(prisma.created).toHaveLength(1);
    const row = prisma.created[0];
    expect(row.userId).toBe("user_new");

    // URL carries the raw token; the stored hash must be sha256(rawToken)
    const url = new URL(result.setupUrl);
    expect(url.origin + url.pathname).toBe("https://app.example.com/reset-password"); // trailing slash stripped
    const rawToken = url.searchParams.get("token");
    expect(rawToken).toBeTruthy();
    expect(row.tokenHash).toBe(hashOf(rawToken as string));

    // onboarding expiry window (not the 45-min reset default)
    const expectedExpiry = NOW + SETUP_LINK_EXPIRY_HOURS * 60 * 60 * 1000;
    expect(row.expiresAt.getTime()).toBe(expectedExpiry);
    expect(result.setupLinkExpiresAt.getTime()).toBe(expectedExpiry);
  });

  it("degrades gracefully when eager Riley seeding fails (org still provisioned, link still minted)", async () => {
    const failing = makeDeps({
      provisionOrgAgentDeployments: vi.fn(async () => {
        throw new Error("seed boom");
      }) as unknown as ProvisionPilotDeps["provisionOrgAgentDeployments"],
    });

    const result = await provisionPilotOrg(
      prisma as never,
      { email: "owner@clinic.com", nowMs: NOW },
      failing,
    );

    // canonical onboarding still ran and the org is returned...
    expect(failing.provisionDashboardUser).toHaveBeenCalled();
    expect(result.organizationId).toBe("org_new");
    // ...Riley is deferred to lazy seeding (null), not surfaced as a throw...
    expect(result.rileyDeploymentId).toBeNull();
    // ...and the set-password link is still minted (the optional step did not block it).
    expect(prisma.created).toHaveLength(1);
    expect(result.setupUrl).toContain("/reset-password?token=");
  });

  it("rejects a malformed email before any side effect", async () => {
    await expect(
      provisionPilotOrg(prisma as never, { email: "not-an-email", nowMs: NOW }, deps),
    ).rejects.toThrow(/invalid email/i);
    expect(deps.provisionDashboardUser).not.toHaveBeenCalled();
  });
});

describe("reissueSetupLink", () => {
  it("mints a fresh link for an existing pilot owner without re-provisioning", async () => {
    const prisma = makePrisma({ existingUser: { id: "user_old", organizationId: "org_old" } });
    const result = await reissueSetupLink(prisma as never, {
      email: "owner@clinic.com",
      baseUrl: "https://app.example.com",
      nowMs: NOW,
    });

    expect(prisma.created).toHaveLength(1);
    expect(prisma.created[0].userId).toBe("user_old");
    expect(result.organizationId).toBe("org_old");
    const rawToken = new URL(result.setupUrl).searchParams.get("token");
    expect(prisma.created[0].tokenHash).toBe(hashOf(rawToken as string));
  });

  it("throws PilotOwnerNotFoundError for an unknown email", async () => {
    const prisma = makePrisma();
    await expect(
      reissueSetupLink(prisma as never, { email: "ghost@clinic.com", nowMs: NOW }),
    ).rejects.toBeInstanceOf(PilotOwnerNotFoundError);
    expect(prisma.dashboardPasswordResetToken.create).not.toHaveBeenCalled();
  });
});
