import { AgentRuntime } from "../agent-runtime/agent-runtime.js";
import { DefaultChatHandler } from "../agent-runtime/default-chat-handler.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "./types.js";
import { UnknownChannelError } from "./types.js";
import type { SubmitWorkRequest } from "../platform/work-unit.js";
import { toDeploymentContext } from "../platform/deployment-resolver.js";

const MAX_HISTORY_MESSAGES = 30;

export class ChannelGateway {
  constructor(private config: ChannelGatewayConfig) {}

  async handleIncoming(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
    const { deploymentResolver, platformIngress } = this.config;

    if (deploymentResolver && platformIngress) {
      return this.handleConverged(message, replySink);
    }

    return this.handleLegacy(message, replySink);
  }

  private async handleLegacy(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
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

    // 5.7 Resolve handler — legacy path uses DefaultChatHandler only
    const handler = this.resolveHandler();

    // 6. Create ephemeral AgentRuntime
    const runtime = new AgentRuntime({
      handler,
      deploymentId: info.deployment.id,
      surface: message.channel,
      trustScore: info.trustScore,
      trustLevel: info.trustLevel,
      persona: enrichedPersona,
      deploymentInputConfig: info.deployment.inputConfig,
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

  private async handleConverged(
    message: IncomingChannelMessage,
    replySink: ReplySink,
  ): Promise<void> {
    const { deploymentResolver, platformIngress, conversationStore } = this.config;
    if (!deploymentResolver || !platformIngress) return;

    // 1. Resolve deployment
    const resolved = await deploymentResolver.resolveByChannelToken(message.channel, message.token);

    // 2. Get/create conversation
    const { conversationId, messages: history } = await conversationStore.getOrCreateBySession(
      resolved.deploymentId,
      message.channel,
      message.sessionId,
    );

    // 3. Persist incoming message
    await conversationStore.addMessage(conversationId, "user", message.text);
    this.config.onMessageRecorded?.({
      deploymentId: resolved.deploymentId,
      listingId: resolved.listingId,
      organizationId: resolved.organizationId,
      channel: message.channel,
      sessionId: message.sessionId,
      role: "user",
      content: message.text,
    });

    // 4. Signal typing
    replySink.onTyping?.();

    // 5. Build conversation context
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const messages = [...recentHistory, { role: "user", content: message.text }].map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // 6. Build SubmitWorkRequest
    const request: SubmitWorkRequest = {
      organizationId: resolved.organizationId,
      actor: { id: message.sessionId, type: "user" as const },
      intent: `${resolved.skillSlug}.respond`,
      parameters: {
        message: message.text,
        conversation: { messages, sessionId: message.sessionId },
        persona: resolved.persona,
      },
      trigger: "chat" as const,
      deployment: toDeploymentContext(resolved),
    };

    // 7. Submit through PlatformIngress
    const response = await platformIngress.submit(request);

    // 8. Extract response and send
    if (response.ok) {
      const text =
        typeof response.result.outputs.response === "string"
          ? response.result.outputs.response
          : response.result.summary;
      await conversationStore.addMessage(conversationId, "assistant", text);
      this.config.onMessageRecorded?.({
        deploymentId: resolved.deploymentId,
        listingId: resolved.listingId,
        organizationId: resolved.organizationId,
        channel: message.channel,
        sessionId: message.sessionId,
        role: "assistant",
        content: text,
      });
      await replySink.send(text);
    } else {
      await replySink.send("I'm having trouble right now. Let me connect you with the team.");
    }
  }

  /**
   * Legacy handler resolution. Skill-based execution now routes through the
   * converged path (handleConverged → PlatformIngress → SkillMode). This
   * fallback returns DefaultChatHandler for deployments still on the legacy path.
   */
  private resolveHandler(): typeof DefaultChatHandler {
    return DefaultChatHandler;
  }
}
