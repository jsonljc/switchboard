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
import { getThread, setThread } from "../conversation/threads.js";
import { transitionConversation } from "../conversation/state.js";
import { startCadenceForContact } from "../jobs/cadence-worker.js";
import type { CadenceInstance } from "@switchboard/customer-engagement";
import { HandoffPackageAssembler } from "@switchboard/core";
import type { DialogueMiddleware } from "../middleware/dialogue-middleware.js";

export async function handleLeadMessage(
  ctx: HandlerContext,
  leadRouter: ConversationRouter,
  message: IncomingMessage,
  threadId: string,
  dialogueMiddleware?: DialogueMiddleware | null,
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

  // Pre-interpret: run emotional classification and language detection
  if (dialogueMiddleware) {
    const conversation = await getThread(threadId);
    if (conversation) {
      const beforeResult = dialogueMiddleware.beforeInterpret(message.text, conversation);
      if (beforeResult.detectedLanguage && !conversation.detectedLanguage) {
        const updated = { ...conversation, detectedLanguage: beforeResult.detectedLanguage };
        await setThread(updated);
      }
    }
  }

  let routerResponse: RouterResponse;
  try {
    routerResponse = await leadRouter.handleMessage(inbound);
  } catch (err) {
    console.error("[LeadBot] Router error:", err);
    await ctx.sendFilteredReply(threadId, "Sorry, something went wrong. Please try again.");
    return;
  }

  // Send each response message back through the adapter (with post-generation validation)
  for (const text of routerResponse.responses) {
    let finalText = text;
    if (dialogueMiddleware) {
      const result = dialogueMiddleware.afterGenerate(text, "greet", threadId);
      finalText = result.text;
    }
    await ctx.sendFilteredReply(threadId, finalText);
    await ctx.recordAssistantMessage(threadId, finalText);
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

  // Update lead profile from question answers
  if (routerResponse.leadProfileUpdate) {
    const conversation = await getThread(threadId);
    if (conversation) {
      const updated = transitionConversation(conversation, {
        type: "update_lead_profile",
        profile: routerResponse.leadProfileUpdate,
      });
      await setThread(updated);
    }
  }

  // Start cadence when qualification flow completes
  if (routerResponse.completed && routerResponse.variables) {
    const leadScore = Number(routerResponse.variables["leadScore"] ?? 0);
    const cadenceTemplateId = leadScore >= 50 ? "consultation-reminder" : "dormant-winback";

    const instance: CadenceInstance = {
      id: `cadence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cadenceDefinitionId: cadenceTemplateId,
      contactId: threadId,
      organizationId: inbound.organizationId,
      status: "active",
      currentStepIndex: 0,
      startedAt: new Date(),
      nextExecutionAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      variables: {
        contactName: routerResponse.variables["contactName"] ?? message.principalId,
        contactPhone: message.principalId,
        leadScore,
      },
      completedSteps: [],
      skippedSteps: [],
    };
    startCadenceForContact(instance);
  }

  // Escalation: build handoff package for context and notify
  if (routerResponse.escalated) {
    const conversation = await getThread(threadId);
    const assembler = new HandoffPackageAssembler();
    assembler.assemble({
      sessionId: threadId,
      organizationId: inbound.organizationId,
      reason: "human_requested",
      messages: conversation?.messages.map((m) => ({ role: m.role, text: m.text })) ?? [],
      leadSnapshot: {
        leadId: conversation?.crmContactId ?? undefined,
        channel: inbound.channelType,
        serviceInterest: conversation?.leadProfile?.serviceInterest ?? undefined,
      },
      qualificationSnapshot: {
        signalsCaptured: routerResponse.variables ?? {},
        qualificationStage: routerResponse.machineState ?? "unknown",
      },
      slaMinutes: 30,
    });

    await ctx.sendFilteredReply(
      threadId,
      "I'm connecting you with a team member who can help. They'll be with you shortly.",
    );
  }
}
