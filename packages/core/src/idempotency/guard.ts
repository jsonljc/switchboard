import { createHash } from "node:crypto";

/**
 * IdempotencyGuard — prevents duplicate execution of identical requests.
 *
 * Key = sha256(principalId + actionType + JSON(params))
 * Uses the IdempotencyRecord Prisma model when available,
 * falls back to in-memory Map.
 */

export interface IdempotencyStore {
  /** Check if a key exists and is not expired. Returns cached response or null. */
  get(key: string): Promise<{ response: unknown; createdAt: Date } | null>;
  /** Set a key with response and TTL. */
  set(key: string, response: unknown, ttlMs: number): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, { response: unknown; createdAt: Date; expiresAt: number }>();

  async get(key: string): Promise<{ response: unknown; createdAt: Date } | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { response: entry.response, createdAt: entry.createdAt };
  }

  async set(key: string, response: unknown, ttlMs: number): Promise<void> {
    this.store.set(key, {
      response,
      createdAt: new Date(),
      expiresAt: Date.now() + ttlMs,
    });
  }
}

export class IdempotencyGuard {
  private store: IdempotencyStore;
  private defaultTtlMs: number;

  constructor(config?: {
    store?: IdempotencyStore;
    /** Default TTL in milliseconds (default: 5 minutes) */
    defaultTtlMs?: number;
  }) {
    this.store = config?.store ?? new InMemoryIdempotencyStore();
    this.defaultTtlMs = config?.defaultTtlMs ?? 5 * 60 * 1000;
  }

  /**
   * Generate an idempotency key from request parameters.
   */
  static generateKey(
    principalId: string,
    actionType: string,
    parameters: Record<string, unknown>,
  ): string {
    const hash = createHash("sha256");
    hash.update(principalId);
    hash.update(actionType);
    hash.update(JSON.stringify(parameters, Object.keys(parameters).sort()));
    return hash.digest("hex");
  }

  /**
   * Check if a request is a duplicate.
   * Returns the cached response if duplicate, null otherwise.
   */
  async checkDuplicate(
    principalId: string,
    actionType: string,
    parameters: Record<string, unknown>,
  ): Promise<{ isDuplicate: boolean; cachedResponse: unknown | null }> {
    const key = IdempotencyGuard.generateKey(principalId, actionType, parameters);
    const existing = await this.store.get(key);

    if (existing) {
      return { isDuplicate: true, cachedResponse: existing.response };
    }

    return { isDuplicate: false, cachedResponse: null };
  }

  /**
   * Record a response for deduplication.
   */
  async recordResponse(
    principalId: string,
    actionType: string,
    parameters: Record<string, unknown>,
    response: unknown,
    ttlMs?: number,
  ): Promise<void> {
    const key = IdempotencyGuard.generateKey(principalId, actionType, parameters);
    await this.store.set(key, response, ttlMs ?? this.defaultTtlMs);
  }
}
