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
    this.config.onMessageRecorded?.({
      deploymentId: info.deployment.id,
      listingId: info.deployment.listingId,
      organizationId: info.deployment.organizationId,
      channel: message.channel,
      sessionId: message.sessionId,
      role: "user",
      content: message.text,
    });

    // 4. Signal typing
    replySink.onTyping?.();

    // 5. Cap history and add new message
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const allMessages = [...recentHistory, { role: "user", content: message.text }];

    // 5.5 Build knowledge context (if available)
    let knowledgeContext = "";
    if (this.config.contextBuilder) {
      try {
        const ctx = await this.config.contextBuilder.build({
          organizationId: info.deployment.organizationId,
          agentId: info.deployment.listingId,
          deploymentId: info.deployment.id,
          query: message.text,
          contactId: message.visitor?.name,
        });

        const sections: string[] = [];
        if (ctx.learnedFacts.length > 0) {
          sections.push(
            "LEARNED FACTS (from past conversations):\n" +
              ctx.learnedFacts.map((f) => `- ${f.content} [${f.category}]`).join("\n"),
          );
        }
        if (ctx.retrievedChunks.length > 0) {
          sections.push(
            "BUSINESS KNOWLEDGE:\n" + ctx.retrievedChunks.map((c) => c.content).join("\n"),
          );
        }
        if (ctx.recentSummaries.length > 0) {
          sections.push(
            "RECENT INTERACTIONS:\n" +
              ctx.recentSummaries.map((s) => `- ${s.summary} (${s.outcome})`).join("\n"),
          );
        }
        knowledgeContext = sections.join("\n\n");
      } catch {
        // Graceful degradation — agent works without knowledge context
      }
    }

    const enrichedPersona = knowledgeContext
      ? {
          ...info.persona,
          customInstructions: [info.persona.customInstructions, knowledgeContext]
            .filter(Boolean)
            .join("\n\n"),
        }
      : info.persona;

    // 6. Create ephemeral AgentRuntime
    const runtime = new AgentRuntime({
      handler: DefaultChatHandler,
      deploymentId: info.deployment.id,
      surface: message.channel,
      trustScore: info.trustScore,
      trustLevel: info.trustLevel,
      persona: enrichedPersona,
      stateStore: this.config.stateStore,
      actionRequestStore: this.config.actionRequestStore,
      llmAdapter: this.config.llmAdapterFactory(),
      onChatExecute: async (reply: string) => {
        await replySink.send(reply);
        await this.config.conversationStore.addMessage(conversationId, "assistant", reply);
        this.config.onMessageRecorded?.({
          deploymentId: info.deployment.id,
          listingId: info.deployment.listingId,
          organizationId: info.deployment.organizationId,
          channel: message.channel,
          sessionId: message.sessionId,
          role: "assistant",
          content: reply,
        });
      },
    });

    // 7. Handle message
    await runtime.handleMessage({
      conversationId,
      messages: allMessages,
    });
  }
}
