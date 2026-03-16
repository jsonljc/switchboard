import type { ConversationStateData } from "./state.js";

export interface ConversationStore {
  get(threadId: string): Promise<ConversationStateData | undefined>;
  save(state: ConversationStateData): Promise<void>;
  delete(threadId: string): Promise<void>;
  listActive(): Promise<ConversationStateData[]>;
}

const DEFAULT_MAX_SIZE = 10_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class InMemoryConversationStore implements ConversationStore {
  private threads = new Map<string, { data: ConversationStateData; expiresAt: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  async get(threadId: string): Promise<ConversationStateData | undefined> {
    const entry = this.threads.get(threadId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.threads.delete(threadId);
      return undefined;
    }
    return entry.data;
  }

  async save(state: ConversationStateData): Promise<void> {
    if (this.threads.size >= this.maxSize && !this.threads.has(state.threadId)) {
      this.evict();
    }
    this.threads.set(state.threadId, {
      data: state,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async delete(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  async listActive(): Promise<ConversationStateData[]> {
    const now = Date.now();
    const active: ConversationStateData[] = [];
    for (const [key, entry] of this.threads) {
      if (entry.expiresAt <= now) {
        this.threads.delete(key);
        continue;
      }
      if (entry.data.status !== "completed" && entry.data.status !== "expired") {
        active.push(entry.data);
      }
    }
    return active;
  }

  private evict(): void {
    const now = Date.now();
    // First pass: remove expired entries
    for (const [key, entry] of this.threads) {
      if (entry.expiresAt <= now) {
        this.threads.delete(key);
      }
    }
    // If still over limit, remove oldest entries
    if (this.threads.size >= this.maxSize) {
      const entries = [...this.threads.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toRemove = entries.slice(0, Math.ceil(this.maxSize * 0.1));
      for (const [key] of toRemove) {
        this.threads.delete(key);
      }
    }
  }
}
