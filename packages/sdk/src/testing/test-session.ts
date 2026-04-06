import type { AgentHandler } from "../handler.js";
import type { AgentContext, AgentPersona, StructuredNotification } from "../context.js";
import type { HandoffPayload } from "../handoff.js";
import {
  InMemoryStateStore,
  createGoverningChatProvider,
  MockFileProvider,
  MockBrowserProvider,
  MockLLMProvider,
  createHandoffTracker,
  createNotifyTracker,
} from "./mock-providers.js";
import type { TrackedHandoff, GoverningChatProvider } from "./mock-providers.js";

export interface ChatSessionOptions {
  trustLevel?: "supervised" | "guided" | "autonomous";
}

export class TestChatSession {
  private _state: InMemoryStateStore;
  private _chat: GoverningChatProvider;
  private _files: MockFileProvider;
  private _handoffTracker: {
    handoffs: TrackedHandoff[];
    handoff: (slug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
  };
  private _notifyTracker: {
    notifications: Array<string | StructuredNotification>;
    notify: (msg: string | StructuredNotification) => Promise<void>;
  };
  private _messages: Array<{ role: string; content: string }> = [];
  private _trustLevel: "supervised" | "guided" | "autonomous";

  constructor(
    private handler: AgentHandler,
    private persona: AgentPersona,
    options: ChatSessionOptions = {},
  ) {
    this._trustLevel = options.trustLevel ?? "autonomous";
    this._state = new InMemoryStateStore();
    this._chat = createGoverningChatProvider(this._trustLevel);
    this._files = new MockFileProvider();
    this._handoffTracker = createHandoffTracker();
    this._notifyTracker = createNotifyTracker();
  }

  async userSays(message: string): Promise<void> {
    this._messages.push({ role: "user", content: message });
    const ctx = this.buildContext();
    if (this.handler.onMessage) {
      await this.handler.onMessage(ctx);
    }
  }

  get lastResponse(): string | undefined {
    if (this._trustLevel === "supervised") {
      const last = this._chat.pendingApprovals.at(-1);
      return last?.content;
    }
    return this._chat.messagesSent.at(-1);
  }

  get messagesSent(): string[] {
    return this._chat.messagesSent;
  }

  get pendingApprovals(): Array<{ type: string; content: string }> {
    return this._chat.pendingApprovals;
  }

  get handoffs(): TrackedHandoff[] {
    return this._handoffTracker.handoffs;
  }

  get notifications(): Array<string | StructuredNotification> {
    return this._notifyTracker.notifications;
  }

  get state(): InMemoryStateStore {
    return this._state;
  }

  get filesWritten(): string[] {
    return this._files.filesWritten;
  }

  private buildContext(): AgentContext {
    return {
      state: this._state,
      chat: this._chat,
      files: this._files,
      browser: new MockBrowserProvider(),
      llm: new MockLLMProvider(),
      notify: this._notifyTracker.notify,
      handoff: this._handoffTracker.handoff,
      persona: this.persona,
      conversation: { id: "test-conversation", messages: [...this._messages] },
      trust: {
        score: this._trustLevel === "supervised" ? 0 : this._trustLevel === "guided" ? 40 : 80,
        level: this._trustLevel,
      },
    };
  }
}
