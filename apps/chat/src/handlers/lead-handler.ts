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
import { LeadConversationState, getPrimaryMoveForState } from "@switchboard/customer-engagement";
import { handleProposeResult } from "./proposal-handler.js";
import { getThread, setThread } from "../conversation/threads.js";
import { transitionConversation } from "../conversation/state.js";
import { startCadenceForContact } from "../jobs/cadence-worker.js";
import type { CadenceInstance } from "@switchboard/customer-engagement";
import {
  HandoffPackageAssembler,
  HandoffNotifier,
  type HandoffStore,
  OutcomePipeline,
} from "@switchboard/core";
import type { DialogueMiddleware } from "../middleware/dialogue-middleware.js";
import type { PrimaryMove } from "@switchboard/core";

export interface LeadHandlerDeps {
  handoffStore?: HandoffStore | null;
  handoffNotifier?: HandoffNotifier | null;
  outcomePipeline?: OutcomePipeline | null;
}

export async function handleLeadMessage(
  ctx: HandlerContext,
  leadRouter: ConversationRouter,
  message: IncomingMessage,
  threadId: string,
  dialogueMiddleware?: DialogueMiddleware | null,
  deps?: LeadHandlerDeps,
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

  // Derive the actual primary move from the state machine state
  const primaryMove: PrimaryMove = routerResponse.machineState
    ? getPrimaryMoveForState(routerResponse.machineState as LeadConversationState)
    : "greet";

  // Send each response message back through the adapter (with post-generation validation)
  for (const text of routerResponse.responses) {
    let finalText = text;
    if (dialogueMiddleware) {
      const result = dialogueMiddleware.afterGenerate(text, primaryMove, threadId);
      finalText = result.text;
    }
    await ctx.sendFilteredReply(threadId, finalText);
    await ctx.recordAssistantMessage(threadId, finalText);

    // Log response variant for A/B testing signal (C2)
    if (deps?.outcomePipeline) {
      try {
        await deps.outcomePipeline.logResponseVariant({
          sessionId: threadId,
          organizationId: inbound.organizationId,
          primaryMove,
          responseText: finalText,
          conversationState: routerResponse.machineState ?? undefined,
        });
      } catch {
        // Non-critical — don't block the response
      }
    }
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

    // Emit "booked" outcome for completed qualification with high score (C2)
    if (deps?.outcomePipeline && leadScore >= 50) {
      try {
        await deps.outcomePipeline.emitOutcome({
          sessionId: threadId,
          organizationId: inbound.organizationId,
          outcomeType: "booked",
          metadata: { leadScore },
        });
      } catch {
        // Non-critical
      }
    }
  }

  // Escalation: build handoff package, persist it, and notify (C3)
  if (routerResponse.escalated) {
    const conversation = await getThread(threadId);
    const assembler = new HandoffPackageAssembler();
    const handoffPackage = assembler.assemble({
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

    // Persist handoff to database (C3)
    if (deps?.handoffStore) {
      try {
        await deps.handoffStore.save(handoffPackage);
      } catch (err) {
        console.error("[LeadBot] Failed to persist handoff:", err);
      }
    }

    // Notify escalation contacts (C3)
    if (deps?.handoffNotifier) {
      try {
        await deps.handoffNotifier.notify(handoffPackage);
      } catch (err) {
        console.error("[LeadBot] Failed to send handoff notification:", err);
      }
    }

    // Emit escalation outcome (C2)
    if (deps?.outcomePipeline) {
      try {
        await deps.outcomePipeline.emitOutcome({
          sessionId: threadId,
          organizationId: inbound.organizationId,
          outcomeType: "escalated_unresolved",
          metadata: { reason: "human_requested", machineState: routerResponse.machineState },
        });
      } catch {
        // Non-critical
      }
    }

    await ctx.sendFilteredReply(
      threadId,
      "Let me get one of our team to help you directly. They'll be with you shortly!",
    );
  }
}
