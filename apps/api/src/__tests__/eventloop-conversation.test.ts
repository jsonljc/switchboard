import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { agentConversationRoutes } from "../routes/conversation.js";

function buildApp(agentSystem?: unknown) {
  const app = Fastify();

  // Simulate auth middleware setting organizationIdFromAuth
  app.decorateRequest("organizationIdFromAuth", "");
  app.addHook("preHandler", async (request) => {
    (request as unknown as Record<string, unknown>).organizationIdFromAuth = "org1";
  });

  if (agentSystem) {
    Object.assign(app, { agentSystem });
  }

  return app;
}

describe("POST /api/conversation/message", () => {
  it("returns 503 when agent system is not available", async () => {
    const app = buildApp();
    await app.register(agentConversationRoutes, { prefix: "/api/conversation" });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversation/message",
      payload: {
        contactId: "c1",
        messageText: "hello",
        organizationId: "org1",
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Agent system not available" });
  });

  it("returns success when EventLoop processes the event", async () => {
    const app = buildApp({
      eventLoop: {
        process: vi.fn().mockResolvedValue({
          processed: [
            {
              eventId: "e1",
              eventType: "message.received",
              agentId: "lead-responder",
              success: true,
              actionsExecuted: ["messaging.whatsapp.send"],
              actionsFailed: [],
              outputEvents: [],
            },
          ],
          depth: 1,
        }),
      },
      conversationRouter: undefined,
    });

    await app.register(agentConversationRoutes, { prefix: "/api/conversation" });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversation/message",
      payload: {
        contactId: "c1",
        messageText: "hello",
        organizationId: "org1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.escalated).toBe(false);
    expect(body.agentId).toBe("lead-responder");
  });

  it("returns escalated=true when no agent handles the message", async () => {
    const app = buildApp({
      eventLoop: {
        process: vi.fn().mockResolvedValue({
          processed: [
            {
              eventId: "e1",
              eventType: "message.received",
              agentId: "unrouted",
              success: false,
              actionsExecuted: [],
              actionsFailed: [],
              outputEvents: [],
            },
          ],
          depth: 1,
        }),
      },
      conversationRouter: undefined,
    });

    await app.register(agentConversationRoutes, { prefix: "/api/conversation" });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversation/message",
      payload: {
        contactId: "c1",
        messageText: "hello",
        organizationId: "org1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.escalated).toBe(true);
  });

  it("rejects oversized messageText", async () => {
    const app = buildApp({
      eventLoop: { process: vi.fn() },
      conversationRouter: undefined,
    });

    await app.register(agentConversationRoutes, { prefix: "/api/conversation" });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversation/message",
      payload: {
        contactId: "c1",
        messageText: "x".repeat(5000),
        organizationId: "org1",
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
