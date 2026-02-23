import type { ConversationStateData } from "./state.js";
import type { ConversationStore } from "./store.js";
import { InMemoryConversationStore } from "./store.js";

let store: ConversationStore = new InMemoryConversationStore();

export function setConversationStore(s: ConversationStore): void {
  store = s;
}

export function getConversationStore(): ConversationStore {
  return store;
}

export async function getThread(threadId: string): Promise<ConversationStateData | undefined> {
  return store.get(threadId);
}

export async function setThread(state: ConversationStateData): Promise<void> {
  await store.save(state);
}

export async function deleteThread(threadId: string): Promise<void> {
  await store.delete(threadId);
}

export async function getActiveThreads(): Promise<ConversationStateData[]> {
  return store.listActive();
}
