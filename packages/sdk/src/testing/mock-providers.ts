import type {
  StateStore,
  ChatProvider,
  FileProvider,
  BrowserProvider,
  LLMProvider,
  StructuredNotification,
} from "../context.js";
import type { HandoffPayload } from "../handoff.js";

export class InMemoryStateStore implements StateStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    const results: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) {
        results.push({ key, value });
      }
    }
    return results;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export interface GoverningChatProvider extends ChatProvider {
  messagesSent: string[];
  pendingApprovals: Array<{ type: "send_message"; content: string }>;
}

export function createGoverningChatProvider(
  trustLevel: "supervised" | "guided" | "autonomous",
): GoverningChatProvider {
  const messagesSent: string[] = [];
  const pendingApprovals: Array<{ type: "send_message"; content: string }> = [];

  return {
    messagesSent,
    pendingApprovals,
    async send(message: string) {
      if (trustLevel === "supervised") {
        pendingApprovals.push({ type: "send_message", content: message });
      } else {
        messagesSent.push(message);
      }
    },
    async sendToThread(_threadId: string, message: string) {
      if (trustLevel === "supervised") {
        pendingApprovals.push({ type: "send_message", content: message });
      } else {
        messagesSent.push(message);
      }
    },
  };
}

export class MockFileProvider implements FileProvider {
  files = new Map<string, string>();
  filesWritten: string[] = [];

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.filesWritten.push(path);
  }
}

export class MockBrowserProvider implements BrowserProvider {
  async navigate(_url: string): Promise<void> {}
  async click(_selector: string): Promise<void> {}
  async extract(_selector: string): Promise<string> {
    return "";
  }
  async screenshot(): Promise<Buffer> {
    return Buffer.from("");
  }
}

export class MockLLMProvider implements LLMProvider {
  async chat(_params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }> {
    return { text: "Mock LLM response" };
  }
}

export interface TrackedHandoff {
  to: string;
  reason: string;
  context: Record<string, unknown>;
}

export function createHandoffTracker(): {
  handoffs: TrackedHandoff[];
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
} {
  const handoffs: TrackedHandoff[] = [];
  return {
    handoffs,
    async handoff(agentSlug, payload) {
      handoffs.push({ to: agentSlug, reason: payload.reason, context: payload.context });
    },
  };
}

export function createNotifyTracker(): {
  notifications: Array<string | StructuredNotification>;
  notify: (message: string | StructuredNotification) => Promise<void>;
} {
  const notifications: Array<string | StructuredNotification> = [];
  return {
    notifications,
    async notify(message) {
      notifications.push(message);
    },
  };
}
