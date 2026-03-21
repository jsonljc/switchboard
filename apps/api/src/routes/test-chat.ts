import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

export const testChatRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/test-chat/message
  // Accepts: { agentId: string, message: string, conversationHistory?: Array<{ role: string; text: string }> }
  // Retrieves KB chunks sorted by sourceType priority (correction > wizard > document)
  // Returns stub reply based on KB context
  // Returns: { reply: string, confidence: number, kbChunksUsed: number, kbContext: string, mode: "test" }
  app.post(
    "/message",
    {
      schema: {
        description: "Send a test message through an agent handler (no WhatsApp delivery).",
        tags: ["TestChat"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const body = request.body as {
        agentId: string;
        message: string;
        conversationHistory?: Array<{ role: string; text: string }>;
      };

      if (!body.agentId || !body.message) {
        return reply.code(400).send({ error: "agentId and message are required", statusCode: 400 });
      }

      // Retrieve KB chunks, prioritize corrections > wizard > documents
      const chunks = await app.prisma.$queryRawUnsafe<
        Array<{ content: string; sourceType: string }>
      >(
        `SELECT content, "sourceType" FROM "KnowledgeChunk"
         WHERE "organizationId" = $1 AND "agentId" = $2
         ORDER BY "sourceType" = 'correction' DESC, "sourceType" = 'wizard' DESC
         LIMIT 5`,
        orgId,
        body.agentId,
      );

      const kbContext = chunks.map((c) => c.content).join("\n---\n");
      const hasKnowledge = chunks.length > 0;

      const replyText = hasKnowledge
        ? `Based on our information: ${chunks[0]?.content?.slice(0, 200) ?? ""}...`
        : "I don't have enough information to answer that yet. Please upload your business documents.";

      const confidence = hasKnowledge ? 0.7 : 0.3;

      return reply.code(200).send({
        reply: replyText,
        confidence,
        kbChunksUsed: chunks.length,
        kbContext: kbContext.slice(0, 500),
        mode: "test",
      });
    },
  );
};
