import type { FastifyInstance } from "fastify";
import type { ChannelGateway, ReplySink } from "@switchboard/core";
import type { SseSessionManager } from "./widget-sse-manager.js";
import { checkIngressRateLimit } from "../adapters/security.js";

interface WidgetMessageBody {
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string; fbclid?: string };
}

export function registerWidgetMessagesEndpoint(
  app: FastifyInstance,
  gateway: ChannelGateway,
  sseManager: SseSessionManager,
): void {
  app.post<{ Params: { token: string }; Body: WidgetMessageBody }>(
    "/widget/:token/messages",
    async (request, reply) => {
      // CORS
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");

      const { token } = request.params;
      const { sessionId, text, visitor } = request.body ?? {};

      if (!sessionId || !text?.trim()) {
        return reply.code(400).send({ error: "sessionId and text are required" });
      }

      // Rate limit: 20 messages/minute per IP+session
      const rateLimitKey = `widget:${request.ip}:${sessionId}`;
      if (!(await checkIngressRateLimit(rateLimitKey, { windowMs: 60_000, maxRequests: 20 }))) {
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const messageId = crypto.randomUUID();

      // Build replySink wired to SSE
      const replySink: ReplySink = {
        send: async (replyText: string) => {
          sseManager.sendMessage(sessionId, "assistant", replyText);
        },
        onTyping: () => {
          sseManager.sendTyping(sessionId);
        },
      };

      // Fire-and-forget — reply is delivered via SSE, not in the HTTP response
      gateway
        .handleIncoming(
          { channel: "web_widget", token, sessionId, text: text.trim(), visitor },
          replySink,
        )
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : "Failed to process message";
          if (errMsg.includes("No deployment found")) {
            sseManager.sendError(sessionId, "Invalid widget token");
          } else {
            app.log.error(err, "Widget message error");
            sseManager.sendError(sessionId, "Failed to get response");
          }
        });

      return reply.code(200).send({ messageId });
    },
  );

  // CORS preflight
  app.options("/widget/:token/messages", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    return reply.code(204).send();
  });
}
