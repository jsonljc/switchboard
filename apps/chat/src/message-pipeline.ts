import { createHash } from "node:crypto";
import type { ChannelAdapter } from "./adapters/adapter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { guardInterpreterOutput } from "./interpreter/schema-guard.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { setThread } from "./conversation/threads.js";
import { composeHelpMessage } from "./composer/reply.js";
import type { ResponseContext, GeneratedResponse } from "./composer/response-generator.js";
import { handleReadIntent } from "./clinic/read-handler.js";
import type {
  RuntimeOrchestrator,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
  CapabilityRegistry,
  PlanGraphBuilder,
  ResolvedSkin,
  DataFlowExecutor,
} from "@switchboard/core";
import { inferCartridgeId, matchesAny } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";
import { safeErrorMessage } from "./utils/safe-error.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import type { ConversationRouter } from "@switchboard/customer-engagement";
import type { ConversionBus } from "@switchboard/core";

// Extracted handlers
import type { HandlerContext } from "./handlers/handler-context.js";
import { handleProposeResult, handlePlanResult } from "./handlers/proposal-handler.js";
import { handleUndo, handleKillSwitch } from "./handlers/system-commands.js";
import { handleCallbackQuery, extractCallbackQueryId } from "./handlers/callback-handler.js";
import {
  handleStatusCommand,
  handlePauseCommand,
  handleResumeCommand,
  handleAutonomyCommand,
  handleAutonomyStatusCommand,
} from "./handlers/cockpit-commands.js";
import { isOptOutKeyword, isOptInKeyword } from "./runtime-helpers.js";

/** Parsed incoming message structure expected from ChannelAdapter. */
export interface ParsedMessage {
  id: string;
  text: string;
  threadId: string | null;
  channel: string;
  principalId: string;
  organizationId: string | null;
  metadata?: Record<string, unknown>;
}

/** Dependencies injected into the message pipeline by ChatRuntime. */
export interface PipelineDeps {
  adapter: ChannelAdapter;
  interpreter: Interpreter;
  interpreterRegistry: InterpreterRegistry | null;
  orchestrator: RuntimeOrchestrator;
  availableActions: string[];
  storage: StorageContext | null;
  readAdapter: CartridgeReadAdapterType | null;
  failedMessageStore: FailedMessageStore | null;
  maxContextMessages: number;
  capabilityRegistry: CapabilityRegistry | null;
  planGraphBuilder: PlanGraphBuilder | null;
  resolvedSkin: ResolvedSkin | null;
  crmProvider: CrmProvider | null;
  dataFlowExecutor: DataFlowExecutor | null;
  isLeadBot: boolean;
  leadRouter: ConversationRouter | null;
  conversionBus: ConversionBus | null;

  // Callbacks into ChatRuntime
  composeResponse(context: ResponseContext, orgId?: string): Promise<GeneratedResponse>;
  sendFilteredReply(threadId: string, text: string): Promise<void>;
  recordAssistantMessage(threadId: string, text: string): Promise<void>;
  checkProposalRateLimit(principalId: string): boolean;
  buildHandlerContext(): HandlerContext;
}

/**
 * Auto-link a new conversation to a CRM contact, creating one if needed.
 */
export async function linkCrmContact(
  deps: PipelineDeps,
  message: ParsedMessage,
  conversation: ReturnType<typeof createConversation>,
): Promise<void> {
  if (!deps.crmProvider) return;

  try {
    const existing = await deps.crmProvider.findByExternalId(message.principalId, message.channel);
    if (existing) {
      conversation.crmContactId = existing.id;
    } else {
      // Auto-create CRM contact for new chat users
      const phone = message.channel === "whatsapp" ? message.principalId : undefined;
      const contact = await deps.crmProvider.createContact({
        externalId: message.principalId,
        channel: message.channel,
        firstName: message.metadata?.["firstName"] as string | undefined,
        lastName: message.metadata?.["lastName"] as string | undefined,
        phone,
        sourceAdId: message.metadata?.["sourceAdId"] as string | undefined,
        sourceCampaignId: message.metadata?.["sourceCampaignId"] as string | undefined,
        utmSource: message.metadata?.["utmSource"] as string | undefined,
        properties: {
          source: "chat",
          ...(message.metadata?.["username"]
            ? { telegramUsername: message.metadata["username"] }
            : {}),
          ...(message.metadata?.["contactName"]
            ? { displayName: message.metadata["contactName"] }
            : {}),
        },
      });
      conversation.crmContactId = contact.id;

      // Log activity so there's a record of how the contact was created
      await deps.crmProvider.logActivity({
        type: "note",
        subject: "Contact auto-created from chat",
        body: `Created from ${message.channel} conversation`,
        contactIds: [contact.id],
      });

      // Emit inquiry conversion event for ad attribution feedback
      if (deps.conversionBus && message.organizationId) {
        deps.conversionBus.emit({
          type: "inquiry",
          contactId: contact.id,
          organizationId: message.organizationId,
          value: 1,
          sourceAdId: message.metadata?.["sourceAdId"] as string | undefined,
          sourceCampaignId: message.metadata?.["sourceCampaignId"] as string | undefined,
          timestamp: new Date(),
          metadata: { channel: message.channel, source: "chat_auto_create" },
        });
      }
    }
  } catch {
    // Non-critical — continue without CRM link
  }
}

/**
 * Handle consent opt-out/opt-in keywords. Returns true if the keyword was handled
 * (caller should return early).
 */
export async function handleConsentKeywords(
  deps: PipelineDeps,
  message: ParsedMessage,
  threadId: string,
  conversation: ReturnType<typeof createConversation>,
): Promise<boolean> {
  // Opt-out keyword detection
  if (isOptOutKeyword(message.text)) {
    if (deps.crmProvider && conversation.crmContactId) {
      try {
        await deps.crmProvider.updateContact(conversation.crmContactId, {
          consentStatus: "revoked",
          consentRevokedAt: new Date().toISOString(),
        });
      } catch {
        // Non-critical
      }
    }
    await deps.adapter.sendTextReply(
      threadId,
      "You've been unsubscribed and will no longer receive messages from us. " +
        "Reply START to re-subscribe at any time.",
    );
    const completed = transitionConversation(conversation, { type: "complete" });
    await setThread(completed);
    return true;
  }

  // Re-subscribe keyword detection
  if (isOptInKeyword(message.text)) {
    if (deps.crmProvider && conversation.crmContactId) {
      try {
        await deps.crmProvider.updateContact(conversation.crmContactId, {
          consentStatus: "active",
          consentGrantedAt: new Date().toISOString(),
        });
      } catch {
        // Non-critical
      }
    }
    await deps.adapter.sendTextReply(
      threadId,
      "Welcome back! You've been re-subscribed. How can I help you today?",
    );
    if (conversation.status === "completed") {
      const resumed = transitionConversation(conversation, { type: "resume" });
      await setThread(resumed);
    }
    return true;
  }

  return false;
}

/**
 * Interpret the user message and process the resulting proposals through the orchestrator.
 */
export async function interpretAndProcess(
  deps: PipelineDeps,
  message: ParsedMessage,
  threadId: string,
  conversation: ReturnType<typeof createConversation>,
  isNewConversation: boolean,
  rawPayload: unknown,
): Promise<void> {
  const ctx = deps.buildHandlerContext();

  // Include recent messages for conversation continuity
  const recentMessages = conversation.messages
    .slice(-deps.maxContextMessages)
    .map((m) => ({ role: m.role, text: m.text }));
  const conversationContext: Record<string, unknown> = {
    conversation,
    recentMessages,
  };

  let rawResult;
  if (deps.interpreterRegistry) {
    rawResult = await deps.interpreterRegistry.interpret(
      message.text,
      conversationContext,
      deps.availableActions,
      message.organizationId,
    );
  } else {
    rawResult = await deps.interpreter.interpret(
      message.text,
      conversationContext,
      deps.availableActions,
    );
  }

  // Schema-guard interpreter output before trusting it
  const guard = guardInterpreterOutput(rawResult);
  if (!guard.valid || !guard.data) {
    console.error("Interpreter output failed schema guard:", guard.errors);
    const uncertainResponse = await deps.composeResponse(
      {
        type: "uncertain",
        userMessage: message.text,
        availableActions: deps.availableActions,
      },
      message.organizationId ?? undefined,
    );
    await deps.adapter.sendTextReply(threadId, uncertainResponse.text);
    await deps.recordAssistantMessage(threadId, uncertainResponse.text);
    return;
  }
  const result = guard.data;

  // Handle read intents (no governance pipeline needed)
  if (result.readIntent && result.proposals.length === 0) {
    if (!deps.readAdapter) {
      await deps.sendFilteredReply(threadId, "Read operations are not configured.");
      return;
    }
    try {
      const readResult = await handleReadIntent(
        result.readIntent as import("./clinic/types.js").ReadIntentDescriptor,
        {
          readAdapter: deps.readAdapter,
          cartridgeId: "digital-ads",
          actorId: message.principalId,
          organizationId: message.organizationId,
        },
      );
      await deps.sendFilteredReply(threadId, readResult.text);
    } catch (err) {
      console.error("Read intent error:", err);
      await deps.sendFilteredReply(threadId, `Error reading data: ${safeErrorMessage(err)}`);
    }
    return;
  }

  // If clarification needed
  if (result.needsClarification || result.confidence < 0.5) {
    if (isNewConversation && result.confidence === 0) {
      return;
    }
    const clarifyResponse = await deps.composeResponse(
      {
        type: "clarification",
        clarificationQuestion: result.clarificationQuestion ?? undefined,
        userMessage: message.text,
        availableActions: deps.availableActions,
      },
      message.organizationId ?? undefined,
    );
    const updated = transitionConversation(conversation, {
      type: "set_clarifying",
      question: clarifyResponse.text,
    });
    await setThread(updated);
    await deps.adapter.sendTextReply(threadId, clarifyResponse.text);
    return;
  }

  // If no proposals, uncertain
  if (result.proposals.length === 0) {
    if (isNewConversation) return;
    const noProposalResponse = await deps.composeResponse(
      {
        type: "uncertain",
        userMessage: message.text,
        availableActions: deps.availableActions,
      },
      message.organizationId ?? undefined,
    );
    await deps.adapter.sendTextReply(threadId, noProposalResponse.text);
    return;
  }

  // If a goalBrief is present and decomposable, try to build and execute a plan
  if (result.goalBrief?.decomposable && deps.planGraphBuilder && deps.capabilityRegistry) {
    try {
      const capabilities = deps.capabilityRegistry.enrichAvailableActions(deps.availableActions);
      const plan = deps.planGraphBuilder.buildPlan(result.goalBrief, capabilities, {
        principalId: message.principalId,
        organizationId: message.organizationId ?? undefined,
        cartridgeId: "digital-ads",
      });

      if (plan && plan.steps.length > 0 && deps.dataFlowExecutor) {
        const planResult = await deps.dataFlowExecutor.execute(plan, {
          principalId: message.principalId,
          organizationId: message.organizationId ?? undefined,
        });

        await handlePlanResult(ctx, threadId, planResult, message.principalId);
        return;
      }
    } catch (err) {
      console.warn(
        "[Runtime] Plan building/execution failed, falling through to proposal flow:",
        err,
      );
    }
  }

  // Handle undo command
  if (result.proposals[0]?.actionType === "system.undo") {
    await handleUndo(ctx, threadId, message.principalId);
    return;
  }

  // Handle kill switch (emergency pause all)
  if (result.proposals[0]?.actionType === "system.kill_switch") {
    await handleKillSwitch(ctx, threadId, message.principalId, message.organizationId);
    return;
  }

  // Rate limit proposals per principal
  if (!deps.checkProposalRateLimit(message.principalId)) {
    await deps.sendFilteredReply(
      threadId,
      "You're sending too many requests. Please wait a moment and try again.",
    );
    return;
  }

  // Skin tool filter enforcement
  if (deps.resolvedSkin) {
    const { include, exclude } = deps.resolvedSkin.toolFilter;
    for (const proposal of result.proposals) {
      const included = matchesAny(proposal.actionType, include);
      const excluded = exclude ? matchesAny(proposal.actionType, exclude) : false;
      if (!included || excluded) {
        await deps.sendFilteredReply(
          threadId,
          `Action "${proposal.actionType}" is not available in the current configuration.`,
        );
        return;
      }
    }
  }

  // Set proposals on conversation
  const withProposals = transitionConversation(conversation, {
    type: "set_proposals",
    proposalIds: result.proposals.map((p) => p.id),
  });
  await setThread(withProposals);

  // Process each proposal through the orchestrator
  for (const proposal of result.proposals) {
    const entityRefs: Array<{ inputRef: string; entityType: string }> = [];
    if (proposal.parameters["campaignRef"]) {
      entityRefs.push({
        inputRef: proposal.parameters["campaignRef"] as string,
        entityType: "campaign",
      });
    }

    const cartridgeId =
      inferCartridgeId(proposal.actionType, deps.storage?.cartridges ?? undefined) ?? "digital-ads";

    try {
      const idempotencyKey = createHash("sha256")
        .update(message.principalId)
        .update(message.id)
        .update(proposal.actionType)
        .digest("hex");

      const proposeResult = await deps.orchestrator.resolveAndPropose({
        actionType: proposal.actionType,
        parameters: proposal.parameters,
        principalId: message.principalId,
        cartridgeId,
        entityRefs,
        message: message.text,
        organizationId: message.organizationId,
        idempotencyKey,
      });

      if ("needsClarification" in proposeResult) {
        const clarified = transitionConversation(withProposals, {
          type: "set_clarifying",
          question: proposeResult.question,
        });
        await setThread(clarified);
        await deps.sendFilteredReply(threadId, proposeResult.question);
      } else if ("notFound" in proposeResult) {
        await deps.sendFilteredReply(threadId, proposeResult.explanation);
      } else {
        await handleProposeResult(ctx, threadId, proposeResult, message.principalId);
      }
    } catch (err) {
      console.error("Proposal processing error:", err);
      deps.failedMessageStore
        ?.record({
          channel: message.channel,
          organizationId: message.organizationId ?? undefined,
          rawPayload: rawPayload as Record<string, unknown>,
          stage: "propose",
          errorMessage: safeErrorMessage(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        .catch((dlqErr) => console.error("DLQ record error:", dlqErr));
      await deps.sendFilteredReply(threadId, `Error processing request: ${safeErrorMessage(err)}`);
    }
  }
}

/**
 * Handle commands that short-circuit message processing (help, cockpit, callbacks).
 * Returns true if the command was handled (caller should return early).
 */
export async function handleCommands(
  deps: PipelineDeps,
  message: ParsedMessage,
  threadId: string,
  rawPayload: unknown,
): Promise<boolean> {
  const ctx = deps.buildHandlerContext();

  // Handle help command
  if (/^help$/i.test(message.text.trim())) {
    const helpText = composeHelpMessage(
      deps.availableActions,
      (deps.resolvedSkin?.language as Record<string, unknown> | undefined)?.["terminology"] as
        | Record<string, string>
        | undefined,
    );
    await deps.sendFilteredReply(threadId, helpText);
    await deps.recordAssistantMessage(threadId, helpText);
    return true;
  }

  // Handle cockpit commands (agent management)
  const trimmedText = message.text.trim();

  if (/^\/?status$/i.test(trimmedText)) {
    await handleStatusCommand(ctx, threadId, message.principalId, message.organizationId);
    return true;
  }

  if (/^\/?pause$/i.test(trimmedText)) {
    await handlePauseCommand(ctx, threadId, message.principalId, message.organizationId);
    return true;
  }

  if (/^\/?resume$/i.test(trimmedText)) {
    await handleResumeCommand(ctx, threadId, message.principalId, message.organizationId);
    return true;
  }

  if (/^\/?autonomy[-_]?status$/i.test(trimmedText)) {
    await handleAutonomyStatusCommand(ctx, threadId, message.principalId, message.organizationId);
    return true;
  }

  const autonomyMatch = trimmedText.match(/^\/?autonomy(?:\s+(.+))?$/i);
  if (autonomyMatch) {
    await handleAutonomyCommand(
      ctx,
      threadId,
      message.principalId,
      message.organizationId,
      autonomyMatch[1],
    );
    return true;
  }

  // Handle callback queries (approval button taps)
  if (
    message.text.startsWith("{") &&
    message.text.includes('"action"') &&
    message.text.includes('"approvalId"')
  ) {
    const cbqId = extractCallbackQueryId(rawPayload);
    if (cbqId && deps.adapter.answerCallbackQuery) {
      await deps.adapter.answerCallbackQuery(cbqId);
    }
    await handleCallbackQuery(ctx, threadId, message.text, message.principalId);
    return true;
  }

  return false;
}
