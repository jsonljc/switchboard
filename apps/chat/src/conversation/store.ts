import type { ConversationStateData } from "./state.js";

export interface ConversationStore {
  get(threadId: string): Promise<ConversationStateData | undefined>;
  save(state: ConversationStateData): Promise<void>;
  delete(threadId: string): Promise<void>;
  listActive(): Promise<ConversationStateData[]>;
}

export class InMemoryConversationStore implements ConversationStore {
  private threads = new Map<string, ConversationStateData>();

  async get(threadId: string): Promise<ConversationStateData | undefined> {
    return this.threads.get(threadId);
  }

  async save(state: ConversationStateData): Promise<void> {
    this.threads.set(state.threadId, state);
  }

  async delete(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  async listActive(): Promise<ConversationStateData[]> {
    return Array.from(this.threads.values()).filter(
      (t) => t.status !== "completed" && t.status !== "expired",
    );
  }
}
