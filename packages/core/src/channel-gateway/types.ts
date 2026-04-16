import type { AgentPersona } from "@switchboard/sdk";
import type { AgentStateStoreInterface } from "../agent-runtime/state-provider.js";
import type { ActionRequestStore } from "../agent-runtime/action-request-pipeline.js";
import type { LLMAdapter } from "../llm-adapter.js";
import type { ModelRouter, ModelSlot } from "../model-router.js";
import type {
  SkillDefinition,
  SkillExecutor,
  SkillExecutionTrace,
} from "../skill-runtime/types.js";
import type { ParameterBuilder, SkillStores } from "../skill-runtime/parameter-builder.js";
import type { CircuitBreaker } from "../skill-runtime/circuit-breaker.js";
import type { BlastRadiusLimiter } from "../skill-runtime/blast-radius-limiter.js";
import type { OutcomeLinker } from "../skill-runtime/outcome-linker.js";
import type { ContextResolverImpl } from "../skill-runtime/context-resolver.js";

export interface SkillRuntimeDeps {
  /** Directory containing .md skill files */
  skillsDir: string;
  /** Load a skill definition by slug from disk */
  loadSkill: (slug: string, skillsDir: string) => SkillDefinition;
  /** Factory to create a SkillExecutor (adapter + tools wired) */
  createExecutor: () => SkillExecutor;
  /** Map of parameter builders registered for skill parameter resolution */
  builderMap: Map<string, ParameterBuilder>;
  /** Stores required by parameter builders (deployments, listings, tasks, contacts, etc.) */
  stores: SkillStores;
  /** Trace store for recording skill execution traces */
  traceStore: { create(trace: SkillExecutionTrace): Promise<void> };
  /** Circuit breaker for skill-level failure management */
  circuitBreaker: CircuitBreaker;
  /** Blast radius limiter for per-deployment execution constraints */
  blastRadiusLimiter: BlastRadiusLimiter;
  /** Outcome linker for chaining skill outputs */
  outcomeLinker: OutcomeLinker;
  /** Context resolver for knowledge entry resolution */
  contextResolver: { resolve: ContextResolverImpl["resolve"] };
}

export interface ChannelGatewayConfig {
  deploymentLookup: DeploymentLookup;
  conversationStore: GatewayConversationStore;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapterFactory: (slot?: ModelSlot) => LLMAdapter;
  /** Optional model router for per-message cost-optimized tier selection. */
  modelRouter?: ModelRouter;
  /** Builds knowledge context for agent responses. Optional — graceful degradation if not set. */
  contextBuilder?: {
    build(input: {
      organizationId: string;
      agentId: string;
      deploymentId: string;
      query: string;
      contactId?: string;
    }): Promise<{
      retrievedChunks: Array<{ content: string; sourceType: string }>;
      learnedFacts: Array<{ content: string; category: string }>;
      recentSummaries: Array<{ summary: string; outcome: string }>;
    }>;
  };
  /** Called after each message is persisted. MUST be synchronous — async callbacks are not awaited. */
  onMessageRecorded?: (info: {
    deploymentId: string;
    listingId: string;
    organizationId: string;
    channel: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
  }) => void;
  /** Optional skill runtime deps — when provided, deployments with skillSlug use skill-based handlers. */
  skillRuntime?: SkillRuntimeDeps;
}

export interface DeploymentLookup {
  findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null>;
}

export interface DeploymentInfo {
  deployment: { id: string; listingId: string; organizationId: string; skillSlug?: string | null };
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
