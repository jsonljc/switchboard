import type { FastifyPluginAsync } from "fastify";
import { createEventEnvelope } from "@switchboard/schemas";
import type { RoutedEventEnvelope } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const agentConversationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/message",
    {
      schema: {
        description: "Process an inbound message through the agent EventLoop.",
        tags: ["Conversation"],
        body: {
          type: "object",
          required: ["contactId", "messageText", "organizationId"],
          additionalProperties: false,
          properties: {
            contactId: { type: "string", minLength: 1, maxLength: 255 },
            messageText: { type: "string", minLength: 1, maxLength: 4000 },
            channel: { type: "string", default: "whatsapp", maxLength: 50 },
            organizationId: { type: "string", minLength: 1, maxLength: 255 },
            metadata: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { contactId, messageText, channel, metadata } = request.body as {
        contactId: string;
        messageText: string;
        channel?: string;
        metadata?: Record<string, unknown>;
      };

      const agentSystem = app.agentSystem;
      if (!agentSystem?.eventLoop) {
        return reply.code(503).send({ error: "Agent system not available" });
      }

      // 1. Create message.received event (orgId from auth scope, not request body)
      const event: RoutedEventEnvelope = createEventEnvelope({
        organizationId: orgId,
        eventType: "message.received",
        source: { type: "webhook", id: channel ?? "whatsapp" },
        payload: { contactId, messageText, channel: channel ?? "whatsapp" },
        metadata,
      });

      // 2. Process through EventLoop
      try {
        const result = await agentSystem.eventLoop.process(event, {
          organizationId: orgId,
        });

        let escalated = false;
        let handedOffTo: string | null = null;

        for (const agent of result.processed) {
          for (const evtType of agent.outputEvents) {
            if (evtType === "conversation.escalated") {
              escalated = true;
            }
            if (evtType === "lead.qualified") {
              handedOffTo = (event.metadata?.targetAgentId as string) ?? null;
            }
          }

          if (!agent.success || agent.agentId === "unrouted") {
            escalated = true;
          }
        }

        if (result.processed.length === 0) {
          escalated = true;
        }

        // 3. Save thread updates from agent processing
        if (result.processed.length > 0) {
          const thread = event.metadata?.conversationThread as { id: string } | undefined;
          if (thread && agentSystem.threadStore) {
            for (const agent of result.processed) {
              if (agent.threadUpdate) {
                try {
                  await agentSystem.threadStore.update(thread.id, agent.threadUpdate);
                } catch (err) {
                  app.log.error({ err, threadId: thread.id }, "Failed to save thread update");
                }
              }
            }
          }
        }

        return reply.code(200).send({
          escalated,
          handedOffTo,
          agentId: (event.metadata?.targetAgentId as string) ?? null,
        });
      } catch (err) {
        app.log.error({ err, contactId }, "EventLoop processing error");
        return reply.code(500).send({ error: "Failed to process message" });
      }
    },
  );
};
