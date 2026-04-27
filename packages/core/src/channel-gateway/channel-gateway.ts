import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "./types.js";
import type { CanonicalSubmitRequest } from "../platform/canonical-request.js";
import { DeploymentInactiveError } from "../platform/deployment-resolver.js";
import { resolveContactIdentity } from "./resolve-contact-identity.js";

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
        // Persist inbound message so owners can see what was missed while paused
        try {
          const { conversationId } = await conversationStore.getOrCreateBySession(
            err.deploymentId,
            message.channel,
            message.sessionId,
          );
          await conversationStore.addMessage(conversationId, "user", message.text);
        } catch {
          // Best-effort: don't fail the paused reply if persistence fails
        }
        await replySink.send("This service is temporarily paused. Please try again later.");
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

    // 3b. Check for human override — skip skill dispatch if owner has taken over
    if (this.config.conversationStore.getConversationStatus) {
      const status = await this.config.conversationStore.getConversationStatus(message.sessionId);
      if (status === "human_override") {
        return;
      }
    }

    // 3c. Resolve contact identity (no-op when contactStore not wired or non-WhatsApp channel)
    const identity = this.config.contactStore
      ? await resolveContactIdentity({
          channel: message.channel,
          sessionId: message.sessionId,
          organizationId: resolved.organizationId,
          contactStore: this.config.contactStore,
        })
      : { contactId: null, phone: null, channel: message.channel };

    // 4. Signal typing
    replySink.onTyping?.();

    // 5. Build conversation context
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const messages = [...recentHistory, { role: "user", content: message.text }].map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // 6. Build CanonicalSubmitRequest
    const request: CanonicalSubmitRequest = {
      organizationId: resolved.organizationId,
      actor: { id: message.sessionId, type: "user" as const },
      intent: `${resolved.skillSlug}.respond`,
      parameters: {
        message: message.text,
        conversation: { messages, sessionId: message.sessionId },
        persona: resolved.persona,
        ...(identity.contactId ? { contactId: identity.contactId } : {}),
        ...(identity.phone ? { phone: identity.phone } : {}),
        channel: identity.channel,
        _agentContext: { persona: resolved.persona },
      },
      trigger: "chat" as const,
      surface: { surface: "chat", sessionId: message.sessionId },
      targetHint: {
        skillSlug: resolved.skillSlug,
        deploymentId: resolved.deploymentId,
        channel: message.channel,
        token: message.token,
      },
    };

    // 7. Submit through PlatformIngress
    const response = await platformIngress.submit(request);

    // 7b. Re-check override status — operator may have toggled during skill execution
    if (this.config.conversationStore.getConversationStatus) {
      const postStatus = await this.config.conversationStore.getConversationStatus(
        message.sessionId,
      );
      if (postStatus === "human_override") {
        // Operator took over mid-flight — discard AI response, persist it silently
        if (response.ok) {
          const text =
            typeof response.result.outputs.response === "string"
              ? response.result.outputs.response
              : response.result.summary;
          await conversationStore.addMessage(conversationId, "assistant", `[suppressed] ${text}`);
        }
        return;
      }
    }

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
