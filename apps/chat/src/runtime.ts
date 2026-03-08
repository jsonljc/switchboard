import { createHash } from "node:crypto";
import type { ChannelAdapter } from "./adapters/adapter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { guardInterpreterOutput } from "./interpreter/schema-guard.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread } from "./conversation/threads.js";
import {
  composeHelpMessage,
  composeUncertainReply,
  composeWelcomeMessage,
} from "./composer/reply.js";
import type {
  ResponseGenerator,
  ResponseContext,
  GeneratedResponse,
} from "./composer/response-generator.js";
import { ResponseHumanizer } from "./composer/humanize.js";
import { handleReadIntent } from "./clinic/read-handler.js";
import type {
  RuntimeOrchestrator,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
  CapabilityRegistry,
  PlanGraphBuilder,
  ResolvedSkin,
  ResolvedProfile,
  DataFlowExecutor,
} from "@switchboard/core";
import { inferCartridgeId, matchesAny } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";
import { safeErrorMessage } from "./utils/safe-error.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import { createBannedPhraseFilter, type BannedPhraseConfig } from "./filters/banned-phrases.js";
import type { ConversationRouter } from "@switchboard/customer-engagement";

// Extracted handlers
import type { HandlerContext } from "./handlers/handler-context.js";
import type { OperatorState } from "./handlers/handler-context.js";
import { handleProposeResult, handlePlanResult } from "./handlers/proposal-handler.js";
import { handleUndo, handleKillSwitch } from "./handlers/system-commands.js";
import { handleCallbackQuery, extractCallbackQueryId } from "./handlers/callback-handler.js";
import { handleLeadMessage } from "./handlers/lead-handler.js";
import {
  handleStatusCommand,
  handlePauseCommand,
  handleResumeCommand,
  handleAutonomyCommand,
} from "./handlers/cockpit-commands.js";

export { createChatRuntime, type ClinicConfig, type ChatBootstrapResult } from "./bootstrap.js";

export interface ChatRuntimeConfig {
  adapter: ChannelAdapter;
  interpreter: Interpreter;
  interpreterRegistry?: InterpreterRegistry;
  orchestrator: RuntimeOrchestrator;
  availableActions: string[];
  storage?: StorageContext;
  /** CartridgeReadAdapter for handling read-only intents (clinic mode). */
  readAdapter?: CartridgeReadAdapterType;
  /** Optional DLQ store for recording failed messages. */
  failedMessageStore?: FailedMessageStore;
  /** Number of recent messages to include as conversation context for interpreters (default: 5). */
  maxContextMessages?: number;
  /** Capability registry for enriching available actions with metadata. */
  capabilityRegistry?: CapabilityRegistry;
  /** Plan graph builder for converting goals to multi-step plans. */
  planGraphBuilder?: PlanGraphBuilder;
  /** Resolved skin for tool filter enforcement and config. */
  resolvedSkin?: ResolvedSkin | null;
  /** Resolved business profile for personalization (e.g. welcome message). */
  resolvedProfile?: ResolvedProfile | null;
  /** Optional CRM provider for auto-linking conversations to contacts. */
  crmProvider?: CrmProvider | null;
  /** Optional LLM-powered response generator for natural language replies. */
  responseGenerator?: ResponseGenerator | null;
  /** Optional DataFlowExecutor for multi-step plan execution. */
  dataFlowExecutor?: DataFlowExecutor | null;
  /** Whether this runtime operates as a lead-facing bot (vs. owner/operator bot). */
  isLeadBot?: boolean;
  /** ConversationRouter for lead bot message handling (required when isLeadBot = true). */
  leadRouter?: ConversationRouter | null;
}

export class ChatRuntime {
  private adapter: ChannelAdapter;
  private interpreter: Interpreter;
  private interpreterRegistry: InterpreterRegistry | null;
  private orchestrator: RuntimeOrchestrator;
  private availableActions: string[];
  private storage: StorageContext | null;
  private readAdapter: CartridgeReadAdapterType | null;
  private failedMessageStore: FailedMessageStore | null;
  private maxContextMessages: number;
  private capabilityRegistry: CapabilityRegistry | null;
  private planGraphBuilder: PlanGraphBuilder | null;
  private resolvedSkin: ResolvedSkin | null;
  private resolvedProfile: ResolvedProfile | null;
  private crmProvider: CrmProvider | null;
  private responseGenerator: ResponseGenerator | null;
  private dataFlowExecutor: DataFlowExecutor | null;
  private isLeadBot: boolean;
  private leadRouter: ConversationRouter | null;
  private filterOutgoing: (text: string) => string;
  private humanizer: ResponseHumanizer;
  // Fallback in-memory tracker when no storage is available
  private lastExecutedEnvelopeFallback = new Map<string, string>();
  // Per-principal proposal rate limiting (defense against compute DoS via denied proposals)
  private proposalCounts = new Map<string, { count: number; windowStart: number }>();
  // Mutable operator state for cockpit commands (in-memory; DB-backed in production)
  private operatorState: OperatorState = { active: true, automationLevel: "supervised" };
  private static readonly PROPOSAL_RATE_LIMIT = 30;
  private static readonly PROPOSAL_RATE_WINDOW_MS = 60_000;

  constructor(config: ChatRuntimeConfig) {
    this.adapter = config.adapter;
    this.interpreter = config.interpreter;
    this.interpreterRegistry = config.interpreterRegistry ?? null;
    this.orchestrator = config.orchestrator;
    this.availableActions = config.availableActions;
    this.storage = config.storage ?? null;
    this.readAdapter = config.readAdapter ?? null;
    this.failedMessageStore = config.failedMessageStore ?? null;
    this.maxContextMessages = config.maxContextMessages ?? 5;
    this.capabilityRegistry = config.capabilityRegistry ?? null;
    this.planGraphBuilder = config.planGraphBuilder ?? null;
    this.resolvedSkin = config.resolvedSkin ?? null;
    this.resolvedProfile = config.resolvedProfile ?? null;
    this.crmProvider = config.crmProvider ?? null;
    this.responseGenerator = config.responseGenerator ?? null;
    this.dataFlowExecutor = config.dataFlowExecutor ?? null;
    this.isLeadBot = config.isLeadBot ?? false;
    this.leadRouter = config.leadRouter ?? null;

    // Initialize banned phrase filter from skin config
    const bannedConfig = this.resolvedSkin?.config?.bannedPhrases as
      | BannedPhraseConfig
      | string[]
      | undefined;
    if (bannedConfig) {
      const normalizedConfig: BannedPhraseConfig = Array.isArray(bannedConfig)
        ? { phrases: bannedConfig }
        : bannedConfig;
      this.filterOutgoing = createBannedPhraseFilter(normalizedConfig);
    } else {
      this.filterOutgoing = (text: string) => text;
    }

    // Initialize response humanizer from skin terminology
    this.humanizer = new ResponseHumanizer(
      (this.resolvedSkin?.language as Record<string, unknown> | undefined)?.["terminology"] as
        | Record<string, string>
        | undefined,
    );
  }

  getAdapter(): ChannelAdapter {
    return this.adapter;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers (used by this class and passed to extracted handlers)
  // ---------------------------------------------------------------------------

  /** Send text reply with banned phrase filtering applied. */
  private async sendFilteredReply(threadId: string, text: string): Promise<void> {
    await this.adapter.sendTextReply(threadId, this.filterOutgoing(text));
  }

  /** Apply banned phrase filter to card text fields. */
  private filterCardText<T extends { summary: string; explanation?: string }>(card: T): T {
    return {
      ...card,
      summary: this.filterOutgoing(card.summary),
      ...(card.explanation !== undefined
        ? { explanation: this.filterOutgoing(card.explanation) }
        : {}),
    };
  }

  /**
   * Compose a user-facing response: LLM-generated when available, template fallback otherwise.
   * Applies terminology substitution and banned phrase filtering.
   */
  private async composeResponse(
    context: ResponseContext,
    orgId?: string,
  ): Promise<GeneratedResponse> {
    let result: GeneratedResponse;
    if (this.responseGenerator) {
      result = await this.responseGenerator.generate(context, orgId);
    } else {
      result = this.templateFallback(context);
    }
    // Post-process: terminology substitution, then banned phrase filter
    result.text = this.filterOutgoing(this.humanizer.applyTerminology(result.text));
    return result;
  }

  /**
   * Template-based fallback preserving exact current behavior per response type.
   */
  private templateFallback(context: ResponseContext): GeneratedResponse {
    let text: string;

    switch (context.type) {
      case "welcome":
        text = composeWelcomeMessage(
          this.resolvedSkin,
          this.resolvedProfile?.profile?.business?.name ?? undefined,
          context.availableActions,
        );
        break;

      case "uncertain":
        text = composeUncertainReply(context.availableActions);
        break;

      case "clarification":
        text = context.clarificationQuestion ?? composeUncertainReply(context.availableActions);
        break;

      case "denial": {
        const detail = context.denialDetail ?? context.explanation ?? "that action is not allowed";
        text = `I can't do that \u2014 ${lowercaseFirst(detail)}.`;
        break;
      }

      case "result_success":
        text = `All set! ${context.summary ?? "Action completed."}`;
        break;

      case "result_failure":
        text = `Something went wrong: ${lowercaseFirst(context.summary ?? "the action failed")}.`;
        break;

      case "diagnostic":
        text = context.data ?? "No diagnostic data available.";
        break;

      case "read_data":
        text = context.data ?? "No data available.";
        break;

      case "error":
        text = context.errorMessage
          ? `Error: ${context.errorMessage}`
          : "An unexpected error occurred.";
        break;

      default:
        text = "I'm not sure how to respond to that.";
    }

    return { text, usedLLM: false };
  }

  private async recordAssistantMessage(threadId: string, text: string): Promise<void> {
    const conversation = await getThread(threadId);
    if (conversation) {
      // Track first reply time for response time metrics
      if (!conversation.firstReplyAt) {
        conversation.firstReplyAt = new Date();
      }
      const updated = transitionConversation(conversation, {
        type: "add_message",
        message: { role: "assistant", text, timestamp: new Date() },
      });
      await setThread(updated);
    }
  }

  private async trackLastExecuted(threadId: string, envelopeId: string): Promise<void> {
    this.lastExecutedEnvelopeFallback.set(threadId, envelopeId);
  }

  private async getLastExecutedEnvelopeId(threadId: string): Promise<string | null> {
    // Try DB lookup: find most recent executed envelope for this thread
    if (this.storage) {
      const envelopes = await this.storage.envelopes.list({
        status: "executed",
        limit: 1,
      });
      // Filter by conversationId matching threadId
      const match = envelopes.find((e) => e.conversationId === threadId);
      if (match) return match.id;
    }
    // Fallback to in-memory
    return this.lastExecutedEnvelopeFallback.get(threadId) ?? null;
  }

  private checkProposalRateLimit(principalId: string): boolean {
    const now = Date.now();
    const entry = this.proposalCounts.get(principalId);

    if (!entry || now - entry.windowStart >= ChatRuntime.PROPOSAL_RATE_WINDOW_MS) {
      this.proposalCounts.set(principalId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= ChatRuntime.PROPOSAL_RATE_LIMIT) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  /** Build handler context from current runtime state for extracted handlers. */
  private buildHandlerContext(): HandlerContext {
    return {
      adapter: this.adapter,
      orchestrator: this.orchestrator,
      readAdapter: this.readAdapter,
      storage: this.storage,
      failedMessageStore: this.failedMessageStore,
      humanizer: this.humanizer,
      operatorState: this.operatorState,
      composeResponse: (ctx, orgId) => this.composeResponse(ctx, orgId),
      sendFilteredReply: (tid, txt) => this.sendFilteredReply(tid, txt),
      filterCardText: (card) => this.filterCardText(card),
      recordAssistantMessage: (tid, txt) => this.recordAssistantMessage(tid, txt),
      trackLastExecuted: (tid, eid) => this.trackLastExecuted(tid, eid),
      getLastExecutedEnvelopeId: (tid) => this.getLastExecutedEnvelopeId(tid),
    };
  }

  // ---------------------------------------------------------------------------
  // Main message handler
  // ---------------------------------------------------------------------------

  async handleIncomingMessage(rawPayload: unknown): Promise<void> {
    const message = this.adapter.parseIncomingMessage(rawPayload);
    if (!message) return;

    // Resolve organizationId from principal store if adapter supports it
    if (!message.organizationId && this.adapter.resolveOrganizationId) {
      message.organizationId = await this.adapter.resolveOrganizationId(message.principalId);
    }

    const threadId = message.threadId ?? message.id;
    const ctx = this.buildHandlerContext();

    // Get or create conversation
    let conversation = await getThread(threadId);
    let isNewConversation = false;
    if (!conversation) {
      conversation = createConversation(threadId, message.channel, message.principalId);
      // Auto-link to CRM contact by external ID (e.g. WhatsApp phone, Telegram user ID)
      if (this.crmProvider) {
        try {
          const existing = await this.crmProvider.findByExternalId(
            message.principalId,
            message.channel,
          );
          if (existing) {
            conversation.crmContactId = existing.id;
          } else {
            // Auto-create CRM contact for new chat users
            const phone = message.channel === "whatsapp" ? message.principalId : undefined;
            const contact = await this.crmProvider.createContact({
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
            await this.crmProvider.logActivity({
              type: "note",
              subject: "Contact auto-created from chat",
              body: `Created from ${message.channel} conversation`,
              contactIds: [contact.id],
            });
          }
        } catch {
          // Non-critical — continue without CRM link
        }
      }
      await setThread(conversation);

      // Welcome message for first-time users
      const welcomeResponse = await this.composeResponse(
        {
          type: "welcome",
          availableActions: this.availableActions,
        },
        message.organizationId ?? undefined,
      );
      await this.adapter.sendTextReply(threadId, welcomeResponse.text);
      await this.recordAssistantMessage(threadId, welcomeResponse.text);
      isNewConversation = true;
    }

    // Lead bot mode — route through ConversationRouter instead of interpreter pipeline
    if (this.isLeadBot && this.leadRouter) {
      await handleLeadMessage(ctx, this.leadRouter, message, threadId);
      return;
    }

    // Record the incoming user message for conversation memory
    conversation = transitionConversation(conversation, {
      type: "add_message",
      message: { role: "user", text: message.text, timestamp: new Date() },
    });
    await setThread(conversation);

    // Handle help command
    if (/^help$/i.test(message.text.trim())) {
      const helpText = composeHelpMessage(
        this.availableActions,
        (this.resolvedSkin?.language as Record<string, unknown> | undefined)?.["terminology"] as
          | Record<string, string>
          | undefined,
      );
      await this.sendFilteredReply(threadId, helpText);
      await this.recordAssistantMessage(threadId, helpText);
      return;
    }

    // Handle cockpit commands (agent management)
    const trimmedText = message.text.trim();

    if (/^\/?status$/i.test(trimmedText)) {
      await handleStatusCommand(ctx, threadId, message.principalId, message.organizationId);
      return;
    }

    if (/^\/?pause$/i.test(trimmedText)) {
      await handlePauseCommand(ctx, threadId, message.principalId);
      return;
    }

    if (/^\/?resume$/i.test(trimmedText)) {
      await handleResumeCommand(ctx, threadId, message.principalId);
      return;
    }

    const autonomyMatch = trimmedText.match(/^\/?autonomy(?:\s+(.+))?$/i);
    if (autonomyMatch) {
      await handleAutonomyCommand(ctx, threadId, message.principalId, autonomyMatch[1]);
      return;
    }

    // Handle callback queries (approval button taps)
    if (
      message.text.startsWith("{") &&
      message.text.includes('"action"') &&
      message.text.includes('"approvalId"')
    ) {
      // Dismiss the button loading spinner in Telegram
      const cbqId = extractCallbackQueryId(rawPayload);
      if (cbqId && this.adapter.answerCallbackQuery) {
        await this.adapter.answerCallbackQuery(cbqId);
      }
      await handleCallbackQuery(ctx, threadId, message.text, message.principalId);
      return;
    }

    // Interpret the message — use registry if available, else single interpreter
    // Include recent messages for conversation continuity
    const recentMessages = conversation.messages
      .slice(-this.maxContextMessages)
      .map((m) => ({ role: m.role, text: m.text }));
    const conversationContext: Record<string, unknown> = {
      conversation,
      recentMessages,
    };

    let rawResult;
    if (this.interpreterRegistry) {
      rawResult = await this.interpreterRegistry.interpret(
        message.text,
        conversationContext,
        this.availableActions,
        message.organizationId,
      );
    } else {
      rawResult = await this.interpreter.interpret(
        message.text,
        conversationContext,
        this.availableActions,
      );
    }

    // Schema-guard interpreter output before trusting it
    const guard = guardInterpreterOutput(rawResult);
    if (!guard.valid || !guard.data) {
      console.error("Interpreter output failed schema guard:", guard.errors);
      const uncertainResponse = await this.composeResponse(
        {
          type: "uncertain",
          userMessage: message.text,
          availableActions: this.availableActions,
        },
        message.organizationId ?? undefined,
      );
      await this.adapter.sendTextReply(threadId, uncertainResponse.text);
      await this.recordAssistantMessage(threadId, uncertainResponse.text);
      return;
    }
    const result = guard.data;

    // Handle read intents (no governance pipeline needed)
    if (result.readIntent && result.proposals.length === 0) {
      if (!this.readAdapter) {
        await this.sendFilteredReply(threadId, "Read operations are not configured.");
        return;
      }
      try {
        const readResult = await handleReadIntent(
          result.readIntent as import("./clinic/types.js").ReadIntentDescriptor,
          {
            readAdapter: this.readAdapter,
            cartridgeId: "digital-ads",
            actorId: message.principalId,
            organizationId: message.organizationId,
          },
        );
        await this.sendFilteredReply(threadId, readResult.text);
      } catch (err) {
        console.error("Read intent error:", err);
        await this.sendFilteredReply(threadId, `Error reading data: ${safeErrorMessage(err)}`);
      }
      return;
    }

    // If clarification needed
    if (result.needsClarification || result.confidence < 0.5) {
      // Welcome already handled the greeting — skip duplicate "I didn't catch that"
      if (isNewConversation && result.confidence === 0) {
        return;
      }
      const clarifyResponse = await this.composeResponse(
        {
          type: "clarification",
          clarificationQuestion: result.clarificationQuestion ?? undefined,
          userMessage: message.text,
          availableActions: this.availableActions,
        },
        message.organizationId ?? undefined,
      );
      conversation = transitionConversation(conversation, {
        type: "set_clarifying",
        question: clarifyResponse.text,
      });
      await setThread(conversation);
      await this.adapter.sendTextReply(threadId, clarifyResponse.text);
      return;
    }

    // If no proposals, uncertain
    if (result.proposals.length === 0) {
      if (isNewConversation) return;
      const noProposalResponse = await this.composeResponse(
        {
          type: "uncertain",
          userMessage: message.text,
          availableActions: this.availableActions,
        },
        message.organizationId ?? undefined,
      );
      await this.adapter.sendTextReply(threadId, noProposalResponse.text);
      return;
    }

    // If a goalBrief is present and decomposable, try to build and execute a plan
    if (result.goalBrief?.decomposable && this.planGraphBuilder && this.capabilityRegistry) {
      try {
        const capabilities = this.capabilityRegistry.enrichAvailableActions(this.availableActions);
        const plan = this.planGraphBuilder.buildPlan(result.goalBrief, capabilities, {
          principalId: message.principalId,
          organizationId: message.organizationId ?? undefined,
          cartridgeId: "digital-ads",
        });

        if (plan && plan.steps.length > 0 && this.dataFlowExecutor) {
          const planResult = await this.dataFlowExecutor.execute(plan, {
            principalId: message.principalId,
            organizationId: message.organizationId ?? undefined,
          });

          await handlePlanResult(ctx, threadId, planResult, message.principalId);
          return;
        }
        // No DataFlowExecutor — fall through to single-action proposal
      } catch (err) {
        console.warn(
          "[Runtime] Plan building/execution failed, falling through to proposal flow:",
          err,
        );
        // Fall through to single-proposal flow
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

    // Rate limit proposals per principal (defense against compute DoS)
    if (!this.checkProposalRateLimit(message.principalId)) {
      await this.sendFilteredReply(
        threadId,
        "You're sending too many requests. Please wait a moment and try again.",
      );
      return;
    }

    // Skin tool filter enforcement — reject proposals for disallowed action types
    if (this.resolvedSkin) {
      const { include, exclude } = this.resolvedSkin.toolFilter;
      for (const proposal of result.proposals) {
        const included = matchesAny(proposal.actionType, include);
        const excluded = exclude ? matchesAny(proposal.actionType, exclude) : false;
        if (!included || excluded) {
          await this.sendFilteredReply(
            threadId,
            `Action "${proposal.actionType}" is not available in the current configuration.`,
          );
          return;
        }
      }
    }

    // Set proposals on conversation
    conversation = transitionConversation(conversation, {
      type: "set_proposals",
      proposalIds: result.proposals.map((p) => p.id),
    });
    await setThread(conversation);

    // Process each proposal through the orchestrator
    for (const proposal of result.proposals) {
      // Build entity refs from the parameters (e.g. campaignRef -> campaign entity)
      const entityRefs: Array<{ inputRef: string; entityType: string }> = [];
      if (proposal.parameters["campaignRef"]) {
        entityRefs.push({
          inputRef: proposal.parameters["campaignRef"] as string,
          entityType: "campaign",
        });
      }

      // Infer cartridge from action type
      const cartridgeId =
        inferCartridgeId(proposal.actionType, this.storage?.cartridges ?? undefined) ??
        "digital-ads";

      try {
        const idempotencyKey = createHash("sha256")
          .update(message.principalId)
          .update(message.id)
          .update(proposal.actionType)
          .digest("hex");

        const proposeResult = await this.orchestrator.resolveAndPropose({
          actionType: proposal.actionType,
          parameters: proposal.parameters,
          principalId: message.principalId,
          cartridgeId,
          entityRefs,
          message: message.text,
          organizationId: message.organizationId,
          idempotencyKey,
        });

        // Handle different outcomes
        if ("needsClarification" in proposeResult) {
          conversation = transitionConversation(conversation, {
            type: "set_clarifying",
            question: proposeResult.question,
          });
          await setThread(conversation);
          await this.sendFilteredReply(threadId, proposeResult.question);
        } else if ("notFound" in proposeResult) {
          await this.sendFilteredReply(threadId, proposeResult.explanation);
        } else {
          await handleProposeResult(ctx, threadId, proposeResult, message.principalId);
        }
      } catch (err) {
        console.error("Proposal processing error:", err);
        this.failedMessageStore
          ?.record({
            channel: message.channel,
            organizationId: message.organizationId ?? undefined,
            rawPayload: rawPayload as Record<string, unknown>,
            stage: "propose",
            errorMessage: safeErrorMessage(err),
            errorStack: err instanceof Error ? err.stack : undefined,
          })
          .catch((dlqErr) => console.error("DLQ record error:", dlqErr));
        await this.sendFilteredReply(
          threadId,
          `Error processing request: ${safeErrorMessage(err)}`,
        );
      }
    }
  }
}

function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}
