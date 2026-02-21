import type { ChannelAdapter } from "./adapters/adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { RuleBasedInterpreter } from "./interpreter/interpreter.js";
import type { Interpreter } from "./interpreter/interpreter.js";
import { createConversation, transitionConversation } from "./conversation/state.js";
import { getThread, setThread } from "./conversation/threads.js";
import { composeHelpMessage, composeUncertainReply } from "./composer/reply.js";

export interface ChatRuntimeConfig {
  adapter: ChannelAdapter;
  interpreter: Interpreter;
  availableActions: string[];
  apiBaseUrl: string;
}

export class ChatRuntime {
  private adapter: ChannelAdapter;
  private interpreter: Interpreter;
  private availableActions: string[];

  constructor(config: ChatRuntimeConfig) {
    this.adapter = config.adapter;
    this.interpreter = config.interpreter;
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

    // Set proposals on conversation
    conversation = transitionConversation(conversation, {
      type: "set_proposals",
      proposalIds: result.proposals.map((p) => p.id),
    });
    setThread(conversation);

    // In production, would submit proposals to the API server for evaluation
    // For now, acknowledge receipt
    const proposalSummary = result.proposals
      .map((p) => `- ${p.actionType}: ${JSON.stringify(p.parameters)}`)
      .join("\n");

    await this.adapter.sendTextReply(
      threadId,
      `Processing your request:\n${proposalSummary}\n\nEvaluating policies...`,
    );
  }
}

// Bootstrap function
export function createChatRuntime(config?: Partial<ChatRuntimeConfig>): ChatRuntime {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const adapter = config?.adapter ?? new TelegramAdapter(botToken);
  const interpreter = config?.interpreter ?? new RuleBasedInterpreter();

  return new ChatRuntime({
    adapter,
    interpreter,
    availableActions: config?.availableActions ?? [
      "ads.campaign.pause",
      "ads.campaign.resume",
      "ads.budget.adjust",
    ],
    apiBaseUrl: config?.apiBaseUrl ?? "http://localhost:3000",
  });
}
