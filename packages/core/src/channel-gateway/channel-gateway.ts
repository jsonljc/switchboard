import { AgentRuntime } from "../agent-runtime/agent-runtime.js";
import { DefaultChatHandler } from "../agent-runtime/default-chat-handler.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "./types.js";
import { UnknownChannelError } from "./types.js";

const MAX_HISTORY_MESSAGES = 30;

export class ChannelGateway {
  constructor(private config: ChannelGatewayConfig) {}

  async handleIncoming(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
    // 1. Resolve deployment
    const info = await this.config.deploymentLookup.findByChannelToken(
      message.channel,
      message.token,
    );
    if (!info) {
      throw new UnknownChannelError(message.channel, message.token);
    }

    // 2. Get or create conversation
    const { conversationId, messages: history } =
      await this.config.conversationStore.getOrCreateBySession(
        info.deployment.id,
        message.channel,
        message.sessionId,
      );

    // 3. Persist incoming message
    await this.config.conversationStore.addMessage(conversationId, "user", message.text);

    // 4. Signal typing
    replySink.onTyping?.();

    // 5. Cap history and add new message
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const allMessages = [...recentHistory, { role: "user", content: message.text }];

    // 6. Create ephemeral AgentRuntime
    const runtime = new AgentRuntime({
      handler: DefaultChatHandler,
      deploymentId: info.deployment.id,
      surface: message.channel,
      trustScore: info.trustScore,
      trustLevel: info.trustLevel,
      persona: info.persona,
      stateStore: this.config.stateStore,
      actionRequestStore: this.config.actionRequestStore,
      llmAdapter: this.config.llmAdapterFactory(),
      onChatExecute: async (reply: string) => {
        await replySink.send(reply);
        await this.config.conversationStore.addMessage(conversationId, "assistant", reply);
      },
    });

    // 7. Handle message
    await runtime.handleMessage({
      conversationId,
      messages: allMessages,
    });
  }
}
