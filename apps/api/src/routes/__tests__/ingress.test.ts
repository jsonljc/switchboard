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
      intent: "operator.transition_opportunity_stage",
      parameters: { id: "opp-1", stage: "won" },
      trigger: "api",
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  // The non-actor parts of the legacy CTWA shape (targetHint, parentWorkUnitId,
  // trigger internal) are still accepted; the actor is bound from the principal, not
  // the body. (The real CTWA path uses the INTERNAL_API_SECRET /internal edge.)
  it("accepts the CTWA-adjacent shape minus actor (targetHint, parentWorkUnitId, trigger internal)", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      organizationId: "org-1",
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

  it("F11: an over-long parameter key (beyond boundedParameters) is 400, never submits", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      intent: "operator.transition_opportunity_stage",
      parameters: { ["k".repeat(201)]: 1 },
      trigger: "api",
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  // Audit (autoexec-ingress): the public operator edge must NEVER let the request
  // body choose the actor identity. The actor is bound from the authenticated
  // principal (request.actorId); the body field is rejected by the strict schema so
  // a caller cannot silently spoof `system`/another principal for audit + governance.
  it("binds the authenticated principal as the actor, not a placeholder", async () => {
    const { app, submit } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/ingress/submit",
      headers: {
        "content-type": "application/json",
        "x-org-id": "org-1",
        "x-principal-id": "op-7",
        "idempotency-key": "k1",
      },
      payload: {
        intent: "operator.transition_opportunity_stage",
        parameters: { id: "opp-1", stage: "won" },
        trigger: "api",
      } as never,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    const args = submit.mock.calls[0] as unknown as [{ actor: { id: string; type: string } }];
    expect(args[0].actor).toEqual({ id: "op-7", type: "user" });
    await app.close();
  });

  it("rejects a body that carries an actor identity (no caller-supplied actor) -> 400, never submits", async () => {
    const { app, submit } = await buildApp();
    const res = await inject(app, {
      actor: { id: "system", type: "system" },
      intent: "operator.transition_opportunity_stage",
      parameters: { id: "opp-1", stage: "won" },
      trigger: "api",
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });
});
