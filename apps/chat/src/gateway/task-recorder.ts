const DEFAULT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MIN_ASSISTANT_MESSAGES = 2;
const DEFAULT_MAX_SESSIONS = 10_000;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 200;

interface RecordedMessage {
  role: "user" | "assistant";
  content: string;
}

interface SessionState {
  deploymentId: string;
  listingId: string;
  organizationId: string;
  channel: string;
  messages: RecordedMessage[];
  assistantCount: number;
  timer: ReturnType<typeof setTimeout>;
}

interface MessageInfo {
  deploymentId: string;
  listingId: string;
  organizationId: string;
  channel: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}

interface TaskRecorderConfig {
  createTask: (input: {
    deploymentId: string;
    organizationId?: string;
    listingId: string;
    category: string;
    input?: Record<string, unknown>;
  }) => Promise<{ id: string }>;
  submitOutput: (taskId: string, output: Record<string, unknown>) => Promise<unknown>;
  sessionTimeoutMs?: number;
  minAssistantMessages?: number;
  maxSessions?: number;
  maxMessagesPerSession?: number;
}

export class TaskRecorder {
  private sessions = new Map<string, SessionState>();
  private timeoutMs: number;
  private minAssistantMessages: number;
  private maxSessions: number;
  private maxMessagesPerSession: number;
  private config: TaskRecorderConfig;

  constructor(config: TaskRecorderConfig) {
    this.config = config;
    this.timeoutMs = config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.minAssistantMessages = config.minAssistantMessages ?? DEFAULT_MIN_ASSISTANT_MESSAGES;
    this.maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxMessagesPerSession = config.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES_PER_SESSION;
  }

  recordMessage(info: MessageInfo): void {
    const key = `${info.channel}:${info.sessionId}`;
    let session = this.sessions.get(key);

    if (!session) {
      // Reject new sessions if at capacity
      if (this.sessions.size >= this.maxSessions) {
        console.warn("[TaskRecorder] Max sessions reached, dropping new session");
        return;
      }
      session = {
        deploymentId: info.deploymentId,
        listingId: info.listingId,
        organizationId: info.organizationId,
        channel: info.channel,
        messages: [],
        assistantCount: 0,
        timer: setTimeout(() => this.flushSession(key), this.timeoutMs),
      };
      this.sessions.set(key, session);
    } else {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.flushSession(key), this.timeoutMs);
    }

    // Cap messages per session to prevent memory blowup from long conversations
    if (session.messages.length < this.maxMessagesPerSession) {
      session.messages.push({ role: info.role, content: info.content });
      if (info.role === "assistant") {
        session.assistantCount++;
      }
    }
  }

  private async flushSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    // Delete session before async work. If a message arrives during flush for the
    // same sessionId, it starts a new session — acceptable trade-off for MVP since
    // timeout means the conversation is effectively over.
    this.sessions.delete(key);

    if (session.assistantCount < this.minAssistantMessages) return;

    try {
      const task = await this.config.createTask({
        deploymentId: session.deploymentId,
        organizationId: session.organizationId,
        listingId: session.listingId,
        category: "general-inquiry",
        input: { channel: session.channel },
      });

      await this.config.submitOutput(task.id, {
        transcript: session.messages,
        messageCount: session.messages.length,
        assistantMessageCount: session.assistantCount,
      });
    } catch (err) {
      console.error("[TaskRecorder] Failed to record task:", err);
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }
}
