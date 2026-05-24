import type { ConversationState } from "./state.js";
import type { ConversationStore } from "./store.js";
import { InMemoryConversationStore } from "./store.js";

let store: ConversationStore = new InMemoryConversationStore();

export function setConversationStore(s: ConversationStore): void {
  store = s;
}

export function getConversationStore(): ConversationStore {
  return store;
}

export async function getThread(
  threadId: string,
  organizationId: string,
): Promise<ConversationState | undefined> {
  return store.get(threadId, organizationId);
}

export async function setThread(state: ConversationState): Promise<void> {
  await store.save(state);
}

export async function deleteThread(threadId: string, organizationId: string): Promise<void> {
  await store.delete(threadId, organizationId);
}

export async function getActiveThreads(organizationId: string): Promise<ConversationState[]> {
  return store.listActive(organizationId);
}
