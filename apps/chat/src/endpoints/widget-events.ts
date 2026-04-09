import type { FastifyInstance } from "fastify";
import type { SseSessionManager } from "./widget-sse-manager.js";

export function registerWidgetEventsEndpoint(
  app: FastifyInstance,
  sseManager: SseSessionManager,
): void {
  app.get<{ Params: { token: string }; Querystring: { sessionId?: string } }>(
    "/widget/:token/events",
    async (request, reply) => {
      // CORS
      reply.header("Access-Control-Allow-Origin", "*");

      const { sessionId } = request.query;
      if (!sessionId) {
        return reply.code(400).send({ error: "sessionId query param is required" });
      }

      // Take over the response from Fastify — we're managing the stream manually
      reply.hijack();

      // SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      sseManager.register(sessionId, reply);

      // Clean up on client disconnect
      request.raw.on("close", () => {
        sseManager.remove(sessionId);
      });
    },
  );
}
