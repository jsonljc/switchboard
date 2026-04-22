import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("API runtime convergence", () => {
  let app: FastifyInstance;
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("routes /api/execute through PlatformIngress without pre-resolved deployment input", async () => {
    const submitSpy = vi.spyOn(app.platformIngress, "submit");

    await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "conv-execute" },
      payload: {
        actorId: "default",
        organizationId: "org_test",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp-1" },
          sideEffect: true,
        },
      },
    });

    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[0]).not.toHaveProperty("deployment");
    expect(submitSpy.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_test",
      intent: "digital-ads.campaign.pause",
      surface: { surface: "api" },
    });
  });
});
