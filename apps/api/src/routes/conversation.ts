import type { FastifyPluginAsync } from "fastify";
import { createEventEnvelope } from "@switchboard/agents";
import type { RoutedEventEnvelope } from "@switchboard/agents";
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
      let event: RoutedEventEnvelope = createEventEnvelope({
        organizationId: orgId,
        eventType: "message.received",
        source: { type: "webhook", id: channel ?? "whatsapp" },
        payload: { contactId, messageText, channel: channel ?? "whatsapp" },
        metadata,
      });

      // 2. Run through ConversationRouter to set targetAgentId
      if (agentSystem.conversationRouter) {
        try {
          event = await agentSystem.conversationRouter.transform(event);
        } catch (err) {
          app.log.error({ err, contactId }, "ConversationRouter error");
        }
      }

      // 3. Check for owner escalation (no agent handles this stage)
      if (event.metadata?.escalateToOwner) {
        // Attempt fallback handling if lifecycle deps are available
        const fallbackHandler = app.lifecycleDeps?.fallbackHandler;
        if (fallbackHandler) {
          try {
            const now = new Date();
            const fallbackResult = await fallbackHandler.handleUnrouted({
              contact: {
                id: contactId,
                organizationId: orgId,
                name: null,
                phone: null,
                email: null,
                primaryChannel: (channel as "whatsapp" | "telegram" | "dashboard") ?? "whatsapp",
                stage: "new",
                roles: ["lead"],
                firstContactAt: now,
                lastActivityAt: now,
                createdAt: now,
                updatedAt: now,
              },
              opportunity: null,
              recentMessages: [],
              missingCapability: (event.metadata?.missingAgent as string) ?? "agent",
              fallbackReason:
                (event.metadata?.fallbackReason as "not_configured" | "paused" | "errored") ??
                "not_configured",
            });

            return reply.code(200).send({
              escalated: true,
              reason: "no_agent_for_stage",
              agentId: null,
              fallbackTaskId: fallbackResult.task?.id ?? null,
            });
          } catch (err) {
            app.log.error({ err, contactId }, "FallbackHandler error");
          }
        }

        return reply.code(200).send({
          escalated: true,
          reason: "no_agent_for_stage",
          agentId: null,
        });
      }

      // 4. Process through EventLoop
      // Note: replies are delivered by the ActionExecutor directly via the messaging channel,
      // not returned in this response. This endpoint confirms processing status only.
      try {
        const result = await agentSystem.eventLoop.process(event, { organizationId: orgId });

        let escalated = false;
        let handedOffTo: string | null = null;

        for (const agent of result.processed) {
          for (const evtType of agent.outputEvents) {
            if (evtType === "conversation.escalated") {
              escalated = true;
            }
            if (evtType === "lead.qualified") {
              handedOffTo = "sales-closer";
            }
          }

          if (!agent.success || agent.agentId === "unrouted") {
            escalated = true;
          }
        }

        if (result.processed.length === 0) {
          escalated = true;
        }

        // 5. Save thread updates from agent processing
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
          agentId: (event.metadata?.targetAgentId as string) ?? "lead-responder",
        });
      } catch (err) {
        app.log.error({ err, contactId }, "EventLoop processing error");
        return reply.code(500).send({ error: "Failed to process message" });
      }
    },
  );
};
