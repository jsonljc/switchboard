import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { agentConversationRoutes } from "../routes/conversation.js";

describe("POST /api/conversation/message", () => {
  it("returns 503 when agent system is not available", async () => {
    const app = Fastify();
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
    const app = Fastify();

    // Use Object.assign to avoid Fastify decorate type constraints
    Object.assign(app, {
      agentSystem: {
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
      },
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
    const app = Fastify();

    Object.assign(app, {
      agentSystem: {
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
      },
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
});
