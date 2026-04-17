import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "./types.js";
import type { SubmitWorkRequest } from "../platform/work-unit.js";
import { DeploymentInactiveError, toDeploymentContext } from "../platform/deployment-resolver.js";

const MAX_HISTORY_MESSAGES = 30;

export class ChannelGateway {
  constructor(private config: ChannelGatewayConfig) {}

  async handleIncoming(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
    const { deploymentResolver, platformIngress, conversationStore } = this.config;

    // 1. Resolve deployment
    let resolved;
    try {
      resolved = await deploymentResolver.resolveByChannelToken(message.channel, message.token);
    } catch (err) {
      if (err instanceof DeploymentInactiveError) {
        await replySink.send(
          "This agent is currently inactive. Please contact your administrator.",
        );
        return;
      }
      throw err;
    }

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
}
