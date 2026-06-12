import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import {
  registerManagedWebhookRoutes,
  type ManagedWebhookDeps,
} from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";

// Cat 1.6 / api-consistency "Missing auth guards on webhook routes":
// the managed webhook only verified the signature when the adapter happened to
// implement verifyRequest, silently accepting unsigned payloads for any adapter
// that lacks it. It must fail closed when no verifier is available.

function makeEntry(adapter: Partial<GatewayEntry["adapter"]>): GatewayEntry {
  return {
    channel: "slack",
    deploymentConnectionId: "dc-1",
    orgId: "org-1",
    gateway: {
      handleIncoming: vi.fn(async () => {}),
    } as unknown as GatewayEntry["gateway"],
    adapter: {
      channel: "slack",
      parseIncomingMessage: () => null,
      extractMessageId: () => null,
      sendTextReply: vi.fn(async () => {}),
      ...adapter,
    } as unknown as GatewayEntry["adapter"],
  };
}

async function buildApp(entry: GatewayEntry | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Mirror production: the managed route opts into raw-body capture, and the route
  // fails closed when request.rawBody is absent. Register the plugin so this harness
  // exercises the real wiring (otherwise the verify-passes case would 401 on missing raw).
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  const deps: ManagedWebhookDeps = {
    registry: { getGatewayByWebhookPath: () => entry },
  };
  registerManagedWebhookRoutes(app, deps);
  await app.ready();
  return app;
}

async function post(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/webhook/managed/abc",
    headers: { "content-type": "application/json" },
    payload: { some: "payload" },
  });
}

describe("managed webhook signature enforcement", () => {
  it("rejects when the adapter cannot verify the request (no verifyRequest)", async () => {
    const app = await buildApp(makeEntry({ verifyRequest: undefined }));
    const res = await post(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects when the adapter's verifyRequest fails", async () => {
    const app = await buildApp(makeEntry({ verifyRequest: () => false }));
    const res = await post(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("processes when the adapter's verifyRequest passes", async () => {
    const app = await buildApp(makeEntry({ verifyRequest: () => true }));
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("still answers the Slack url_verification handshake before signature checks", async () => {
    const app = await buildApp(makeEntry({ verifyRequest: undefined }));
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: { type: "url_verification", challenge: "xyz" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ challenge: "xyz" });
    await app.close();
  });
});
