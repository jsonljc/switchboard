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
import { buildApprovalCard } from "./composer/approval-card.js";
import { buildResultCard } from "./composer/result-card.js";
import { ResponseHumanizer } from "./composer/humanize.js";
import { handleReadIntent } from "./clinic/read-handler.js";
import { formatDiagnosticResult, isDiagnosticAction } from "./formatters/diagnostic-formatter.js";
import type {
  RuntimeOrchestrator,
  ProposeResult,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
  CapabilityRegistry,
  PlanGraphBuilder,
  ResolvedSkin,
  ResolvedProfile,
} from "@switchboard/core";
import { inferCartridgeId, matchesAny } from "@switchboard/core";
import type { UndoRecipe, CrmProvider } from "@switchboard/schemas";
import { safeErrorMessage } from "./utils/safe-error.js";
import type { FailedMessageStore } from "./dlq/failed-message-store.js";
import { createBannedPhraseFilter, type BannedPhraseConfig } from "./filters/banned-phrases.js";

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
  private filterOutgoing: (text: string) => string;
  private humanizer: ResponseHumanizer;
  // Fallback in-memory tracker when no storage is available
  private lastExecutedEnvelopeFallback = new Map<string, string>();
  // Per-principal proposal rate limiting (defense against compute DoS via denied proposals)
  private proposalCounts = new Map<string, { count: number; windowStart: number }>();
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
      const businessName =
        this.resolvedProfile?.profile?.business?.name ??
        this.resolvedSkin?.manifest?.name ??
        undefined;
      const welcomeText = composeWelcomeMessage(
        this.resolvedSkin,
        businessName,
        this.availableActions,
      );
      await this.sendFilteredReply(threadId, welcomeText);
      await this.recordAssistantMessage(threadId, welcomeText);
      isNewConversation = true;
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

    // Handle callback queries (approval button taps)
    if (
      message.text.startsWith("{") &&
      message.text.includes('"action"') &&
      message.text.includes('"approvalId"')
    ) {
      // Dismiss the button loading spinner in Telegram
      const cbqId = this.extractCallbackQueryId(rawPayload);
      if (cbqId && this.adapter.answerCallbackQuery) {
        await this.adapter.answerCallbackQuery(cbqId);
      }
      await this.handleCallbackQuery(threadId, message.text, message.principalId);
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
      const uncertainReply = composeUncertainReply(this.availableActions);
      await this.sendFilteredReply(threadId, uncertainReply);
      await this.recordAssistantMessage(threadId, uncertainReply);
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
      const question = result.clarificationQuestion ?? composeUncertainReply(this.availableActions);
      conversation = transitionConversation(conversation, {
        type: "set_clarifying",
        question,
      });
      await setThread(conversation);
      await this.sendFilteredReply(threadId, question);
      return;
    }

    // If no proposals, uncertain
    if (result.proposals.length === 0) {
      if (isNewConversation) return;
      await this.sendFilteredReply(threadId, composeUncertainReply(this.availableActions));
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

        if (plan && plan.steps.length > 0) {
          // Multi-step plan execution is not yet supported — executePlan is not
          // implemented on the orchestrator. Log and fall through to single-action proposal.
          console.warn(
            "[ChatRuntime] Multi-step plan produced but executePlan not available; falling through to single-action.",
          );
          // Continue with single-action proposal below
        }
      } catch (err) {
        console.warn("[Runtime] Plan building failed, falling through to proposal flow:", err);
        // Fall through to single-proposal flow
      }
    }

    // Handle undo command
    if (result.proposals[0]?.actionType === "system.undo") {
      await this.handleUndo(threadId, message.principalId);
      return;
    }

    // Handle kill switch (emergency pause all)
    if (result.proposals[0]?.actionType === "system.kill_switch") {
      await this.handleKillSwitch(threadId, message.principalId, message.organizationId);
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
          await this.handleProposeResult(threadId, proposeResult, message.principalId);
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

  private async handleProposeResult(
    threadId: string,
    result: ProposeResult,
    _principalId: string,
  ): Promise<void> {
    if (result.denied) {
      // Denied — produce conversational denial text
      const deniedCheck = result.decisionTrace.checks.find((c) => c.matched && c.effect === "deny");
      const denialText = this.humanizer.humanizeDenial(
        result.decisionTrace.explanation,
        deniedCheck?.humanDetail,
      );
      await this.sendFilteredReply(threadId, denialText);
      await this.recordAssistantMessage(threadId, denialText);
      return;
    }

    if (result.approvalRequest) {
      // Needs approval - send approval card
      const conversation = await getThread(threadId);
      if (conversation) {
        const updated = transitionConversation(conversation, {
          type: "set_awaiting_approval",
          approvalIds: [result.approvalRequest.id],
        });
        await setThread(updated);
      }

      const actionType = result.envelope.proposals[0]?.actionType;
      const rawCard = buildApprovalCard(
        result.approvalRequest.summary,
        result.approvalRequest.riskCategory,
        result.explanation,
        result.approvalRequest.id,
        result.approvalRequest.bindingHash,
        actionType,
      );
      const card = this.filterCardText(this.humanizer.humanizeApprovalCard(rawCard));
      await this.adapter.sendApprovalCard(threadId, card);
      await this.recordAssistantMessage(
        threadId,
        `[Approval Required] ${result.approvalRequest.summary}`,
      );
      return;
    }

    // Auto-approved - execute immediately
    try {
      const executeResult = await this.orchestrator.executeApproved(result.envelope.id);
      await this.trackLastExecuted(threadId, result.envelope.id);

      // Diagnostic actions → formatted text reply (not result card)
      const actionType = result.envelope.proposals[0]?.actionType ?? "";
      if (isDiagnosticAction(actionType) && executeResult.data) {
        const formatted = formatDiagnosticResult(actionType, executeResult.data);
        await this.sendFilteredReply(threadId, formatted);
        await this.recordAssistantMessage(threadId, formatted);
        return;
      }

      const undoRecipe = executeResult.undoRecipe as UndoRecipe | null;

      const rawCard = buildResultCard(
        executeResult.summary,
        executeResult.success,
        result.envelope.auditEntryIds[0] ?? result.envelope.id,
        result.decisionTrace.computedRiskScore.category,
        executeResult.rollbackAvailable,
        undoRecipe?.undoExpiresAt ?? null,
      );
      const card = this.filterCardText(this.humanizer.humanizeResultCard(rawCard));
      await this.adapter.sendResultCard(threadId, card);
      await this.recordAssistantMessage(threadId, card.summary);
    } catch (err) {
      console.error("Execution error:", err);
      this.failedMessageStore
        ?.record({
          channel: this.adapter.channel,
          rawPayload: { envelopeId: result.envelope.id },
          stage: "execute",
          errorMessage: safeErrorMessage(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        .catch((dlqErr) => console.error("DLQ record error:", dlqErr));
      const errText = `Execution failed: ${safeErrorMessage(err)}`;
      await this.sendFilteredReply(threadId, errText);
      await this.recordAssistantMessage(threadId, errText);
    }
  }

  private async handleCallbackQuery(
    threadId: string,
    callbackData: string,
    principalId: string,
  ): Promise<void> {
    let parsed: {
      action: "approve" | "reject" | "patch";
      approvalId: string;
      bindingHash?: string;
      patchValue?: Record<string, unknown>;
    };

    try {
      parsed = JSON.parse(callbackData);
    } catch {
      return;
    }

    try {
      const response = await this.orchestrator.respondToApproval({
        approvalId: parsed.approvalId,
        action: parsed.action,
        respondedBy: principalId,
        bindingHash: parsed.bindingHash ?? "",
        patchValue: parsed.patchValue,
      });

      if (parsed.action === "approve" || parsed.action === "patch") {
        if (response.executionResult) {
          await this.trackLastExecuted(threadId, response.envelope.id);

          const undoRecipe = response.executionResult.undoRecipe as UndoRecipe | null;

          const rawCard = buildResultCard(
            response.executionResult.summary,
            response.executionResult.success,
            response.envelope.auditEntryIds[0] ?? response.envelope.id,
            response.envelope.decisions[0]?.computedRiskScore.category ?? "low",
            response.executionResult.rollbackAvailable,
            undoRecipe?.undoExpiresAt ?? null,
          );
          const card = this.filterCardText(this.humanizer.humanizeResultCard(rawCard));
          await this.adapter.sendResultCard(threadId, card);
          await this.recordAssistantMessage(threadId, card.summary);
        }
      } else if (parsed.action === "reject") {
        const rejectText = `Action rejected by ${principalId}.`;
        await this.sendFilteredReply(threadId, rejectText);
        await this.recordAssistantMessage(threadId, rejectText);
      }
    } catch (err) {
      console.error("Approval callback error:", err);
      await this.sendFilteredReply(threadId, `Error: ${safeErrorMessage(err)}`);
    }
  }

  private async handleUndo(threadId: string, principalId: string): Promise<void> {
    const lastEnvelopeId = await this.getLastExecutedEnvelopeId(threadId);
    if (!lastEnvelopeId) {
      await this.sendFilteredReply(threadId, "No recent action to undo.");
      return;
    }

    try {
      const undoResult = await this.orchestrator.requestUndo(lastEnvelopeId);
      await this.handleProposeResult(threadId, undoResult, principalId);
    } catch (err) {
      console.error("Undo error:", err);
      await this.sendFilteredReply(threadId, `Cannot undo: ${safeErrorMessage(err)}`);
    }
  }

  private async handleKillSwitch(
    threadId: string,
    principalId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (!this.readAdapter) {
      await this.sendFilteredReply(
        threadId,
        "Cannot execute kill switch: read adapter not configured.",
      );
      return;
    }

    try {
      // Query all campaigns
      const queryResult = await this.readAdapter.query({
        cartridgeId: "digital-ads",
        operation: "searchCampaigns",
        parameters: { query: "" },
        actorId: principalId,
        organizationId,
      });

      const campaigns = queryResult.data as Array<{ id: string; name: string; status: string }>;
      const activeCampaigns = campaigns.filter(
        (c) => c.status === "ACTIVE" || c.status === "active",
      );

      if (activeCampaigns.length === 0) {
        await this.sendFilteredReply(threadId, "No active campaigns to pause.");
        return;
      }

      await this.sendFilteredReply(
        threadId,
        `Emergency: pausing ${activeCampaigns.length} active campaign(s)...`,
      );

      const failures: string[] = [];
      for (const campaign of activeCampaigns) {
        try {
          const killSwitchIdempotencyKey = createHash("sha256")
            .update(principalId)
            .update("kill-switch")
            .update(campaign.id)
            .digest("hex");

          const proposeResult = await this.orchestrator.resolveAndPropose({
            actionType: "digital-ads.campaign.pause",
            parameters: { campaignId: campaign.id, entityId: campaign.id },
            principalId,
            cartridgeId: "digital-ads",
            entityRefs: [],
            message: `Emergency kill switch: pause ${campaign.name}`,
            organizationId,
            emergencyOverride: true,
            idempotencyKey: killSwitchIdempotencyKey,
          });

          if (!("needsClarification" in proposeResult) && !("notFound" in proposeResult)) {
            await this.handleProposeResult(threadId, proposeResult, principalId);
          }
        } catch (err) {
          console.error(`Kill switch error for campaign ${campaign.name}:`, err);
          failures.push(`${campaign.name}: ${safeErrorMessage(err)}`);
        }
      }

      if (failures.length > 0) {
        await this.sendFilteredReply(
          threadId,
          `Kill switch failures:\n${failures.map((f) => `- ${f}`).join("\n")}`,
        );
      }
    } catch (err) {
      console.error("Kill switch error:", err);
      await this.sendFilteredReply(threadId, `Kill switch error: ${safeErrorMessage(err)}`);
    }
  }

  private extractCallbackQueryId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown> | undefined;
    if (!payload) return null;
    const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;
    return callbackQuery ? String(callbackQuery["id"]) : null;
  }
}
