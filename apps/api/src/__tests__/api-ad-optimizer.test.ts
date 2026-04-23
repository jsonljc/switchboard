import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { adOptimizerRoutes } from "../routes/ad-optimizer.js";

describe("Ad-Optimizer Webhook Verification", () => {
  let app: FastifyInstance;
  let savedToken: string | undefined;

  beforeEach(async () => {
    savedToken = process.env["META_WEBHOOK_VERIFY_TOKEN"];
    app = Fastify();
    await app.register(adOptimizerRoutes, { prefix: "/api/ad-optimizer" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (savedToken !== undefined) {
      process.env["META_WEBHOOK_VERIFY_TOKEN"] = savedToken;
    } else {
      delete process.env["META_WEBHOOK_VERIFY_TOKEN"];
    }
  });

  it("returns 500 when META_WEBHOOK_VERIFY_TOKEN is not set", async () => {
    delete process.env["META_WEBHOOK_VERIFY_TOKEN"];

    const res = await app.inject({
      method: "GET",
      url: "/api/ad-optimizer/leads/webhook",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "any-token",
        "hub.challenge": "challenge-123",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("not configured");
  });

  it("returns 200 with challenge when token matches", async () => {
    process.env["META_WEBHOOK_VERIFY_TOKEN"] = "my-secret-token";

    const res = await app.inject({
      method: "GET",
      url: "/api/ad-optimizer/leads/webhook",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "my-secret-token",
        "hub.challenge": "challenge-abc",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("challenge-abc");
  });

  it("returns 403 when token does not match", async () => {
    process.env["META_WEBHOOK_VERIFY_TOKEN"] = "my-secret-token";

    const res = await app.inject({
      method: "GET",
      url: "/api/ad-optimizer/leads/webhook",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "challenge-xyz",
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
