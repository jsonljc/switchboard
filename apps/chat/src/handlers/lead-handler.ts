// ---------------------------------------------------------------------------
// Lead Bot Handler — routes messages through ConversationRouter
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";
import type { IncomingMessage } from "@switchboard/schemas";
import type {
  ConversationRouter,
  InboundMessage,
  RouterResponse,
} from "@switchboard/customer-engagement";
import { handleProposeResult } from "./proposal-handler.js";

export async function handleLeadMessage(
  ctx: HandlerContext,
  leadRouter: ConversationRouter,
  message: IncomingMessage,
  threadId: string,
): Promise<void> {
  const inbound: InboundMessage = {
    channelId: threadId,
    channelType: (message.channel === "telegram"
      ? "telegram"
      : message.channel) as InboundMessage["channelType"],
    body: message.text,
    from: message.principalId,
    timestamp: message.timestamp,
    organizationId: message.organizationId ?? "default",
    metadata: message.metadata,
  };

  let routerResponse: RouterResponse;
  try {
    routerResponse = await leadRouter.handleMessage(inbound);
  } catch (err) {
    console.error("[LeadBot] Router error:", err);
    await ctx.sendFilteredReply(threadId, "Sorry, something went wrong. Please try again.");
    return;
  }

  // Send each response message back through the adapter
  for (const text of routerResponse.responses) {
    await ctx.sendFilteredReply(threadId, text);
    await ctx.recordAssistantMessage(threadId, text);
  }

  // If the router produced an action, propose it through governance
  if (routerResponse.actionRequired) {
    try {
      const proposeResult = await ctx.orchestrator.resolveAndPropose({
        actionType: routerResponse.actionRequired.actionType,
        parameters: routerResponse.actionRequired.parameters,
        principalId: message.principalId,
        cartridgeId: "customer-engagement",
        entityRefs: [],
        message: message.text,
        organizationId: message.organizationId,
      });

      if (!("needsClarification" in proposeResult) && !("notFound" in proposeResult)) {
        await handleProposeResult(ctx, threadId, proposeResult, message.principalId);
      }
    } catch (err) {
      console.error("[LeadBot] Action proposal error:", err);
    }
  }

  // Escalation notification
  if (routerResponse.escalated) {
    await ctx.sendFilteredReply(
      threadId,
      "I'm connecting you with a team member who can help. They'll be with you shortly.",
    );
  }
}
