import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { flipResultToReply, governanceFlipRoutes } from "../governance-set-gate-mode.js";

describe("flipResultToReply", () => {
  it("completed -> 200 with unit + mode", () => {
    expect(
      flipResultToReply({
        outcome: "completed",
        outputs: { unit: "deterministic", mode: "enforce" },
      }),
    ).toEqual({ code: 200, body: { unit: "deterministic", mode: "enforce" } });
  });

  it("failed GATE_NOT_ENFORCE_READY -> 409 with the reason", () => {
    const r = flipResultToReply({
      outcome: "failed",
      error: { code: "GATE_NOT_ENFORCE_READY", message: "add a price" },
    });
    expect(r.code).toBe(409);
    expect(r.body).toMatchObject({ error: "gate_not_enforce_ready", reason: "add a price" });
  });

  it("failed DEPLOYMENT_NOT_FOUND -> 404; GOVERNANCE_CONFIG_INVALID -> 409", () => {
    expect(
      flipResultToReply({
        outcome: "failed",
        error: { code: "DEPLOYMENT_NOT_FOUND", message: "x" },
      }).code,
    ).toBe(404);
    expect(
      flipResultToReply({
        outcome: "failed",
        error: { code: "GOVERNANCE_CONFIG_INVALID", message: "x" },
      }).code,
    ).toBe(409);
  });

  it("an unmapped failure throws (scrubbed 500)", () => {
    expect(() =>
      flipResultToReply({ outcome: "failed", error: { code: "WAT", message: "x" } }),
    ).toThrow();
  });

  it("a non-completed/non-failed outcome (impossible pending_approval) throws", () => {
    expect(() => flipResultToReply({ outcome: "pending_approval" })).toThrow();
  });
});

describe("governanceFlipRoutes (integration)", () => {
  const url = "/api/agents/alex/governance/gates/deterministic/mode";
  const headers = { "idempotency-key": "k1", "content-type": "application/json" };

  async function buildApp(
    over: { submit?: ReturnType<typeof vi.fn>; deployment?: { id: string } | null } = {},
  ): Promise<{ app: FastifyInstance; submit: ReturnType<typeof vi.fn> }> {
    const submit =
      over.submit ??
      vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { unit: "deterministic", mode: "enforce", deploymentId: "dep-1" },
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
    await app.register(governanceFlipRoutes, { prefix: "/api/agents" });
    await app.ready();
    return { app, submit };
  }

  it("completed -> 200", async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: "POST", url, headers, payload: { mode: "enforce" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unit: "deterministic", mode: "enforce" });
  });

  it("REFUSE: ok:true but outcome failed GATE_NOT_ENFORCE_READY -> 409, never 200 (full-response check)", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "failed",
        error: { code: "GATE_NOT_ENFORCE_READY", message: "add a price" },
      },
      workUnit: {},
    });
    const { app } = await buildApp({ submit });
    const res = await app.inject({ method: "POST", url, headers, payload: { mode: "enforce" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "gate_not_enforce_ready" });
  });

  it("no Alex deployment -> 404 and submit is never called (org scope)", async () => {
    const { app, submit } = await buildApp({ deployment: null });
    const res = await app.inject({ method: "POST", url, headers, payload: { mode: "observe" } });
    expect(res.statusCode).toBe(404);
    expect(submit).not.toHaveBeenCalled();
  });

  it("invalid gate unit -> 400, submit not called", async () => {
    const { app, submit } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/alex/governance/gates/bogus/mode",
      headers,
      payload: { mode: "enforce" },
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("invalid mode -> 400, submit not called", async () => {
    const { app, submit } = await buildApp();
    const res = await app.inject({ method: "POST", url, headers, payload: { mode: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits the intent with the resolved deployment id + org actor", async () => {
    const { app, submit } = await buildApp();
    await app.inject({ method: "POST", url, headers, payload: { mode: "enforce" } });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actor: { id: "user-1", type: "user" },
        intent: "governance.set_gate_mode",
        parameters: { deploymentId: "dep-1", unit: "deterministic", mode: "enforce" },
        trigger: "api",
      }),
    );
  });
});
