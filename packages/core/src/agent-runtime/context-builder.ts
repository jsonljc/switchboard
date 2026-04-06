import type { AgentContext, AgentPersona, StructuredNotification } from "@switchboard/sdk";
import type { HandoffPayload } from "@switchboard/sdk";
import type { LLMAdapter } from "../llm-adapter.js";
import { ActionRequestPipeline } from "./action-request-pipeline.js";
import type { ActionRequestStore } from "./action-request-pipeline.js";
import { StateProvider } from "./state-provider.js";
import type { AgentStateStoreInterface } from "./state-provider.js";
import { CloudChatProvider } from "./chat-provider.js";
import { RuntimeLLMProvider } from "./llm-provider.js";

export interface ContextBuilderConfig {
  deploymentId: string;
  surface: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  persona: AgentPersona;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapter: LLMAdapter;
  onChatExecute: (message: string) => Promise<void> | void;
}

interface BuildOptions {
  conversation?: { id: string; messages: Array<{ role: string; content: string }> };
  handoffPayload?: HandoffPayload;
}

export class ContextBuilder {
  private pipeline: ActionRequestPipeline;

  constructor(private config: ContextBuilderConfig) {
    this.pipeline = new ActionRequestPipeline({
      trustScore: config.trustScore,
      trustLevel: config.trustLevel,
      actionRequestStore: config.actionRequestStore,
    });
  }

  build(options?: BuildOptions): AgentContext {
    const notifications: Array<string | StructuredNotification> = [];
    const handoffs: Array<{ to: string; payload: Omit<HandoffPayload, "fromAgent"> }> = [];

    return {
      state: new StateProvider(this.config.deploymentId, this.config.stateStore),
      chat: new CloudChatProvider({
        deploymentId: this.config.deploymentId,
        surface: this.config.surface,
        pipeline: this.pipeline,
        onExecute: this.config.onChatExecute,
      }),
      files: {
        async read(_path: string) {
          throw new Error("FileProvider not configured — add a file connection");
        },
        async write(_path: string, _content: string) {
          throw new Error("FileProvider not configured — add a file connection");
        },
      },
      browser: {
        async navigate(_url: string) {
          throw new Error("BrowserProvider not configured — add browser capability");
        },
        async click(_selector: string) {
          throw new Error("BrowserProvider not configured");
        },
        async extract(_selector: string): Promise<string> {
          throw new Error("BrowserProvider not configured");
        },
        async screenshot(): Promise<Buffer> {
          throw new Error("BrowserProvider not configured");
        },
      },
      llm: new RuntimeLLMProvider(this.config.llmAdapter),
      notify: async (message) => {
        notifications.push(message);
      },
      handoff: async (agentSlug, payload) => {
        handoffs.push({ to: agentSlug, payload });
      },
      persona: this.config.persona,
      conversation: options?.conversation,
      handoffPayload: options?.handoffPayload,
      trust: {
        score: this.config.trustScore,
        level: this.config.trustLevel,
      },
    };
  }
}
