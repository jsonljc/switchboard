import type { ChannelAdapter } from "./adapters/adapter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { guardInterpreterOutput } from "./interpreter/schema-guard.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread } from "./conversation/threads.js";
import {
  composeHelpMessage,
  composeUncertainReply,
  composeDenialReply,
} from "./composer/reply.js";
import { buildApprovalCard } from "./composer/approval-card.js";
import { buildResultCard } from "./composer/result-card.js";
import { handleReadIntent } from "./clinic/read-handler.js";
import type {
  RuntimeOrchestrator,
  ProposeResult,
  StorageContext,
  CartridgeReadAdapter as CartridgeReadAdapterType,
} from "@switchboard/core";
import { inferCartridgeId } from "@switchboard/core";
import type { UndoRecipe } from "@switchboard/schemas";
import { safeErrorMessage } from "./utils/safe-error.js";

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
}

export class ChatRuntime {
  private adapter: ChannelAdapter;
  private interpreter: Interpreter;
  private interpreterRegistry: InterpreterRegistry | null;
  private orchestrator: RuntimeOrchestrator;
  private availableActions: string[];
  private storage: StorageContext | null;
  private readAdapter: CartridgeReadAdapterType | null;
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
  }

  getAdapter(): ChannelAdapter {
    return this.adapter;
  }

  private async recordAssistantMessage(threadId: string, text: string): Promise<void> {
    const conversation = await getThread(threadId);
    if (conversation) {
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
    if (!conversation) {
      conversation = createConversation(threadId, message.channel, message.principalId);
      await setThread(conversation);
    }

    // Record the incoming user message for conversation memory
    conversation = transitionConversation(conversation, {
      type: "add_message",
      message: { role: "user", text: message.text, timestamp: new Date() },
    });
    await setThread(conversation);

    // Handle help command
    if (/^help$/i.test(message.text.trim())) {
      const helpText = composeHelpMessage(this.availableActions);
      await this.adapter.sendTextReply(threadId, helpText);
      await this.recordAssistantMessage(threadId, helpText);
      return;
    }

    // Handle callback queries (approval button taps)
    if (message.text.startsWith("{") && message.text.includes('"action"') && message.text.includes('"approvalId"')) {
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
      .slice(-5)
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
      const uncertainReply = composeUncertainReply();
      await this.adapter.sendTextReply(threadId, uncertainReply);
      await this.recordAssistantMessage(threadId, uncertainReply);
      return;
    }
    const result = guard.data;

    // Handle read intents (no governance pipeline needed)
    if (result.readIntent && result.proposals.length === 0) {
      if (!this.readAdapter) {
        await this.adapter.sendTextReply(threadId, "Read operations are not configured.");
        return;
      }
      try {
        const readResult = await handleReadIntent(result.readIntent as import("./clinic/types.js").ReadIntentDescriptor, {
          readAdapter: this.readAdapter,
          cartridgeId: "ads-spend",
          actorId: message.principalId,
          organizationId: message.organizationId,
        });
        await this.adapter.sendTextReply(threadId, readResult.text);
      } catch (err) {
        console.error("Read intent error:", err);
        await this.adapter.sendTextReply(
          threadId,
          `Error reading data: ${safeErrorMessage(err)}`,
        );
      }
      return;
    }

    // If clarification needed
    if (result.needsClarification || result.confidence < 0.5) {
      const question = result.clarificationQuestion ?? composeUncertainReply();
      conversation = transitionConversation(conversation, {
        type: "set_clarifying",
        question,
      });
      await setThread(conversation);
      await this.adapter.sendTextReply(threadId, question);
      return;
    }

    // If no proposals, uncertain
    if (result.proposals.length === 0) {
      await this.adapter.sendTextReply(threadId, composeUncertainReply());
      return;
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
      await this.adapter.sendTextReply(
        threadId,
        "You're sending too many requests. Please wait a moment and try again.",
      );
      return;
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
      const cartridgeId = inferCartridgeId(
        proposal.actionType,
        this.storage?.cartridges ?? undefined,
      ) ?? "ads-spend";

      try {
        const proposeResult = await this.orchestrator.resolveAndPropose({
          actionType: proposal.actionType,
          parameters: proposal.parameters,
          principalId: message.principalId,
          cartridgeId,
          entityRefs,
          message: message.text,
          organizationId: message.organizationId,
        });

        // Handle different outcomes
        if ("needsClarification" in proposeResult) {
          conversation = transitionConversation(conversation, {
            type: "set_clarifying",
            question: proposeResult.question,
          });
          await setThread(conversation);
          await this.adapter.sendTextReply(threadId, proposeResult.question);
        } else if ("notFound" in proposeResult) {
          await this.adapter.sendTextReply(threadId, proposeResult.explanation);
        } else {
          await this.handleProposeResult(threadId, proposeResult, message.principalId);
        }
      } catch (err) {
        console.error("Proposal processing error:", err);
        await this.adapter.sendTextReply(
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
      // Denied
      const denialText = composeDenialReply(result.decisionTrace);
      await this.adapter.sendTextReply(threadId, denialText);
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

      const card = buildApprovalCard(
        result.approvalRequest.summary,
        result.approvalRequest.riskCategory,
        result.explanation,
        result.approvalRequest.id,
        result.approvalRequest.bindingHash,
      );
      await this.adapter.sendApprovalCard(threadId, card);
      await this.recordAssistantMessage(threadId, `[Approval Required] ${result.approvalRequest.summary}`);
      return;
    }

    // Auto-approved - execute immediately
    try {
      const executeResult = await this.orchestrator.executeApproved(result.envelope.id);
      await this.trackLastExecuted(threadId, result.envelope.id);

      const undoRecipe = executeResult.undoRecipe as UndoRecipe | null;

      const card = buildResultCard(
        executeResult.summary,
        executeResult.success,
        result.envelope.auditEntryIds[0] ?? result.envelope.id,
        result.decisionTrace.computedRiskScore.category,
        executeResult.rollbackAvailable,
        undoRecipe?.undoExpiresAt ?? null,
      );
      await this.adapter.sendResultCard(threadId, card);
      await this.recordAssistantMessage(threadId, executeResult.summary);
    } catch (err) {
      console.error("Execution error:", err);
      const errText = `Execution failed: ${safeErrorMessage(err)}`;
      await this.adapter.sendTextReply(threadId, errText);
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

          const card = buildResultCard(
            response.executionResult.summary,
            response.executionResult.success,
            response.envelope.auditEntryIds[0] ?? response.envelope.id,
            response.envelope.decisions[0]?.computedRiskScore.category ?? "low",
            response.executionResult.rollbackAvailable,
            undoRecipe?.undoExpiresAt ?? null,
          );
          await this.adapter.sendResultCard(threadId, card);
          await this.recordAssistantMessage(threadId, response.executionResult.summary);
        }
      } else if (parsed.action === "reject") {
        const rejectText = `Action rejected by ${principalId}.`;
        await this.adapter.sendTextReply(threadId, rejectText);
        await this.recordAssistantMessage(threadId, rejectText);
      }
    } catch (err) {
      console.error("Approval callback error:", err);
      await this.adapter.sendTextReply(
        threadId,
        `Error: ${safeErrorMessage(err)}`,
      );
    }
  }

  private async handleUndo(threadId: string, principalId: string): Promise<void> {
    const lastEnvelopeId = await this.getLastExecutedEnvelopeId(threadId);
    if (!lastEnvelopeId) {
      await this.adapter.sendTextReply(threadId, "No recent action to undo.");
      return;
    }

    try {
      const undoResult = await this.orchestrator.requestUndo(lastEnvelopeId);
      await this.handleProposeResult(threadId, undoResult, principalId);
    } catch (err) {
      console.error("Undo error:", err);
      await this.adapter.sendTextReply(
        threadId,
        `Cannot undo: ${safeErrorMessage(err)}`,
      );
    }
  }

  private async handleKillSwitch(
    threadId: string,
    principalId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (!this.readAdapter) {
      await this.adapter.sendTextReply(threadId, "Cannot execute kill switch: read adapter not configured.");
      return;
    }

    try {
      // Query all campaigns
      const queryResult = await this.readAdapter.query({
        cartridgeId: "ads-spend",
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
        await this.adapter.sendTextReply(threadId, "No active campaigns to pause.");
        return;
      }

      await this.adapter.sendTextReply(
        threadId,
        `Emergency: pausing ${activeCampaigns.length} active campaign(s)...`,
      );

      const failures: string[] = [];
      for (const campaign of activeCampaigns) {
        try {
          const proposeResult = await this.orchestrator.resolveAndPropose({
            actionType: "ads.campaign.pause",
            parameters: { campaignId: campaign.id, entityId: campaign.id },
            principalId,
            cartridgeId: "ads-spend",
            entityRefs: [],
            message: `Emergency kill switch: pause ${campaign.name}`,
            organizationId,
            emergencyOverride: true,
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
        await this.adapter.sendTextReply(
          threadId,
          `Kill switch failures:\n${failures.map((f) => `- ${f}`).join("\n")}`,
        );
      }
    } catch (err) {
      console.error("Kill switch error:", err);
      await this.adapter.sendTextReply(
        threadId,
        `Kill switch error: ${safeErrorMessage(err)}`,
      );
    }
  }

  private extractCallbackQueryId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown> | undefined;
    if (!payload) return null;
    const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;
    return callbackQuery ? String(callbackQuery["id"]) : null;
  }
}
