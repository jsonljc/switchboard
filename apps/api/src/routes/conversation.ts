import type { FastifyPluginAsync } from "fastify";
import { createEventEnvelope } from "@switchboard/agents";
import type { RoutedEventEnvelope } from "@switchboard/agents";

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
          properties: {
            contactId: { type: "string" },
            messageText: { type: "string" },
            channel: { type: "string", default: "whatsapp" },
            organizationId: { type: "string" },
            metadata: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const { contactId, messageText, channel, organizationId, metadata } = request.body as {
        contactId: string;
        messageText: string;
        channel?: string;
        organizationId: string;
        metadata?: Record<string, unknown>;
      };

      const agentSystem = app.agentSystem;
      if (!agentSystem?.eventLoop) {
        return reply.code(503).send({ error: "Agent system not available" });
      }

      // 1. Create message.received event
      let event: RoutedEventEnvelope = createEventEnvelope({
        organizationId,
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
        return reply.code(200).send({
          replies: [],
          escalated: true,
          reason: "no_agent_for_stage",
          agentId: null,
        });
      }

      // 4. Process through EventLoop
      try {
        const result = await agentSystem.eventLoop.process(event, { organizationId });

        // 5. Analyze processing results
        let escalated = false;
        let handedOffTo: string | null = null;

        for (const agent of result.processed) {
          // Check output event types for escalation/handoff signals
          for (const evtType of agent.outputEvents) {
            if (evtType === "conversation.escalated") {
              escalated = true;
            }
            if (evtType === "lead.qualified") {
              handedOffTo = "sales-closer";
            }
          }

          // Check actionsExecuted for messaging actions (reply was sent by ActionExecutor)
          const hasSendAction = agent.actionsExecuted.some(
            (a) => a.startsWith("messaging.") && a.endsWith(".send"),
          );

          // If agent failed or was unrouted, mark as escalation
          if (!agent.success || agent.agentId === "unrouted") {
            escalated = true;
          }

          // Replies are delivered by the ActionExecutor directly; track them here
          if (hasSendAction) {
            // ActionExecutor already sent the message — no need to collect reply text
          }
        }

        // If nothing processed, treat as unrouted
        if (result.processed.length === 0) {
          escalated = true;
        }

        return reply.code(200).send({
          replies: [],
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
