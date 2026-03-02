import type { SecurityStore } from "./security-store.js";

export class InMemorySecurityStore implements SecurityStore {
  private processedMessages = new Map<string, number>();
  private rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

  async checkNonce(nonce: string, ttlMs: number): Promise<boolean> {
    const existing = this.processedMessages.get(nonce);
    if (existing && Date.now() - existing < ttlMs) {
      return false; // Already processed
    }
    this.processedMessages.set(nonce, Date.now());

    // Cleanup old entries
    for (const [id, time] of this.processedMessages) {
      if (Date.now() - time > ttlMs) {
        this.processedMessages.delete(id);
      }
    }

    return true;
  }

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const entry = this.rateLimitCounters.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      this.rateLimitCounters.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count++;
    return entry.count <= limit;
  }
}
