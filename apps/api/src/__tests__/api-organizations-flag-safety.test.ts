import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";

/**
 * Slice A PR 2 — flag safety regression test.
 *
 * Pins the create-only invariant for OrganizationConfig.useAgentFirstNav:
 *   - Brand-new orgs land with `useAgentFirstNav: true` via the upsert's
 *     `create` branch.
 *   - Existing orgs MUST NOT have their flag flipped on subsequent upserts —
 *     the `update` branch must NEVER pass `useAgentFirstNav`.
 *
 * Because the API harness mocks Prisma (no Postgres in CI), assertions target
 * the call args of `organizationConfig.upsert` rather than DB state.
 *
 * Lock: a future Phase D5 backfill is the only sanctioned site that may flip
 * `useAgentFirstNav` on a pre-existing org. Flipping it mid-session anywhere
 * else is the regression this test prevents.
 */
describe("Organizations API — useAgentFirstNav flag safety (Slice A PR 2)", () => {
  let app: FastifyInstance;

  const mockPrisma = {
    organizationConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    managedChannel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn(),
    },
    connection: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    agentListing: {
      upsert: vi.fn(),
    },
    agentDeployment: {
      upsert: vi.fn(),
    },
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.agentListing.upsert.mockResolvedValue({
      id: "listing_alex",
      slug: "alex-conversion",
    });
    mockPrisma.agentDeployment.upsert.mockResolvedValue({ id: "deployment_alex" });
    mockPrisma.orgAgentEnablement.upsert.mockResolvedValue({});

    app = Fastify({ logger: false });
    app.decorate("prisma", mockPrisma as unknown as never);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });
    await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("upsert call passes useAgentFirstNav: true in the create branch", async () => {
    mockPrisma.organizationConfig.upsert.mockResolvedValue({
      id: "org_test",
      name: "",
      runtimeType: "http",
      runtimeConfig: {},
      governanceProfile: "guarded",
      onboardingComplete: false,
      managedChannels: [],
      provisioningStatus: "pending",
      useAgentFirstNav: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/organizations/org_test/config",
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.organizationConfig.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockPrisma.organizationConfig.upsert.mock.calls[0]?.[0];
    expect(upsertCall).toBeDefined();
    expect(upsertCall.create).toEqual(expect.objectContaining({ useAgentFirstNav: true }));
  });

  it("upsert call MUST NOT pass useAgentFirstNav in the update branch", async () => {
    mockPrisma.organizationConfig.upsert.mockResolvedValue({
      id: "org_test",
      name: "Existing Org",
      runtimeType: "http",
      runtimeConfig: {},
      governanceProfile: "guarded",
      onboardingComplete: true,
      managedChannels: [],
      provisioningStatus: "active",
      useAgentFirstNav: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/organizations/org_test/config",
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.organizationConfig.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockPrisma.organizationConfig.upsert.mock.calls[0]?.[0];
    expect(upsertCall).toBeDefined();
    // The update branch must be a no-op (currently `update: {}`). It must
    // NEVER touch useAgentFirstNav — flipping nav on a live customer mid-
    // session is the regression we're guarding against.
    expect(upsertCall.update).toEqual({});
    expect(upsertCall.update).not.toHaveProperty("useAgentFirstNav");
  });

  it("seedOrgDayOneAgents is invoked after the lazy-create upsert", async () => {
    mockPrisma.organizationConfig.upsert.mockResolvedValue({
      id: "org_test",
      name: "",
      runtimeType: "http",
      runtimeConfig: {},
      governanceProfile: "guarded",
      onboardingComplete: false,
      managedChannels: [],
      provisioningStatus: "pending",
      useAgentFirstNav: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/organizations/org_test/config",
    });

    expect(res.statusCode).toBe(200);
    // seedOrgDayOneAgents seeds day-one agents only (alex, riley); mira is
    // day-thirty and should NOT be seeded here.
    const enablementCalls = mockPrisma.orgAgentEnablement.upsert.mock.calls;
    expect(enablementCalls.length).toBeGreaterThanOrEqual(2);
    const seededKeys = enablementCalls.map(
      ([args]) => args.where.orgId_agentKey.agentKey as string,
    );
    expect(seededKeys).toEqual(expect.arrayContaining(["alex", "riley"]));
    expect(seededKeys).not.toContain("mira");
    for (const [args] of enablementCalls) {
      expect(args.where.orgId_agentKey.orgId).toBe("org_test");
      expect(args.create).toEqual(
        expect.objectContaining({ orgId: "org_test", status: "enabled" }),
      );
      // Idempotent: update branch is a no-op so re-runs do not regress state.
      expect(args.update).toEqual({});
    }
  });
});
