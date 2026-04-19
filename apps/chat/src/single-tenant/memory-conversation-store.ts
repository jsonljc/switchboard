import type { GatewayConversationStore } from "@switchboard/core";
import { randomUUID } from "node:crypto";

export class InMemoryGatewayConversationStore implements GatewayConversationStore {
  private conversations = new Map<
    string,
    { id: string; messages: Array<{ role: string; content: string }> }
  >();

  async getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{ conversationId: string; messages: Array<{ role: string; content: string }> }> {
    const key = `${deploymentId}:${channel}:${sessionId}`;
    let conv = this.conversations.get(key);
    if (!conv) {
      conv = { id: randomUUID(), messages: [] };
      this.conversations.set(key, conv);
    }
    return { conversationId: conv.id, messages: [...conv.messages] };
  }

  async addMessage(conversationId: string, role: string, content: string): Promise<void> {
    for (const conv of this.conversations.values()) {
      if (conv.id === conversationId) {
        conv.messages.push({ role, content });
        return;
      }
    }
  }
}
