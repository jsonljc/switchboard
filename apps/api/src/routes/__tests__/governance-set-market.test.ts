import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { marketResultToReply, governanceMarketRoutes } from "../governance-set-market.js";

describe("marketResultToReply", () => {
  it("completed -> 200 with jurisdiction + clinicType", () => {
    expect(
      marketResultToReply({
        outcome: "completed",
        outputs: { jurisdiction: "MY", clinicType: "nonMedical", deploymentId: "dep-1" },
      }),
    ).toEqual({ code: 200, body: { jurisdiction: "MY", clinicType: "nonMedical" } });
  });

  it("failed DEPLOYMENT_NOT_FOUND -> 404; GOVERNANCE_CONFIG_INVALID -> 409", () => {
    expect(
      marketResultToReply({
        outcome: "failed",
        error: { code: "DEPLOYMENT_NOT_FOUND", message: "x" },
      }).code,
    ).toBe(404);
    expect(
      marketResultToReply({
        outcome: "failed",
        error: { code: "GOVERNANCE_CONFIG_INVALID", message: "x" },
      }).code,
    ).toBe(409);
  });

  it("an unmapped failure throws (scrubbed 500)", () => {
    expect(() =>
      marketResultToReply({ outcome: "failed", error: { code: "WAT", message: "x" } }),
    ).toThrow();
  });

  it("a non-completed/non-failed outcome (impossible pending_approval) throws", () => {
    expect(() => marketResultToReply({ outcome: "pending_approval" })).toThrow();
  });
});

describe("governanceMarketRoutes (integration)", () => {
  const url = "/api/agents/alex/governance/market";
  const headers = { "idempotency-key": "k1", "content-type": "application/json" };
  const body = { jurisdiction: "MY", clinicType: "nonMedical" };

  async function buildApp(
    over: { submit?: ReturnType<typeof vi.fn>; deployment?: { id: string } | null } = {},
  ): Promise<{ app: FastifyInstance; submit: ReturnType<typeof vi.fn> }> {
    const submit =
      over.submit ??
      vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { jurisdiction: "MY", clinicType: "nonMedical", deploymentId: "dep-1" },
        },
        workUnit: {},
      });
    const deployment = over.deployment === undefined ? { id: "dep-1" } : over.deployment;
    const app = Fastify();
    app.decorate("prisma", {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue(deployment) },
    } as never);
    app.decorate("platformIngress", { submit } as never);
    app.addHook("preHandler", async (req) => {
      (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = "org-1";
      (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = "user-1";
    });
    await app.register(governanceMarketRoutes, { prefix: "/api/agents" });
    await app.ready();
    return { app, submit };
  }

  it("completed -> 200", async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: "POST", url, headers, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jurisdiction: "MY", clinicType: "nonMedical" });
  });

  it("ok:true but outcome failed DEPLOYMENT_NOT_FOUND -> 404, never 200 (full-response check)", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "failed", error: { code: "DEPLOYMENT_NOT_FOUND", message: "gone" } },
      workUnit: {},
    });
    const { app } = await buildApp({ submit });
    const res = await app.inject({ method: "POST", url, headers, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it("no Alex deployment -> 404 and submit is never called (org scope)", async () => {
    const { app, submit } = await buildApp({ deployment: null });
    const res = await app.inject({ method: "POST", url, headers, payload: body });
    expect(res.statusCode).toBe(404);
    expect(submit).not.toHaveBeenCalled();
  });

  it("invalid jurisdiction -> 400, submit not called", async () => {
    const { app, submit } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { jurisdiction: "TH", clinicType: "medical" },
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("invalid clinicType -> 400, submit not called", async () => {
    const { app, submit } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { jurisdiction: "MY", clinicType: "dental" },
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits the intent with the SERVER-RESOLVED Alex deployment id + org actor (never a client deploymentId)", async () => {
    const { app, submit } = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers,
      // a malicious client deploymentId in the body must be ignored
      payload: { ...body, deploymentId: "attacker-dep" },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actor: { id: "user-1", type: "user" },
        intent: "governance.set_market",
        parameters: { deploymentId: "dep-1", jurisdiction: "MY", clinicType: "nonMedical" },
        trigger: "api",
      }),
    );
  });
});
