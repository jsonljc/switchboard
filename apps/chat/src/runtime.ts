import type { ChannelAdapter } from "./adapters/adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread } from "./conversation/threads.js";
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
} from "@switchboard/core";
import { LifecycleOrchestrator as OrchestratorClass } from "@switchboard/core";
import type { UndoRecipe } from "@switchboard/schemas";
import { AdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";

export interface ChatRuntimeConfig {
  adapter: ChannelAdapter;
  interpreter: Interpreter;
  orchestrator: LifecycleOrchestrator;
  availableActions: string[];
  apiBaseUrl: string;
}

export class ChatRuntime {
  private adapter: ChannelAdapter;
  private interpreter: Interpreter;
  private orchestrator: LifecycleOrchestrator;
  private availableActions: string[];
  // Track the last executed envelope per thread for undo
  private lastExecutedEnvelope = new Map<string, string>();

  constructor(config: ChatRuntimeConfig) {
    this.adapter = config.adapter;
    this.interpreter = config.interpreter;
    this.orchestrator = config.orchestrator;
    this.availableActions = config.availableActions;
  }

  async handleIncomingMessage(rawPayload: unknown): Promise<void> {
    const message = this.adapter.parseIncomingMessage(rawPayload);
    if (!message) return;

    const threadId = message.threadId ?? message.id;

    // Get or create conversation
    let conversation = getThread(threadId);
    if (!conversation) {
      conversation = createConversation(threadId, message.channel, message.principalId);
      setThread(conversation);
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
    if (message.text.startsWith("{") && message.text.includes('"action"')) {
      await this.handleCallbackQuery(threadId, message.text, message.principalId);
      return;
    }

    // Interpret the message
    const result = await this.interpreter.interpret(
      message.text,
      { conversation },
      this.availableActions,
    );

    // If clarification needed
    if (result.needsClarification || result.confidence < 0.5) {
      const question = result.clarificationQuestion ?? composeUncertainReply();
      conversation = transitionConversation(conversation, {
        type: "set_clarifying",
        question,
      });
      setThread(conversation);
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
    setThread(conversation);

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
          setThread(conversation);
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
      const conversation = getThread(threadId);
      if (conversation) {
        const updated = transitionConversation(conversation, {
          type: "set_awaiting_approval",
          approvalIds: [result.approvalRequest.id],
        });
        setThread(updated);
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
      this.lastExecutedEnvelope.set(threadId, result.envelope.id);

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
          this.lastExecutedEnvelope.set(threadId, response.envelope.id);

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
    const lastEnvelopeId = this.lastExecutedEnvelope.get(threadId);
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

  if (!orchestrator) {
    // Create storage — use Prisma when DATABASE_URL is set, otherwise in-memory
    let storage: StorageContext;
    let ledgerStorage: LedgerStorage;

    if (process.env["DATABASE_URL"]) {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      const prisma = getDb();
      storage = createPrismaStorage(prisma);
      ledgerStorage = new PrismaLedgerStorage(prisma);
    } else {
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
    }

    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

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
    storage.cartridges.register("ads-spend", adsCartridge);

    // Seed default policies
    await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

    orchestrator = new OrchestratorClass({
      storage,
      ledger,
      guardrailState,
    });
  }

  return new ChatRuntime({
    adapter,
    interpreter,
    orchestrator,
    availableActions: config?.availableActions ?? [
      "ads.campaign.pause",
      "ads.campaign.resume",
      "ads.budget.adjust",
    ],
    apiBaseUrl: config?.apiBaseUrl ?? "http://localhost:3000",
  });
}
