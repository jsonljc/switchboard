import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { miraDecisionRoute } from "../mira-decision.js";

const PILOT = "pilot";
const OTHER = "other_org"; // enabled for Mira, but owns no jobs → proves the org-scope WHERE

// A minimal deployment row that satisfies PrismaDeploymentResolver.toResult():
//   - status must be "active" (DeploymentStatus)
//   - listing.status must be "listed" (AgentListingStatus)
//   - skillSlug must be non-null
function buildDeploymentRow(orgId: string) {
  return {
    id: "dep-creative-001",
    organizationId: orgId,
    listingId: "listing-001",
    status: "active",
    skillSlug: "creative",
    inputConfig: {},
    governanceSettings: {},
    circuitBreakerThreshold: null,
    maxWritesPerHour: null,
    allowedModelTiers: [],
    spendApprovalThreshold: 0,
    listing: { id: "listing-001", trustScore: 0, status: "listed" },
  };
}

function buildPrismaMock() {
  return {
    agentDeployment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi
        .fn()
        .mockImplementation(
          async (args: {
            where?: { organizationId?: string; skillSlug?: string; status?: string };
          }) => {
            const { organizationId } = args?.where ?? {};
            if (organizationId === PILOT) return buildDeploymentRow(PILOT);
            return null;
          },
        ),
    },
    creativeJob: {
      // Resolves { count: 1 } for {id:"job1", organizationId:PILOT}; { count: 0 } otherwise.
      updateMany: vi
        .fn()
        .mockImplementation(async (args: { where?: { id?: string; organizationId?: string } }) => {
          const { id, organizationId } = args?.where ?? {};
          if (id === "job1" && organizationId === PILOT) return { count: 1 };
          return { count: 0 };
        }),
    },
    // NO-CROSS-AGENT guards: these must never be called by the decision route.
    recommendation: {
      create: vi.fn(),
    },
    campaign: {
      create: vi.fn(),
    },
  };
}

// Module-level reference so it() blocks can assert on stubs directly (no ctx.spies).
let prismaMock: ReturnType<typeof buildPrismaMock>;

describe("POST /agents/mira/creatives/:id/decision", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestServer();
    prismaMock = buildPrismaMock();
    (ctx.app as unknown as { prisma: unknown }).prisma = prismaMock;
    await ctx.app.register(miraDecisionRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
    await ctx.app.orgAgentEnablementStore!.enable(OTHER, "mira");
  });

  afterAll(async () => ctx.app.close());

  // Reset mock call counts between tests so assertions stay per-test.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function decide(org: string, id: string, decision: "kept" | "passed" | null) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/dashboard/agents/mira/creatives/${id}/decision`,
      headers: { "x-org-id": org },
      payload: { decision },
    });
  }

  it("keeps a draft (200) and writes ONLY the decision field", async () => {
    const res = await decide(PILOT, "job1", "kept");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { decision: string }).decision).toBe("kept");
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
    expect(prismaMock.campaign.create).not.toHaveBeenCalled();
    expect(prismaMock.creativeJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it("passes a draft (200)", async () => {
    expect((await decide(PILOT, "job1", "passed")).statusCode).toBe(200);
  });

  it("un-keeps with decision:null (reversible)", async () => {
    expect((await decide(PILOT, "job1", null)).statusCode).toBe(200);
  });

  it("404s for a missing job (count===0 guard)", async () => {
    expect((await decide(PILOT, "not-mine", "kept")).statusCode).toBe(404);
  });

  it("404s cross-tenant: an enabled OTHER org cannot decide PILOT's job (org-scope WHERE is load-bearing)", async () => {
    // OTHER is enabled (passes the agent-home gate) but the updateMany WHERE includes
    // organizationId, so {id:"job1", organizationId:OTHER} matches no row → count 0 → 404.
    const res = await decide(OTHER, "job1", "kept");
    expect(res.statusCode).toBe(404);
  });

  it("400s on an invalid decision", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/agents/mira/creatives/job1/decision",
      headers: { "x-org-id": PILOT },
      payload: { decision: "shipped" },
    });
    expect(res.statusCode).toBe(400);
  });
});
