import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
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

describe("Meta lead webhook → meta.lead.intake submit", () => {
  let app: FastifyInstance;
  let captured: { intent?: string; targetHint?: { skillSlug?: string } } | null;
  let savedSecret: string | undefined;
  const APP_SECRET = "test-meta-app-secret";

  beforeEach(async () => {
    savedSecret = process.env["META_APP_SECRET"];
    process.env["META_APP_SECRET"] = APP_SECRET;
    captured = null;
    app = Fastify();
    await app.register(rawBody, {
      field: "rawBody",
      global: false,
      encoding: "utf8",
      runFirst: true,
    });
    app.decorate("prisma", {
      connection: {
        findFirst: async () => ({ organizationId: "org_1", greetingTemplateName: "lead_welcome" }),
      },
    } as never);
    app.decorate("platformIngress", {
      submit: async (req: { intent?: string; targetHint?: { skillSlug?: string } }) => {
        captured = req;
        return { ok: true, workUnit: { id: "wu_1", traceId: "trace_1" } };
      },
    } as never);
    await app.register(adOptimizerRoutes, { prefix: "/api/ad-optimizer" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (savedSecret !== undefined) process.env["META_APP_SECRET"] = savedSecret;
    else delete process.env["META_APP_SECRET"];
  });

  it("targets the real Alex deployment (skillSlug alex), not the unseeded meta-lead slug", async () => {
    // meta-lead is not a seeded deployment slug, so it threw deployment_not_found and the inbound
    // paid-lead funnel was prod-inert. meta.lead.intake threads its resolved deploymentId into the
    // lead it ingests, so it must resolve the REAL Alex deployment (correct lead attribution).
    const body = JSON.stringify({
      entry: [
        {
          id: "entry-1",
          changes: [
            { field: "leadgen", value: { leadgen_id: "lead-1", ad_id: "ad-1", form_id: "form-1" } },
          ],
        },
      ],
    });
    const signature = "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/api/ad-optimizer/leads/webhook",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(captured?.intent).toBe("meta.lead.intake");
    expect(captured?.targetHint?.skillSlug).toBe("alex");
  });
});
