// ---------------------------------------------------------------------------
// Conversation Session Store — Persistent conversation state
// ---------------------------------------------------------------------------

import type { ConversationState } from "./types.js";

/**
 * Minimal Redis interface for session store.
 * Compatible with ioredis without requiring the dependency at compile time.
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  pipeline(): {
    setex(key: string, seconds: number, value: string): unknown;
    del(key: string): unknown;
    exec(): Promise<unknown>;
  };
}

/**
 * A conversation session binds a channel identity (phone number, chat ID)
 * to an active conversation flow state.
 */
export interface ConversationSession {
  /** Unique session ID */
  id: string;
  /** Channel identifier (phone number, chat widget ID, etc.) */
  channelId: string;
  /** Channel type */
  channelType: "sms" | "web_chat" | "instagram_dm" | "facebook_messenger" | "whatsapp" | "telegram";
  /** Patient ID if known */
  contactId: string | null;
  /** Organization ID */
  organizationId: string;
  /** Active flow definition ID */
  flowId: string;
  /** Current conversation state */
  state: ConversationState;
  /** When the session was created */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Session timeout in ms (default: 30 minutes) */
  timeoutMs: number;
  /** Whether the session has been escalated to a human */
  escalated: boolean;
  /** Metadata for tracking */
  metadata: Record<string, unknown>;
  /** Current lead state machine state (for lifecycle tracking above the flow engine). */
  machineState?: string;
}

/**
 * Session store interface. Implementations can be in-memory,
 * Redis-backed, or database-backed.
 */
export interface ConversationSessionStore {
  /** Get an active session by channel ID */
  getByChannelId(channelId: string): Promise<ConversationSession | null>;
  /** Get a session by ID */
  getById(sessionId: string): Promise<ConversationSession | null>;
  /** Create a new session */
  create(session: ConversationSession): Promise<void>;
  /** Update an existing session */
  update(sessionId: string, updates: Partial<ConversationSession>): Promise<void>;
  /** Delete/end a session */
  delete(sessionId: string): Promise<void>;
  /** List all active sessions for an organization */
  listActive(organizationId: string): Promise<ConversationSession[]>;
}

/**
 * In-memory session store for development and testing.
 * Data is lost on restart.
 */
export class InMemorySessionStore implements ConversationSessionStore {
  private sessions = new Map<string, ConversationSession>();
  private channelIndex = new Map<string, string>(); // channelId → sessionId

  async getByChannelId(channelId: string): Promise<ConversationSession | null> {
    const sessionId = this.channelIndex.get(channelId);
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.channelIndex.delete(channelId);
      return null;
    }

    // Check for timeout
    if (Date.now() - session.lastActivityAt.getTime() > session.timeoutMs) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  async getById(sessionId: string): Promise<ConversationSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async create(session: ConversationSession): Promise<void> {
    this.sessions.set(session.id, session);
    this.channelIndex.set(session.channelId, session.id);
  }

  async update(sessionId: string, updates: Partial<ConversationSession>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    Object.assign(session, updates, { lastActivityAt: new Date() });
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.channelIndex.delete(session.channelId);
      this.sessions.delete(sessionId);
    }
  }

  async listActive(organizationId: string): Promise<ConversationSession[]> {
    const now = Date.now();
    const active: ConversationSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.organizationId !== organizationId) continue;
      if (now - session.lastActivityAt.getTime() > session.timeoutMs) continue;
      active.push(session);
    }

    return active;
  }
}

/**
 * Redis-backed session store for production use.
 * Sessions are stored as JSON with TTL matching the session timeout.
 */
export class RedisSessionStore implements ConversationSessionStore {
  private redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  private sessionKey(id: string): string {
    return `convsession:${id}`;
  }

  private channelKey(channelId: string): string {
    return `convchannel:${channelId}`;
  }

  async getByChannelId(channelId: string): Promise<ConversationSession | null> {
    try {
      const sessionId = await this.redis.get(this.channelKey(channelId));
      if (!sessionId) return null;
      return this.getById(sessionId);
    } catch {
      return null;
    }
  }

  async getById(sessionId: string): Promise<ConversationSession | null> {
    try {
      const raw = await this.redis.get(this.sessionKey(sessionId));
      if (!raw) return null;
      return this.deserialize(raw);
    } catch {
      return null;
    }
  }

  async create(session: ConversationSession): Promise<void> {
    try {
      const ttl = Math.ceil(session.timeoutMs / 1000);
      const pipeline = this.redis.pipeline();
      pipeline.setex(this.sessionKey(session.id), ttl, this.serialize(session));
      pipeline.setex(this.channelKey(session.channelId), ttl, session.id);
      await pipeline.exec();
    } catch {
      // fail-open
    }
  }

  async update(sessionId: string, updates: Partial<ConversationSession>): Promise<void> {
    try {
      const existing = await this.getById(sessionId);
      if (!existing) return;

      const updated = { ...existing, ...updates, lastActivityAt: new Date() };
      const ttl = Math.ceil(updated.timeoutMs / 1000);
      await this.redis.setex(this.sessionKey(sessionId), ttl, this.serialize(updated));
    } catch {
      // fail-open
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      const session = await this.getById(sessionId);
      if (session) {
        const pipeline = this.redis.pipeline();
        pipeline.del(this.sessionKey(sessionId));
        pipeline.del(this.channelKey(session.channelId));
        await pipeline.exec();
      }
    } catch {
      // fail-open
    }
  }

  async listActive(_organizationId: string): Promise<ConversationSession[]> {
    // Redis doesn't support efficient listing by org — would need a secondary index
    // For now, return empty. Production should use a sorted set index.
    return [];
  }

  private serialize(session: ConversationSession): string {
    return JSON.stringify({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      state: {
        ...session.state,
        history: session.state.history.map((h) => ({
          ...h,
          timestamp: h.timestamp instanceof Date ? h.timestamp.toISOString() : h.timestamp,
        })),
      },
    });
  }

  private deserialize(raw: string): ConversationSession {
    const data = JSON.parse(raw);
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      lastActivityAt: new Date(data.lastActivityAt),
      state: {
        ...data.state,
        history: data.state.history.map((h: Record<string, unknown>) => ({
          ...h,
          timestamp: new Date(h["timestamp"] as string),
        })),
      },
    };
  }
}
