import crypto, { createHash } from "node:crypto";
import type { ChannelAdapter } from "./adapters/adapter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { guardInterpreterOutput } from "./interpreter/schema-guard.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { setThread } from "./conversation/threads.js";
import { composeHelpMessage } from "./composer/reply.js";
import type { ResponseContext, GeneratedResponse } from "./composer/response-generator.js";
import type {
  RuntimeOrchestrator,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
  CapabilityRegistry,
  PlanGraphBuilder,
  DataFlowExecutor,
} from "@switchboard/core";
import { inferCartridgeId } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";
import { safeErrorMessage } from "./utils/safe-error.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import type { ConversionBus } from "@switchboard/core";
import type { DialogueMiddleware } from "./middleware/dialogue-middleware.js";

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
import {
  handleSoldCommand,
  handleSoldConfirmation,
  checkPendingSale,
} from "./handlers/sold-command.js";
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
  crmProvider: CrmProvider | null;
  dataFlowExecutor: DataFlowExecutor | null;
  isLeadBot: boolean;
  conversionBus: ConversionBus | null;
  dialogueMiddleware: DialogueMiddleware | null;

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
          eventId: crypto.randomUUID(),
          type: "inquiry",
          contactId: contact.id,
          organizationId: message.organizationId,
          value: 1,
          sourceAdId: message.metadata?.["sourceAdId"] as string | undefined,
          sourceCampaignId: message.metadata?.["sourceCampaignId"] as string | undefined,
          occurredAt: new Date(),
          source: "chat_auto_create",
          metadata: { channel: message.channel },
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
  const conversationContext = buildConversationContext(conversation, deps.maxContextMessages);

  const rawResult = await interpretMessage(deps, message, conversationContext);

  // Schema-guard interpreter output before trusting it
  const guard = guardInterpreterOutput(rawResult);
  if (!guard.valid || !guard.data) {
    await handleInvalidInterpretation(deps, message, threadId, guard.errors);
    return;
  }
  const result = guard.data;

  // Handle read intents (no governance pipeline needed)
  if (await tryHandleReadIntent(deps, result, message, threadId)) return;

  // If clarification needed
  if (
    await tryHandleClarification(deps, result, message, threadId, conversation, isNewConversation)
  )
    return;

  // If no proposals, uncertain
  if (await tryHandleNoProposals(deps, result, message, threadId, isNewConversation)) return;

  // If a goalBrief is present and decomposable, try to build and execute a plan
  if (await tryExecutePlan(deps, result, message, ctx, threadId)) return;

  // Handle undo command
  if (await tryHandleUndo(ctx, result, message, threadId)) return;

  // Handle kill switch (emergency pause all)
  if (await tryHandleKillSwitch(ctx, result, message, threadId)) return;

  // Rate limit proposals per principal
  if (!deps.checkProposalRateLimit(message.principalId)) {
    await deps.sendFilteredReply(
      threadId,
      "You're sending too many requests. Please wait a moment and try again.",
    );
    return;
  }

  // Skin tool filter enforcement
  if (await tryEnforceSkinFilter(deps, result, threadId)) return;

  // Set proposals on conversation
  const withProposals = transitionConversation(conversation, {
    type: "set_proposals",
    proposalIds: result.proposals.map((p) => p.id),
  });
  await setThread(withProposals);

  // Process each proposal through the orchestrator
  await processProposals(deps, result, message, threadId, withProposals, ctx, rawPayload);
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
  // Check for pending sale confirmation (only intercept Y/yes/N/no)
  const pending = checkPendingSale(threadId);
  if (pending && /^(y(es)?|no?)$/i.test(message.text.trim())) {
    const ctx = deps.buildHandlerContext();
    const handled = await handleSoldConfirmation(
      ctx,
      threadId,
      message.principalId,
      message.organizationId,
      message.text,
    );
    if (handled) return true;
  }

  // Handle /sold command
  const soldMatch = message.text.trim().match(/^\/?sold\s+(.+)$/i);
  if (soldMatch) {
    const ctx = deps.buildHandlerContext();
    await handleSoldCommand(
      ctx,
      threadId,
      message.principalId,
      message.organizationId,
      soldMatch[1]!,
    );
    return true;
  }

  const ctx = deps.buildHandlerContext();

  // Handle help command
  if (/^help$/i.test(message.text.trim())) {
    const helpText = composeHelpMessage(deps.availableActions);
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

// ---------------------------------------------------------------------------
// Helper functions to reduce interpretAndProcess complexity
// ---------------------------------------------------------------------------

function buildConversationContext(
  conversation: ReturnType<typeof createConversation>,
  maxContextMessages: number,
): Record<string, unknown> {
  const recentMessages = conversation.messages
    .slice(-maxContextMessages)
    .map((m) => ({ role: m.role, text: m.text }));
  return {
    conversation,
    recentMessages,
  };
}

async function interpretMessage(
  deps: PipelineDeps,
  message: ParsedMessage,
  conversationContext: Record<string, unknown>,
): Promise<unknown> {
  if (deps.interpreterRegistry) {
    return await deps.interpreterRegistry.interpret(
      message.text,
      conversationContext,
      deps.availableActions,
      message.organizationId,
    );
  }
  return await deps.interpreter.interpret(message.text, conversationContext, deps.availableActions);
}

async function handleInvalidInterpretation(
  deps: PipelineDeps,
  message: ParsedMessage,
  threadId: string,
  errors: unknown,
): Promise<void> {
  console.error("Interpreter output failed schema guard:", errors);
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
}

async function tryHandleReadIntent(
  deps: PipelineDeps,
  result: { readIntent?: unknown; proposals: unknown[] },
  _message: ParsedMessage,
  threadId: string,
): Promise<boolean> {
  if (result.readIntent && result.proposals.length === 0) {
    // Read operations are not currently supported.
    await deps.sendFilteredReply(threadId, "Read operations are not currently available.");
    return true;
  }
  return false;
}

async function tryHandleClarification(
  deps: PipelineDeps,
  result: {
    needsClarification?: boolean;
    confidence: number;
    clarificationQuestion?: string | null;
  },
  message: ParsedMessage,
  threadId: string,
  conversation: ReturnType<typeof createConversation>,
  isNewConversation: boolean,
): Promise<boolean> {
  if (result.needsClarification || result.confidence < 0.5) {
    if (isNewConversation && result.confidence === 0) {
      return true;
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
    return true;
  }
  return false;
}

async function tryHandleNoProposals(
  deps: PipelineDeps,
  result: { proposals: unknown[] },
  message: ParsedMessage,
  threadId: string,
  isNewConversation: boolean,
): Promise<boolean> {
  if (result.proposals.length === 0) {
    if (isNewConversation) return true;
    const noProposalResponse = await deps.composeResponse(
      {
        type: "uncertain",
        userMessage: message.text,
        availableActions: deps.availableActions,
      },
      message.organizationId ?? undefined,
    );
    await deps.adapter.sendTextReply(threadId, noProposalResponse.text);
    return true;
  }
  return false;
}

async function tryExecutePlan(
  deps: PipelineDeps,
  result: { goalBrief?: import("@switchboard/schemas").GoalBrief | null },
  message: ParsedMessage,
  ctx: HandlerContext,
  threadId: string,
): Promise<boolean> {
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
        return true;
      }
    } catch (err) {
      console.warn(
        "[Runtime] Plan building/execution failed, falling through to proposal flow:",
        err,
      );
    }
  }
  return false;
}

async function tryHandleUndo(
  ctx: HandlerContext,
  result: { proposals: Array<{ actionType: string }> },
  message: ParsedMessage,
  threadId: string,
): Promise<boolean> {
  if (result.proposals[0]?.actionType === "system.undo") {
    await handleUndo(ctx, threadId, message.principalId);
    return true;
  }
  return false;
}

async function tryHandleKillSwitch(
  ctx: HandlerContext,
  result: { proposals: Array<{ actionType: string }> },
  message: ParsedMessage,
  threadId: string,
): Promise<boolean> {
  if (result.proposals[0]?.actionType === "system.kill_switch") {
    await handleKillSwitch(ctx, threadId, message.principalId, message.organizationId);
    return true;
  }
  return false;
}

async function tryEnforceSkinFilter(
  _deps: PipelineDeps,
  _result: { proposals: Array<{ actionType: string }> },
  _threadId: string,
): Promise<boolean> {
  // Skin-based tool filtering was removed with the skin/profile system cleanup.
  return false;
}

async function processProposals(
  deps: PipelineDeps,
  result: {
    proposals: Array<{ id: string; actionType: string; parameters: Record<string, unknown> }>;
  },
  message: ParsedMessage,
  threadId: string,
  withProposals: ReturnType<typeof transitionConversation>,
  ctx: HandlerContext,
  rawPayload: unknown,
): Promise<void> {
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
