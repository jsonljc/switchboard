import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";
import {
  registerManagedWebhookRoutes,
  type ManagedWebhookDeps,
} from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";
import { SlackAdapter } from "../adapters/slack.js";
import { registerSlackFormEncodedParser } from "../routes/slack-form-parser.js";
import { createHmac } from "node:crypto";

// The gateway binds approval responses on the stable channel USER id
// (OperatorChannelBinding doctrine; bridge spec section 5). The route must
// forward the adapter's principalId alongside sessionId or Slack taps present
// the channel id and every binding lookup fails closed.

type GatewayInput = {
  channel: string;
  token: string;
  sessionId: string;
  principalId?: string;
  text: string;
};

/** Arg-typed spy: the chat build runs tsc over tests, and an untyped vi.fn
 * gives mock.calls an empty-tuple type that cannot be indexed. */
function gatewaySpy() {
  return vi.fn(async (_input: GatewayInput, _sink: unknown) => {});
}

function makeEntry(
  adapter: GatewayEntry["adapter"],
  handleIncoming: ReturnType<typeof gatewaySpy>,
): GatewayEntry {
  return {
    channel: "slack",
    deploymentConnectionId: "dc-1",
    orgId: "org-1",
    gateway: { handleIncoming } as unknown as GatewayEntry["gateway"],
    adapter,
  };
}

async function buildApp(entry: GatewayEntry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // The REAL production form decoder (extracted from main.ts): block_actions
  // arrive form-encoded; the parser unwraps `payload` and preserves rawBody.
  registerSlackFormEncodedParser(app);
  // fastify-raw-body for the JSON path (mirrors main.ts); the route verifies the HMAC
  // over the true raw bytes and fails closed without them (F9). The Slack form parser
  // above continues to supply rawBody for the form-encoded interactive path.
  await app.register(fastifyRawBody, {
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

describe("managed webhook identity forwarding", () => {
  it("forwards the Slack user id as principalId for block_actions taps", async () => {
    // Real adapter, no signing secret: verifyRequest passes in non-production.
    const adapter = new SlackAdapter("xoxb-test") as unknown as GatewayEntry["adapter"];
    const handleIncoming = gatewaySpy();
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: {
        type: "block_actions",
        user: { id: "U12345" },
        channel: { id: "C67890" },
        team: { id: "T11111" },
        actions: [
          {
            action_id: "approval_approve",
            value: JSON.stringify({
              action: "approve",
              approvalId: "lc_1",
              bindingHash: "hash123",
            }),
            type: "button",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    await app.close();
  });

  it("forwards principalId for events-API messages too", async () => {
    const adapter = new SlackAdapter("xoxb-test") as unknown as GatewayEntry["adapter"];
    const handleIncoming = gatewaySpy();
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: {
        team_id: "T11111",
        event: {
          type: "message",
          client_msg_id: "msg_1",
          ts: "1700000000.000001",
          channel: "C67890",
          user: "U12345",
          text: "hello",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    await app.close();
  });

  it("a REAL form-encoded signed interactivity POST (the wire shape Slack sends) forwards identity", async () => {
    // Signature verification runs over the RAW form body; the parser must
    // preserve it. This is the production encoding path end to end: form decode
    // -> rawBody HMAC -> adapter parse -> identity forwarding.
    const SIGNING_SECRET = "test-signing-secret";
    const adapter = new SlackAdapter(
      "xoxb-test",
      SIGNING_SECRET,
    ) as unknown as GatewayEntry["adapter"];
    const handleIncoming = gatewaySpy();
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const interactivityPayload = {
      type: "block_actions",
      user: { id: "U12345" },
      channel: { id: "C67890" },
      team: { id: "T11111" },
      actions: [
        {
          action_id: "approval_approve",
          value: JSON.stringify({ action: "approve", approvalId: "lc_1", bindingHash: "h1" }),
          type: "button",
        },
      ],
    };
    const rawBody = new URLSearchParams({
      payload: JSON.stringify(interactivityPayload),
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    expect(input.text).toBe(
      JSON.stringify({ action: "approve", approvalId: "lc_1", bindingHash: "h1" }),
    );
    await app.close();
  });

  it("a tampered form body fails signature verification (rawBody is what gets signed)", async () => {
    const SIGNING_SECRET = "test-signing-secret";
    const adapter = new SlackAdapter(
      "xoxb-test",
      SIGNING_SECRET,
    ) as unknown as GatewayEntry["adapter"];
    const handleIncoming = gatewaySpy();
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const rawBody = new URLSearchParams({
      payload: JSON.stringify({ type: "block_actions" }),
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", SIGNING_SECRET)
        .update(`v0:${timestamp}:${rawBody}DIFFERENT`)
        .digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(handleIncoming).not.toHaveBeenCalled();
    await app.close();
  });

  it("a stable-identity adapter (WhatsApp shape) yields principalId === sessionId", async () => {
    const adapter = {
      channel: "whatsapp",
      verifyRequest: () => true,
      parseIncomingMessage: () => ({
        id: "wa_1",
        channel: "whatsapp" as const,
        channelMessageId: "wamid.1",
        threadId: "+6591234567",
        principalId: "+6591234567",
        organizationId: null,
        text: "hi",
        attachments: [],
        timestamp: new Date(),
      }),
      extractMessageId: () => null,
      sendTextReply: vi.fn(async () => {}),
    } as unknown as GatewayEntry["adapter"];
    const handleIncoming = gatewaySpy();
    const app = await buildApp({ ...makeEntry(adapter, handleIncoming), channel: "whatsapp" });

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: { any: "thing" },
    });

    expect(res.statusCode).toBe(200);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.principalId).toBe("+6591234567");
    expect(input.sessionId).toBe("+6591234567");
    await app.close();
  });
});
