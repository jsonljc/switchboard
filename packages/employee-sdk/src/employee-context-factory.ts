import type { AgentContext, CartridgeContext, RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeMemoryContext } from "./types.js";
import type { PersonalityPrompt } from "./compile-personality.js";

// ---------------------------------------------------------------------------
// Service interfaces — injected at registration time (apps layer)
// ---------------------------------------------------------------------------

export interface KnowledgeService {
  search: (query: string, topK?: number) => Promise<Array<{ content: string; similarity: number }>>;
}

export interface BrandMemoryService {
  search: (query: string, topK?: number) => Promise<Array<{ content: string; similarity: number }>>;
}

export interface SkillStoreService {
  getRelevant: (
    taskType: string,
    format?: string,
    topK?: number,
  ) => Promise<Array<{ pattern: string; score: number }>>;
}

export interface PerformanceStoreService {
  getTop: (
    channel: string,
    limit: number,
  ) => Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
}

export interface LLMService {
  generate: (input: {
    system?: string;
    context?: unknown[];
    prompt: string;
    schema?: unknown;
  }) => Promise<{ text: string; parsed?: unknown }>;
}

export interface ActionService {
  propose: (
    type: string,
    params: Record<string, unknown>,
  ) => Promise<import("@switchboard/schemas").ExecuteResult>;
}

export interface SkillLearningService {
  learn: (skill: {
    type: string;
    pattern?: string;
    input?: string;
    feedback?: string;
    evidence?: string[];
    channel?: string;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory configuration
// ---------------------------------------------------------------------------

export interface ContextFactoryServices {
  personality: PersonalityPrompt;
  knowledgeRetriever: KnowledgeService;
  brandMemory: BrandMemoryService;
  skillStore: SkillStoreService;
  performanceStore: PerformanceStoreService;
  llmAdapter: LLMService;
  actionExecutor: ActionService;
  skillLearner: SkillLearningService;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmployeeContextFactory(services: ContextFactoryServices) {
  return {
    fromAgentContext(agentContext: AgentContext, _event: RoutedEventEnvelope): EmployeeContext {
      return buildContext(agentContext.organizationId, agentContext.contactData, services);
    },
    fromCartridgeContext(ctx: CartridgeContext): EmployeeContext {
      return buildContext(ctx.organizationId ?? "", undefined, services);
    },
  };
}

function buildContext(
  organizationId: string,
  contactData: Record<string, unknown> | undefined,
  services: ContextFactoryServices,
): EmployeeContext {
  const memory: EmployeeMemoryContext = {
    brand: { search: services.brandMemory.search },
    skills: { getRelevant: services.skillStore.getRelevant },
    performance: { getTop: services.performanceStore.getTop },
  };

  const emittedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

  return {
    organizationId,
    contactData,
    knowledge: { search: services.knowledgeRetriever.search },
    memory,
    llm: { generate: services.llmAdapter.generate },
    actions: { propose: services.actionExecutor.propose },
    emit: (type, payload) => {
      emittedEvents.push({ type, payload });
    },
    learn: services.skillLearner.learn,
    personality: services.personality,
  };
}
