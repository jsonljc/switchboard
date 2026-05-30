import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { miraBriefRoute } from "../mira-brief.js";

const PILOT = "pilot";

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
    deploymentConnection: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    agentTask: {
      create: vi.fn().mockResolvedValue({ id: "task-001" }),
    },
    creativeJob: {
      create: vi.fn().mockResolvedValue({ id: "job-001", organizationId: PILOT }),
    },
    // NO-CROSS-AGENT guards: these must never be called
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

// Stub inngestClient.send so no real Inngest call occurs.
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("POST /agents/mira/brief", () => {
  let ctx: TestContext;

  async function post(
    org: string,
    body: Record<string, unknown>,
    key?: string,
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/agents/mira/brief",
      headers: { "x-org-id": org, ...(key ? { "idempotency-key": key } : {}) },
      payload: body,
    });
  }

  // "org-without-creative" is enabled for Mira so the test reaches the resolver,
  // but its agentDeployment.findFirst returns null → triggers the 409 fail-closed path.
  const NO_CREATIVE_ORG = "org-without-creative";

  beforeAll(async () => {
    ctx = await buildTestServer();
    prismaMock = buildPrismaMock();
    (ctx.app as unknown as { prisma: unknown }).prisma = prismaMock;
    await ctx.app.register(miraBriefRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
    // Enable the no-creative org so it passes the enablement gate and reaches the resolver.
    await ctx.app.orgAgentEnablementStore!.enable(NO_CREATIVE_ORG, "mira");
  });

  afterAll(async () => ctx.app.close());

  // Reset mock call counts between tests so assertions stay per-test.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a draft request and returns the open-brief contract", async () => {
    const res = await post(PILOT, { promoting: "Summer Botox special" });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      jobId: string;
      status: string;
      cost: { generationGatedInReview: boolean };
      requestSource: string;
    };
    expect(body.status).toBe("brief_submitted");
    expect(body.requestSource).toBe("mira.open_brief");
    expect(body.cost.generationGatedInReview).toBe(true);
    expect(typeof body.jobId).toBe("string");
  });

  it("makes NO cross-agent writes (no Riley / recommendation / campaign / publish)", async () => {
    await post(PILOT, { promoting: "Summer Botox special" });
    // Assert the prisma mock's recommendation/campaign namespaces were never written.
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
    expect(prismaMock.campaign.create).not.toHaveBeenCalled();
    expect(prismaMock.creativeJob.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the org has no creative deployment", async () => {
    const res = await post("org-without-creative", { promoting: "x" });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe("creative_deployment_not_provisioned");
  });

  it("400s on an invalid brief", async () => {
    const res = await post(PILOT, { promoting: "" });
    expect(res.statusCode).toBe(400);
  });

  it("dedupes a replayed POST with the same Idempotency-Key", async () => {
    const key = "replay-key-1";
    const first = await post(PILOT, { promoting: "Replay test" }, key);
    const second = await post(PILOT, { promoting: "Replay test" }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json()); // served from the idempotency cache
    // Prove the second POST was actually deduped (not re-run): only ONE job created.
    expect(prismaMock.creativeJob.create).toHaveBeenCalledTimes(1);
  });
});
