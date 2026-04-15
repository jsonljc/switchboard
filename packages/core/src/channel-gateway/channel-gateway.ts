import type { AgentHandler } from "@switchboard/sdk";
import { AgentRuntime } from "../agent-runtime/agent-runtime.js";
import { DefaultChatHandler } from "../agent-runtime/default-chat-handler.js";
import { SkillHandler } from "../skill-runtime/skill-handler.js";
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

    // 5.6 Resolve model tier for cost optimization
    const modelSlot =
      this.config.modelRouter?.resolveTier({
        messageIndex: allMessages.length - 1,
        toolCount: 0,
        hasHighRiskTools: false,
        previousTurnUsedTools: false,
        previousTurnEscalated: false,
        modelFloor: undefined,
      }) ?? "default";

    // 5.7 Resolve handler — skill-based or legacy
    const handler = this.resolveHandler(info, message);

    // 6. Create ephemeral AgentRuntime
    const runtime = new AgentRuntime({
      handler,
      deploymentId: info.deployment.id,
      surface: message.channel,
      trustScore: info.trustScore,
      trustLevel: info.trustLevel,
      persona: enrichedPersona,
      stateStore: this.config.stateStore,
      actionRequestStore: this.config.actionRequestStore,
      llmAdapter: this.config.llmAdapterFactory(modelSlot),
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

  /**
   * Resolves the handler for a deployment. If the deployment has a skillSlug
   * and skill runtime deps are configured, creates a SkillHandler. Otherwise
   * falls back to the DefaultChatHandler.
   */
  private resolveHandler(
    info: { deployment: { id: string; organizationId: string; skillSlug?: string | null } },
    message: IncomingChannelMessage,
  ): AgentHandler {
    const { skillRuntime } = this.config;
    const { skillSlug } = info.deployment;

    if (skillSlug && skillRuntime) {
      const skill = skillRuntime.loadSkill(skillSlug, skillRuntime.skillsDir);
      const executor = skillRuntime.createExecutor();
      return new SkillHandler(
        skill,
        executor,
        skillRuntime.builderMap,
        skillRuntime.stores,
        {
          deploymentId: info.deployment.id,
          orgId: info.deployment.organizationId,
          contactId: message.sessionId,
        },
        skillRuntime.traceStore,
        skillRuntime.circuitBreaker,
        skillRuntime.blastRadiusLimiter,
        skillRuntime.outcomeLinker,
      );
    }

    return DefaultChatHandler;
  }
}
