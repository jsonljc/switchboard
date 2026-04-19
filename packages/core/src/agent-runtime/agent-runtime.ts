import type { AgentHandler, AgentPersona } from "@switchboard/sdk";
import type { HandoffPayload } from "@switchboard/sdk";
import type { AgentTask } from "@switchboard/schemas";
import type { LLMAdapter } from "../llm-adapter.js";
import { ContextBuilder } from "./context-builder.js";
import type { ActionRequestStore } from "./action-request-pipeline.js";
import type { AgentStateStoreInterface } from "./state-provider.js";

export interface AgentRuntimeConfig {
  handler: AgentHandler;
  deploymentId: string;
  surface: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  persona: AgentPersona;
  deploymentInputConfig?: Record<string, unknown>;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapter: LLMAdapter;
  onChatExecute: (message: string, metadata?: { threadId?: string }) => Promise<void> | void;
}

export interface MessageEvent {
  conversationId: string;
  messages: Array<{ role: string; content: string }>;
}

export class AgentRuntime {
  private contextBuilder: ContextBuilder;

  constructor(private config: AgentRuntimeConfig) {
    this.contextBuilder = new ContextBuilder({
      deploymentId: config.deploymentId,
      surface: config.surface,
      trustScore: config.trustScore,
      trustLevel: config.trustLevel,
      persona: config.persona,
      deploymentInputConfig: config.deploymentInputConfig,
      stateStore: config.stateStore,
      actionRequestStore: config.actionRequestStore,
      llmAdapter: config.llmAdapter,
      onChatExecute: config.onChatExecute,
    });
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.config.handler.onMessage) {
      throw new Error("Agent does not implement onMessage");
    }

    const { ctx } = this.contextBuilder.build({
      conversation: {
        id: event.conversationId,
        messages: event.messages,
      },
    });

    await this.config.handler.onMessage(ctx);
  }

  async handleHandoff(payload: HandoffPayload): Promise<void> {
    if (!this.config.handler.onHandoff) {
      throw new Error("Agent does not implement onHandoff");
    }

    const { ctx } = this.contextBuilder.build({
      handoffPayload: {
        fromAgent: payload.fromAgent,
        reason: payload.reason,
        context: payload.context,
      },
    });

    await this.config.handler.onHandoff(ctx);
  }

  async handleSchedule(): Promise<void> {
    if (!this.config.handler.onSchedule) {
      throw new Error("Agent does not implement onSchedule");
    }

    const { ctx } = this.contextBuilder.build();
    await this.config.handler.onSchedule(ctx);
  }

  async handleTask(task: AgentTask): Promise<void> {
    if (!this.config.handler.onTask) {
      throw new Error("Agent does not implement onTask");
    }

    const { ctx } = this.contextBuilder.build({ task });
    await this.config.handler.onTask(ctx);
  }

  async handleSetup(): Promise<void> {
    if (!this.config.handler.onSetup) {
      throw new Error("Agent does not implement onSetup");
    }

    const { ctx } = this.contextBuilder.build();
    await this.config.handler.onSetup(ctx);
  }
}
