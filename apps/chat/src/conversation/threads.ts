import type { ConversationStateData } from "./state.js";

// In-memory thread tracker; in production, use database
const threads = new Map<string, ConversationStateData>();

export function getThread(threadId: string): ConversationStateData | undefined {
  return threads.get(threadId);
}

export function setThread(state: ConversationStateData): void {
  threads.set(state.threadId, state);
}

export function deleteThread(threadId: string): void {
  threads.delete(threadId);
}

export function getActiveThreads(): ConversationStateData[] {
  return Array.from(threads.values()).filter(
    (t) => t.status !== "completed" && t.status !== "expired",
  );
}
