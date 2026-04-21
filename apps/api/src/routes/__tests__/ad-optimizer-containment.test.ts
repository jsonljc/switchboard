import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adOptimizerRoutes } from "../ad-optimizer.js";

describe("adOptimizerRoutes containment", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  const submit = vi.fn();

  beforeEach(async () => {
    submit.mockReset();
    submit.mockResolvedValue({
      ok: true,
      result: {
        workUnitId: "wu_1",
        outcome: "completed",
        summary: "Processed 1 leads",
        outputs: { received: 1, created: 1 },
        mode: "workflow",
        durationMs: 5,
        traceId: "trace_1",
      },
      workUnit: {} as never,
    });

    app = Fastify({ logger: false });
    app.decorate("platformIngress", { submit } as never);
    app.decorate("deploymentResolver", null);
    app.decorate("prisma", {
      connection: {
        findFirst: vi.fn().mockResolvedValue({
          organizationId: "org_1",
          greetingTemplateName: "lead_welcome",
        }),
      },
    } as never);
    app.decorateRequest("traceId", null);
    app.addHook("preHandler", async (request) => {
      (request as Record<string, unknown>).traceId = "trace_req_1";
    });
    await app.register(adOptimizerRoutes, { prefix: "/api/marketplace" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("submits Meta lead intake through PlatformIngress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/leads/webhook",
      payload: {
        entry: [{ id: "page_1", changes: [] }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      actor: { id: "meta:page_1", type: "service" },
      intent: "meta.lead.intake",
      trigger: "internal",
    });
  });

  it("returns 200 even when ingress rejects the work", async () => {
    submit.mockResolvedValue({
      ok: false,
      error: { type: "intent_not_found", intent: "meta.lead.intake", message: "Not found" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/leads/webhook",
      payload: { entry: [{ id: "page_1" }] },
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns early when no entry ID is present", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/leads/webhook",
      payload: { entry: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(submit).not.toHaveBeenCalled();
  });

  it("preserves GET verification endpoint", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/leads/webhook",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "switchboard-verify",
        "hub.challenge": "test_challenge",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("test_challenge");
  });
});
