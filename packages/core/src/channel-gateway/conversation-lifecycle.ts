// ---------------------------------------------------------------------------
// Conversation Lifecycle Tracker — detects conversation end via inactivity
// ---------------------------------------------------------------------------

export type ConversationEndReason = "inactivity" | "explicit_close" | "won" | "lost";

export interface ConversationEndEvent {
  deploymentId: string;
  organizationId: string;
  contactId: string | null;
  channelType: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  duration: number;
  messageCount: number;
  endReason: ConversationEndReason;
}

export type ConversationEndHandler = (event: ConversationEndEvent) => Promise<void>;

export interface ConversationLifecycleConfig {
  onConversationEnd: ConversationEndHandler;
  inactivityTimeoutMs?: number;
  maxSessions?: number;
}

export interface RecordMessageInput {
  sessionKey: string;
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId?: string;
  role: string;
  content: string;
}

interface ActiveSession {
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId: string | null;
  messages: Array<{ role: string; content: string }>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 10_000;

export class ConversationLifecycleTracker {
  private sessions = new Map<string, ActiveSession>();
  private readonly timeoutMs: number;
  private readonly maxSessions: number;
  private readonly handler: ConversationEndHandler;

  constructor(config: ConversationLifecycleConfig) {
    this.handler = config.onConversationEnd;
    this.timeoutMs = config.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  recordMessage(input: RecordMessageInput): void {
    const existing = this.sessions.get(input.sessionKey);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push({ role: input.role, content: input.content });
      if (input.contactId) existing.contactId = input.contactId;
      existing.timer = this.startTimer(input.sessionKey);
    } else {
      if (this.sessions.size >= this.maxSessions) {
        console.warn("[ConversationLifecycleTracker] Max sessions reached, dropping new session");
        return;
      }
      this.sessions.set(input.sessionKey, {
        deploymentId: input.deploymentId,
        organizationId: input.organizationId,
        channelType: input.channelType,
        sessionId: input.sessionId,
        contactId: input.contactId ?? null,
        messages: [{ role: input.role, content: input.content }],
        startedAt: Date.now(),
        timer: this.startTimer(input.sessionKey),
      });
    }
  }

  async closeConversation(sessionKey: string, reason: ConversationEndReason): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    clearTimeout(session.timer);
    await this.fireEnd(sessionKey, session, reason);
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }

  private startTimer(sessionKey: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const session = this.sessions.get(sessionKey);
      if (session) {
        void this.fireEnd(sessionKey, session, "inactivity");
      }
    }, this.timeoutMs);
  }

  private async fireEnd(
    sessionKey: string,
    session: ActiveSession,
    reason: ConversationEndReason,
  ): Promise<void> {
    this.sessions.delete(sessionKey);

    const event: ConversationEndEvent = {
      deploymentId: session.deploymentId,
      organizationId: session.organizationId,
      contactId: session.contactId,
      channelType: session.channelType,
      sessionId: session.sessionId,
      messages: session.messages,
      duration: Math.round((Date.now() - session.startedAt) / 1000),
      messageCount: session.messages.length,
      endReason: reason,
    };

    try {
      await this.handler(event);
    } catch (err) {
      console.error("[ConversationLifecycleTracker] Error in end handler:", err);
    }
  }
}
