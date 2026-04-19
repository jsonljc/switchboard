import type { AgentTask, AgentPersona } from "@switchboard/schemas";
import type { HandoffPayload } from "./handoff.js";

// Re-export AgentPersona so SDK consumers don't need to import schemas directly
export type { AgentPersona } from "@switchboard/schemas";

export interface StateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  delete(key: string): Promise<void>;
}

export interface ChatProvider {
  send(message: string): Promise<void>;
  sendToThread(threadId: string, message: string): Promise<void>;
}

export interface FileProvider {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface BrowserProvider {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  extract(selector: string): Promise<string>;
  screenshot(): Promise<Buffer>;
}

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string }>;
}

export interface StructuredNotification {
  title: string;
  body: string;
  severity?: "info" | "warning" | "critical";
  data?: Record<string, unknown>;
}

export interface AgentContext {
  state: StateStore;
  chat: ChatProvider;
  files: FileProvider;
  browser: BrowserProvider;
  llm: LLMProvider;

  notify: (message: string | StructuredNotification) => Promise<void>;
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;

  persona: AgentPersona;
  conversation?: { id: string; messages: Array<{ role: string; content: string }> };
  task?: AgentTask;
  handoffPayload?: HandoffPayload;
  trust: { score: number; level: "supervised" | "guided" | "autonomous" };
  deployment?: { inputConfig?: Record<string, unknown> };
}
