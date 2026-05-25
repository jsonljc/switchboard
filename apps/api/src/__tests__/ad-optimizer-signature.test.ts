import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createHmac } from "node:crypto";
import { adOptimizerRoutes } from "../routes/ad-optimizer.js";

// Cat 1.6 / api-consistency "Missing auth guards on webhook routes":
// the Meta Leads POST webhook resolved org from a forgeable `entry.id` with no
// signature verification. It must verify the Meta X-Hub-Signature-256 HMAC
// (computed with META_APP_SECRET over the raw body) and fail closed otherwise.

const APP_SECRET = "test-app-secret";
// Valid JSON that parseLeadWebhook resolves to zero leads, so a verified
// request short-circuits at 200 without needing prisma/ingress.
const PAYLOAD = JSON.stringify({ object: "page", entry: [] });

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  await app.register(adOptimizerRoutes, { prefix: "/api/marketplace" });
  await app.ready();
  return app;
}

async function postWebhook(app: FastifyInstance, signature: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/api/marketplace/leads/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    payload: PAYLOAD,
  });
}

describe("Ad-Optimizer lead webhook signature verification", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env["META_APP_SECRET"];
    process.env["META_APP_SECRET"] = APP_SECRET;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env["META_APP_SECRET"];
    else process.env["META_APP_SECRET"] = saved;
  });

  it("accepts a request carrying a valid X-Hub-Signature-256", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, APP_SECRET));
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a request with no signature header", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, undefined);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a forged signature", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, "wrong-secret"));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed when META_APP_SECRET is not configured", async () => {
    delete process.env["META_APP_SECRET"];
    const app = await buildApp();
    // Even a structurally valid-looking signature must be rejected.
    const res = await postWebhook(app, sign(PAYLOAD, APP_SECRET));
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
