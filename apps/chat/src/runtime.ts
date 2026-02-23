import type { ChannelAdapter } from "./adapters/adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import type { InterpreterRegistry } from "./interpreter/registry.js";
import { guardInterpreterOutput } from "./interpreter/schema-guard.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread, setConversationStore } from "./conversation/threads.js";
import {
  composeHelpMessage,
  composeUncertainReply,
  composeDenialReply,
} from "./composer/reply.js";
import { buildApprovalCard } from "./composer/approval-card.js";
import { buildResultCard } from "./composer/result-card.js";
import type { LifecycleOrchestrator, ProposeResult, StorageContext, LedgerStorage } from "@switchboard/core";
import {
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  GuardedCartridge,
} from "@switchboard/core";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import { ApiOrchestratorAdapter } from "./api-orchestrator-adapter.js";
import type { UndoRecipe } from "@switchboard/schemas";
import { AdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";

export interface ChatRuntimeConfig {
  adapter: ChannelAdapter;
  interpreter: Interpreter;
  interpreterRegistry?: InterpreterRegistry;
  orchestrator: LifecycleOrchestrator;
  availableActions: string[];
  storage?: StorageContext;
}

export class ChatRuntime {
  private adapter: ChannelAdapter;
  private interpreter: Interpreter;
  private interpreterRegistry: InterpreterRegistry | null;
  private orchestrator: LifecycleOrchestrator;
  private availableActions: string[];
  private storage: StorageContext | null;
  // Fallback in-memory tracker when no storage is available
  private lastExecutedEnvelopeFallback = new Map<string, string>();

  constructor(config: ChatRuntimeConfig) {
    this.adapter = config.adapter;
    this.interpreter = config.interpreter;
    this.interpreterRegistry = config.interpreterRegistry ?? null;
    this.orchestrator = config.orchestrator;
    this.availableActions = config.availableActions;
    this.storage = config.storage ?? null;
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

    // Handle help command
    if (/^help$/i.test(message.text.trim())) {
      await this.adapter.sendTextReply(
        threadId,
        composeHelpMessage(this.availableActions),
      );
      return;
    }

    // Handle callback queries (approval button taps)
    if (message.text.startsWith("{") && message.text.includes('"action"') && message.text.includes('"approvalId"')) {
      await this.handleCallbackQuery(threadId, message.text, message.principalId);
      return;
    }

    // Interpret the message — use registry if available, else single interpreter
    let rawResult;
    if (this.interpreterRegistry) {
      rawResult = await this.interpreterRegistry.interpret(
        message.text,
        { conversation },
        this.availableActions,
        message.organizationId,
      );
    } else {
      rawResult = await this.interpreter.interpret(
        message.text,
        { conversation },
        this.availableActions,
      );
    }

    // Schema-guard interpreter output before trusting it
    const guard = guardInterpreterOutput(rawResult);
    if (!guard.valid || !guard.data) {
      console.error("Interpreter output failed schema guard:", guard.errors);
      await this.adapter.sendTextReply(threadId, composeUncertainReply());
      return;
    }
    const result = guard.data;

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

      // Default cartridge
      const cartridgeId = "ads-spend";

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
        await this.adapter.sendTextReply(
          threadId,
          `Error processing request: ${err instanceof Error ? err.message : String(err)}`,
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
      await this.adapter.sendTextReply(
        threadId,
        composeDenialReply(result.decisionTrace),
      );
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
    } catch (err) {
      await this.adapter.sendTextReply(
        threadId,
        `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
        }
      } else if (parsed.action === "reject") {
        await this.adapter.sendTextReply(
          threadId,
          `Action rejected by ${principalId}.`,
        );
      }
    } catch (err) {
      await this.adapter.sendTextReply(
        threadId,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
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
      await this.adapter.sendTextReply(
        threadId,
        `Cannot undo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// Bootstrap function
export async function createChatRuntime(config?: Partial<ChatRuntimeConfig>): Promise<ChatRuntime> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const adapter = config?.adapter ?? new TelegramAdapter(botToken);
  const interpreter = config?.interpreter ?? new RuleBasedInterpreter();

  let orchestrator = config?.orchestrator;
  let storage: StorageContext | undefined = config?.storage;

  // Optional: single choke point via Switchboard API (propose/execute/approvals over HTTP)
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  if (!orchestrator && apiUrl) {
    const adapter = new ApiOrchestratorAdapter({
      baseUrl: apiUrl,
      apiKey: process.env["SWITCHBOARD_API_KEY"],
    });
    orchestrator = adapter as unknown as LifecycleOrchestrator;
  }

  if (!orchestrator) {
    // Create storage — use Prisma when DATABASE_URL is set, otherwise in-memory
    let ledgerStorage: LedgerStorage;

    if (process.env["DATABASE_URL"]) {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      const { PrismaConversationStore } = await import("./conversation/prisma-store.js");
      const prisma = getDb();
      storage = createPrismaStorage(prisma);
      ledgerStorage = new PrismaLedgerStorage(prisma);
      setConversationStore(new PrismaConversationStore(prisma));
    } else {
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
    }

    const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
    const guardrailState = createGuardrailState();
    const guardrailStateStore = createGuardrailStateStore();

    // Register ads-spend cartridge
    const adsCartridge = new AdsSpendCartridge();
    await adsCartridge.initialize({
      principalId: "system",
      organizationId: null,
      connectionCredentials: {
        accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
        adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
      },
    });
    storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge));

    // Seed default policies
    await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

    orchestrator = new OrchestratorClass({
      storage,
      ledger,
      guardrailState,
      guardrailStateStore,
    });
  }

  return new ChatRuntime({
    adapter,
    interpreter,
    orchestrator,
    storage,
    availableActions: config?.availableActions ?? [
      "ads.campaign.pause",
      "ads.campaign.resume",
      "ads.budget.adjust",
    ],
  });
}
