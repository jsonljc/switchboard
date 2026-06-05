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

// The resolver still runs in-route (to supply deploymentId/listingId to the submit),
// so prisma only needs agentDeployment + deploymentConnection. The AgentTask/CreativeJob
// writes + the pipeline kick now belong to the creative.job.submit WORKFLOW (post-
// governance), NOT this route — so there are NO direct creativeJob/inngest writes here.
function buildPrismaMock() {
  return {
    agentDeployment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi
        .fn()
        .mockImplementation(async (args: { where?: { organizationId?: string } }) => {
          const { organizationId } = args?.where ?? {};
          if (organizationId === PILOT) return buildDeploymentRow(PILOT);
          return null;
        }),
    },
    deploymentConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    // These must never be written by the route anymore.
    agentTask: { create: vi.fn() },
    creativeJob: { create: vi.fn() },
  };
}

let prismaMock: ReturnType<typeof buildPrismaMock>;

const { inngestSend } = vi.hoisted(() => ({ inngestSend: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: inngestSend },
}));

describe("POST /agents/mira/brief → PlatformIngress (creative.job.submit)", () => {
  let ctx: TestContext;
  let submit: ReturnType<typeof vi.fn>;

  async function post(
    org: string,
    body: Record<string, unknown>,
    key?: string,
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/agents/mira/brief",
      headers: {
        "x-org-id": org,
        "x-principal-id": "user-zoe",
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body,
    });
  }

  const NO_CREATIVE_ORG = "org-without-creative";

  beforeAll(async () => {
    ctx = await buildTestServer();
    prismaMock = buildPrismaMock();
    (ctx.app as unknown as { prisma: unknown }).prisma = prismaMock;
    submit = vi.fn();
    (ctx.app as unknown as { platformIngress: unknown }).platformIngress = { submit };
    await ctx.app.register(miraBriefRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
    await ctx.app.orgAgentEnablementStore!.enable(NO_CREATIVE_ORG, "mira");
  });

  afterAll(async () => ctx.app.close());

  beforeEach(() => {
    inngestSend.mockClear();
    submit.mockReset();
    submit.mockResolvedValue({
      ok: true,
      result: { outcome: "queued", outputs: { task: { id: "task-001" }, job: { id: "job-001" } } },
    });
  });

  it("submits creative.job.submit through the governance front door (no direct writes)", async () => {
    await post(PILOT, { promoting: "Summer Botox special" });

    expect(submit).toHaveBeenCalledTimes(1);
    const arg = submit.mock.calls[0]![0];
    expect(arg).toMatchObject({
      intent: "creative.job.submit",
      parameters: {
        deploymentId: "dep-creative-001",
        listingId: "listing-001",
        mode: "polished",
      },
      actor: { id: "user-zoe", type: "user" },
      organizationId: PILOT,
      trigger: "api",
    });
    // Brief is forwarded as the CreativeBriefInput the workflow expects.
    expect(arg.parameters.brief).toMatchObject({ productDescription: expect.any(String) });
    // No direct pipeline kick or DB writes — the workflow owns those post-governance.
    expect(inngestSend).not.toHaveBeenCalled();
    expect(prismaMock.creativeJob.create).not.toHaveBeenCalled();
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("threads mode ugc from the brief into the ingress params (slice-3 spec 3.4)", async () => {
    await post(PILOT, { promoting: "Summer Botox special", mode: "ugc" });
    const arg = submit.mock.calls[0]![0];
    expect(arg.parameters.mode).toBe("ugc");
  });

  it("maps the submit outputs back to the open-brief contract (201)", async () => {
    const res = await post(PILOT, { promoting: "Summer Botox special" });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      jobId: string;
      status: string;
      cost: { generationGatedInReview: boolean };
      requestSource: string;
    };
    expect(body.jobId).toBe("job-001");
    expect(body.status).toBe("brief_submitted");
    expect(body.requestSource).toBe("mira.open_brief");
    expect(body.cost.generationGatedInReview).toBe(true);
  });

  it("returns 202 PENDING_APPROVAL when the submit parks (never a phantom 201)", async () => {
    submit.mockResolvedValue({
      ok: true,
      approvalRequired: true,
      lifecycleId: "lc-1",
      bindingHash: "bh-1",
      workUnit: { id: "wu-1", traceId: "tr-1" },
      result: { outcome: "pending_approval", outputs: {} },
    });
    const res = await post(PILOT, { promoting: "Summer Botox special" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      outcome: "PENDING_APPROVAL",
      approvalRequest: { id: "lc-1", bindingHash: "bh-1" },
    });
    expect((res.json() as { jobId?: string }).jobId).toBeUndefined();
  });

  it("fails closed (409) when the org has no creative deployment — never submits", async () => {
    const res = await post(NO_CREATIVE_ORG, { promoting: "x" });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe("creative_deployment_not_provisioned");
    expect(submit).not.toHaveBeenCalled();
  });

  it("400s on an invalid brief — never submits", async () => {
    const res = await post(PILOT, { promoting: "" });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("dedupes a replayed POST with the same Idempotency-Key (one submit)", async () => {
    const key = "replay-key-1";
    const first = await post(PILOT, { promoting: "Replay test" }, key);
    const second = await post(PILOT, { promoting: "Replay test" }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json()); // served from the HTTP idempotency cache
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
