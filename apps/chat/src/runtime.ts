import type { ChannelAdapter } from "./adapters/adapter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread } from "./conversation/threads.js";
import type {
  ResponseGenerator,
  ResponseContext,
  GeneratedResponse,
} from "./composer/response-generator.js";
import { ResponseHumanizer } from "./composer/humanize.js";
import type {
  RuntimeOrchestrator,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
  CapabilityRegistry,
  PlanGraphBuilder,
  ResolvedSkin,
  ResolvedProfile,
  DataFlowExecutor,
  ConversionBus,
} from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import { createBannedPhraseFilter, type BannedPhraseConfig } from "./filters/banned-phrases.js";
import type { ConversationRouter } from "@switchboard/customer-engagement";
import { findMedicalClaims } from "@switchboard/customer-engagement";

// Extracted modules
import type { HandlerContext, OperatorState } from "./handlers/handler-context.js";
import { handleLeadMessage } from "./handlers/lead-handler.js";
import { templateFallback } from "./runtime-helpers.js";
import {
  linkCrmContact,
  handleConsentKeywords,
  handleCommands,
  interpretAndProcess,
} from "./message-pipeline.js";

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
  /** Optional ConversionBus for emitting conversion events (CRM → ads feedback loop). */
  conversionBus?: ConversionBus | null;
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
  private conversionBus: ConversionBus | null;
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
    this.conversionBus = config.conversionBus ?? null;

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
    let filtered = this.filterOutgoing(text);

    // Post-generation medical claim validation
    const violations = findMedicalClaims([filtered]);
    if (violations.length > 0) {
      console.warn(
        `[MedicalClaimFilter] Blocked outbound message with violations: ${violations.join(", ")}`,
      );
      filtered =
        "I'd be happy to help with that question. For specific details about procedures and outcomes, " +
        "I'd recommend speaking directly with our team who can provide accurate, personalized information.";
    }

    await this.adapter.sendTextReply(threadId, filtered);
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
   */
  private async composeResponse(
    context: ResponseContext,
    orgId?: string,
  ): Promise<GeneratedResponse> {
    let result: GeneratedResponse;
    if (this.responseGenerator) {
      result = await this.responseGenerator.generate(context, orgId);
    } else {
      result = templateFallback(context, this.resolvedSkin, this.resolvedProfile);
    }
    result.text = this.filterOutgoing(this.humanizer.applyTerminology(result.text));
    return result;
  }

  private async recordAssistantMessage(threadId: string, text: string): Promise<void> {
    const conversation = await getThread(threadId);
    if (conversation) {
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
    if (this.storage) {
      const envelopes = await this.storage.envelopes.list({
        status: "executed",
        limit: 1,
      });
      const match = envelopes.find((e) => e.conversationId === threadId);
      if (match) return match.id;
    }
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
      apiBaseUrl: process.env["SWITCHBOARD_API_URL"] ?? null,
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

    // Get or create conversation
    let conversation = await getThread(threadId);
    let isNewConversation = false;
    if (!conversation) {
      conversation = createConversation(
        threadId,
        message.channel,
        message.principalId,
        message.organizationId ?? null,
      );
      await linkCrmContact(this.buildPipelineDeps(), message, conversation);
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

    if (!conversation.organizationId && message.organizationId) {
      conversation.organizationId = message.organizationId;
      await setThread(conversation);
    }

    // Track last inbound message time for WhatsApp 24h conversation window enforcement
    conversation.lastInboundAt = new Date();
    await setThread(conversation);

    // Consent keyword handling (opt-out / opt-in)
    const consentHandled = await handleConsentKeywords(
      this.buildPipelineDeps(),
      message,
      threadId,
      conversation,
    );
    if (consentHandled) return;

    // Lead bot mode — route through ConversationRouter instead of interpreter pipeline
    if (this.isLeadBot && this.leadRouter) {
      const ctx = this.buildHandlerContext();
      await handleLeadMessage(ctx, this.leadRouter, message, threadId);
      return;
    }

    // Record the incoming user message for conversation memory
    conversation = transitionConversation(conversation, {
      type: "add_message",
      message: { role: "user", text: message.text, timestamp: new Date() },
    });
    await setThread(conversation);

    if (conversation.status === "human_override") {
      return;
    }

    // Handle commands (help, cockpit, callbacks)
    const commandHandled = await handleCommands(
      this.buildPipelineDeps(),
      message,
      threadId,
      rawPayload,
    );
    if (commandHandled) return;

    // Interpret and process proposals
    await interpretAndProcess(
      this.buildPipelineDeps(),
      message,
      threadId,
      conversation,
      isNewConversation,
      rawPayload,
    );
  }

  /** Build pipeline dependencies object for extracted pipeline functions. */
  private buildPipelineDeps() {
    return {
      adapter: this.adapter,
      interpreter: this.interpreter,
      interpreterRegistry: this.interpreterRegistry,
      orchestrator: this.orchestrator,
      availableActions: this.availableActions,
      storage: this.storage,
      readAdapter: this.readAdapter,
      failedMessageStore: this.failedMessageStore,
      maxContextMessages: this.maxContextMessages,
      capabilityRegistry: this.capabilityRegistry,
      planGraphBuilder: this.planGraphBuilder,
      resolvedSkin: this.resolvedSkin,
      crmProvider: this.crmProvider,
      dataFlowExecutor: this.dataFlowExecutor,
      isLeadBot: this.isLeadBot,
      leadRouter: this.leadRouter,
      conversionBus: this.conversionBus,
      composeResponse: (ctx: ResponseContext, orgId?: string) => this.composeResponse(ctx, orgId),
      sendFilteredReply: (tid: string, txt: string) => this.sendFilteredReply(tid, txt),
      recordAssistantMessage: (tid: string, txt: string) => this.recordAssistantMessage(tid, txt),
      checkProposalRateLimit: (pid: string) => this.checkProposalRateLimit(pid),
      buildHandlerContext: () => this.buildHandlerContext(),
    };
  }
}
