import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createHmac } from "node:crypto";
import { registerManagedWebhookRoutes } from "../routes/managed-webhook.js";
import { registerSlackFormEncodedParser } from "../routes/slack-form-parser.js";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";

// F9 — the managed webhook verified the HMAC against JSON.stringify(request.body)
// (a re-serialized copy) because the chat app registered no raw-JSON body parser.
// Re-serialization is not byte-identical to what Meta/Slack signed (key order,
// unicode escaping, whitespace), so valid inbound messages were silently 401'd.
// These tests pin verification to the TRUE raw bytes captured by fastify-raw-body.

const APP_SECRET = "test-app-secret-f9";

// A NON-canonical WhatsApp envelope: contains \u-escaped characters (é, 🎉) and
// insignificant whitespace, so JSON.stringify(JSON.parse(raw)) is NOT byte-identical.
// No `messages` array → parseIncomingMessage returns null → a verified request
// short-circuits to 200 with no network side effects.
const NON_CANONICAL_RAW =
  '{"object":"whatsapp_business_account", "entry":[{"id":"123","changes":[{"value":' +
  '{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15551230000"},' +
  '"contacts":[{"profile":{"name":"Caf\\u00e9 \\ud83c\\udf89"},"wa_id":"6591234567"}]},' +
  '"field":"messages"}]}]}';

const CANONICAL_RAW = JSON.stringify(JSON.parse(NON_CANONICAL_RAW));

function sign(raw: string, secret = APP_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

function makeWhatsAppEntry(): GatewayEntry {
  return {
    channel: "whatsapp",
    deploymentConnectionId: "dc-1",
    orgId: "org-1",
    gateway: { handleIncoming: vi.fn(async () => {}) } as unknown as GatewayEntry["gateway"],
    adapter: new WhatsAppAdapter({
      token: "t",
      phoneNumberId: "p",
      appSecret: APP_SECRET,
    }) as unknown as GatewayEntry["adapter"],
  } as GatewayEntry;
}

// Faithful harness: mirrors production wiring (Slack form parser + fastify-raw-body
// global:false). withRawBody=false simulates a route where raw capture is NOT wired.
async function buildApp(
  entry: GatewayEntry | null,
  opts: { withRawBody?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSlackFormEncodedParser(app);
  if (opts.withRawBody !== false) {
    await app.register(rawBody, {
      field: "rawBody",
      global: false,
      encoding: "utf8",
      runFirst: true,
    });
  }
  registerManagedWebhookRoutes(app, { registry: { getGatewayByWebhookPath: () => entry } });
  await app.ready();
  return app;
}

describe("managed webhook HMAC over true raw bytes (F9)", () => {
  it("self-check: the test payload is genuinely non-canonical", () => {
    expect(CANONICAL_RAW).not.toEqual(NON_CANONICAL_RAW);
  });

  it("verifies a non-canonical raw payload (the F9 regression)", async () => {
    const app = await buildApp(makeWhatsAppEntry());
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(NON_CANONICAL_RAW),
      },
      payload: NON_CANONICAL_RAW,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a payload signed over the re-serialized body (raw bytes are authoritative)", async () => {
    // Body is NON_CANONICAL_RAW, but the signature is computed over its canonical
    // re-serialization (CANONICAL_RAW). A route that (incorrectly) HMAC'd
    // JSON.stringify(request.body) would ACCEPT this (200); verifying over the true
    // raw bytes REJECTS it (401). This pins "raw bytes are authoritative".
    const app = await buildApp(makeWhatsAppEntry());
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(CANONICAL_RAW),
      },
      payload: NON_CANONICAL_RAW,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("verifies a canonical raw payload", async () => {
    const app = await buildApp(makeWhatsAppEntry());
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(CANONICAL_RAW),
      },
      payload: CANONICAL_RAW,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a tampered signature (no regression)", async () => {
    const app = await buildApp(makeWhatsAppEntry());
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(NON_CANONICAL_RAW, "wrong-secret"),
      },
      payload: NON_CANONICAL_RAW,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed when raw-body capture is not wired", async () => {
    // Canonical body + correct signature, but no fastify-raw-body plugin. The old
    // JSON.stringify fallback would have verified (200); fail-closed must 401.
    const app = await buildApp(makeWhatsAppEntry(), { withRawBody: false });
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(CANONICAL_RAW),
      },
      payload: CANONICAL_RAW,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("still answers the Slack url_verification handshake", async () => {
    const slackEntry = {
      channel: "slack",
      deploymentConnectionId: "dc-1",
      orgId: "org-1",
      gateway: { handleIncoming: vi.fn(async () => {}) },
      adapter: { channel: "slack", parseIncomingMessage: () => null, extractMessageId: () => null },
    } as unknown as GatewayEntry;
    const app = await buildApp(slackEntry);
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

  it("preserves the Slack form-encoded path and its raw body (coexistence)", async () => {
    // fastify-raw-body must not clobber the custom form parser. The fake adapter
    // asserts it received the exact raw form bytes for HMAC.
    const innerPayload = JSON.stringify({ type: "block_actions", actions: [] });
    const rawForm = `payload=${encodeURIComponent(innerPayload)}`;
    let seenRaw: string | undefined;
    const slackEntry = {
      channel: "slack",
      deploymentConnectionId: "dc-1",
      orgId: "org-1",
      gateway: { handleIncoming: vi.fn(async () => {}) },
      adapter: {
        channel: "slack",
        verifyRequest: (raw: string) => {
          seenRaw = raw;
          return true;
        },
        parseIncomingMessage: () => null,
        extractMessageId: () => null,
      },
    } as unknown as GatewayEntry;
    const app = await buildApp(slackEntry);
    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: rawForm,
    });
    expect(res.statusCode).toBe(200);
    expect(seenRaw).toBe(rawForm);
    await app.close();
  });
});
