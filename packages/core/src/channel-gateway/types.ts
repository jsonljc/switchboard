import type { AgentPersona } from "@switchboard/sdk";
import type { AgentStateStoreInterface } from "../agent-runtime/state-provider.js";
import type { ActionRequestStore } from "../agent-runtime/action-request-pipeline.js";
import type { LLMAdapter } from "../llm-adapter.js";

export interface ChannelGatewayConfig {
  deploymentLookup: DeploymentLookup;
  conversationStore: GatewayConversationStore;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapterFactory: () => LLMAdapter;
  /** Called after each message is persisted. Used by TaskRecorder. */
  onMessageRecorded?: (info: {
    deploymentId: string;
    listingId: string;
    channel: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
  }) => void;
}

export interface DeploymentLookup {
  findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null>;
}

export interface DeploymentInfo {
  deployment: { id: string; listingId: string };
  persona: AgentPersona;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export interface GatewayConversationStore {
  getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  addMessage(conversationId: string, role: string, content: string): Promise<void>;
}

export interface IncomingChannelMessage {
  channel: string;
  token: string;
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string };
}

export interface ReplySink {
  send(text: string): Promise<void>;
  onToken?(chunk: string): void;
  onTyping?(): void;
}

export class UnknownChannelError extends Error {
  constructor(channel: string, token: string) {
    super(`No deployment found for channel=${channel} token=${token.slice(0, 6)}...`);
    this.name = "UnknownChannelError";
  }
}

export class InactiveDeploymentError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} is not active`);
    this.name = "InactiveDeploymentError";
  }
}
