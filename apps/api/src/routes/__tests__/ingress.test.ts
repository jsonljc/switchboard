// apps/api/src/routes/__tests__/ingress.test.ts
// ---------------------------------------------------------------------------
// POST /api/ingress/submit hardening (F3 + F11):
//   F3  — the public operator edge must refuse the service-only
//         `payment.record_verified` intent so a tenant API key cannot forge a
//         verified payment (docs/audits/2026-06-10-security-audit/11-tickets.md).
//   F11 — the one mutating endpoint with no body validation now safeParses a
//         Zod schema (malformed/over-shaped body -> 400), while still accepting
//         every legitimate shape including the CTWA system-actor path.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ingressRoutes } from "../ingress.js";

async function buildApp(
  submit = vi.fn(async () => ({ ok: true, workUnit: { id: "wu", traceId: "t" } })),
) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true as never);
  app.decorate("platformIngress", { submit } as never);
  await app.register(ingressRoutes, { prefix: "/api" });
  await app.ready();
  return { app, submit };
}

function inject(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/ingress/submit",
    headers: {
      "content-type": "application/json",
      "x-org-id": "org-1",
      "idempotency-key": "k1",
    },
    payload: body as never,
  });
}

describe("POST /api/ingress/submit hardening (F3 + F11)", () => {
  it("F3: refuses payment.record_verified on the public edge (403), never submits", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      actor: { id: "attacker", type: "user" },
      intent: "payment.record_verified",
      parameters: { externalReference: "FAKE", provider: "stripe", amountCents: 999999 },
      trigger: "api",
    });
    expect(res.statusCode).toBe(403);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("F11: a malformed body (parameters not an object) is 400, never submits", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      intent: "operator.record_revenue",
      parameters: "nope",
      trigger: "api",
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("F11: a missing intent is 400", async () => {
    const { app } = await buildApp();
    const res = await inject(app, { parameters: {}, trigger: "api" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("accepts a well-formed operator submit", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      actor: { id: "u1", type: "user" },
      intent: "operator.transition_opportunity_stage",
      parameters: { id: "opp-1", stage: "won" },
      trigger: "api",
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("accepts the CTWA shape (system actor, trigger internal, targetHint, parentWorkUnitId)", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      organizationId: "org-1",
      actor: { id: "system", type: "system" },
      intent: "ctwa.lead_intake",
      parameters: { organizationId: "org-1", deploymentId: "dep-1" },
      trigger: "internal",
      surface: { surface: "chat" },
      targetHint: { deploymentId: "dep-1" },
      parentWorkUnitId: "wu-parent",
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
