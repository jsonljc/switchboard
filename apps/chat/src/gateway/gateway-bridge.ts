import { resolve as pathResolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@switchboard/db";
import {
  PrismaDeploymentStateStore,
  PrismaActionRequestStore,
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaKnowledgeStore,
  PrismaContactStore,
  PrismaOpportunityStore,
  PrismaActivityLogStore,
  PrismaKnowledgeEntryStore,
} from "@switchboard/db";
import { ChannelGateway, ConversationLifecycleTracker, ModelRouter } from "@switchboard/core";
import type { ConversationPrompt, ModelConfig } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import {
  ConversationCompoundingService,
  ContextBuilder,
  KnowledgeRetriever,
  VoyageEmbeddingAdapter,
} from "@switchboard/agents";
import type { EmbeddingAdapter } from "@switchboard/core";
import {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  createCrmQueryTool,
  createCrmWriteTool,
  alexBuilder,
  salesPipelineBuilder,
  websiteProfilerBuilder,
  createWebScannerTool,
  ContextResolverImpl,
} from "@switchboard/core/skill-runtime";
import type { ParameterBuilder, SkillStores } from "@switchboard/core/skill-runtime";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";
import { TaskRecorder } from "./task-recorder.js";

function createEmbeddingAdapter(): EmbeddingAdapter {
  if (process.env.VOYAGE_API_KEY) {
    return new VoyageEmbeddingAdapter({ apiKey: process.env.VOYAGE_API_KEY });
  }
  console.warn(
    "[gateway] VOYAGE_API_KEY not set — using zero-vector stubs (memory dedup and RAG disabled)",
  );
  return {
    embed: async (_text: string) => new Array(1024).fill(0) as number[],
    embedBatch: async (texts: string[]) => texts.map(() => new Array(1024).fill(0) as number[]),
    dimensions: 1024,
  };
}

export function createGatewayBridge(prisma: PrismaClient): ChannelGateway {
  const taskStore = new PrismaAgentTaskStore(prisma);

  const taskRecorder = new TaskRecorder({
    createTask: (input) =>
      taskStore.create({
        deploymentId: input.deploymentId,
        organizationId: input.organizationId ?? "",
        listingId: input.listingId,
        category: input.category,
        input: input.input,
      }),
    submitOutput: (taskId, output) => taskStore.submitOutput(taskId, output),
  });

  // Shared embedding adapter — Voyage in production, zero-vector in dev
  const embeddingAdapter = createEmbeddingAdapter();

  const compoundingService = new ConversationCompoundingService({
    llmClient: {
      complete: async (prompt: string) => {
        const adapter = createAnthropicAdapter();
        const reply = await adapter.generateReply({
          systemPrompt: "You are a fact extraction assistant. Return only valid JSON.",
          conversationHistory: [
            {
              id: "extract-prompt",
              contactId: "",
              direction: "inbound",
              content: prompt,
              timestamp: new Date().toISOString(),
              channel: "dashboard",
            },
          ],
          retrievedContext: [],
          agentInstructions: "",
        });
        return reply.reply;
      },
    },
    embeddingAdapter,
    interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
    deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  });

  const lifecycleTracker = new ConversationLifecycleTracker({
    onConversationEnd: (event) => compoundingService.processConversationEnd(event),
  });

  // Wire KnowledgeRetriever with shared embedding adapter
  const knowledgeStore = new PrismaKnowledgeStore(prisma);
  const knowledgeRetriever = new KnowledgeRetriever({
    embedding: embeddingAdapter,
    store: knowledgeStore,
  });

  const contextBuilder = new ContextBuilder({
    knowledgeRetriever: {
      retrieve: async (query, options) => knowledgeRetriever.retrieve(query, options),
    },
    deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
    interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
  });

  // Model-aware LLM adapter — default slot uses Haiku for cost savings
  const modelRouter = new ModelRouter();

  // Skill runtime dependencies — enables skill-based handlers for deployments with skillSlug
  const contactStore = new PrismaContactStore(prisma);
  const opportunityStore = new PrismaOpportunityStore(prisma);
  const activityStore = new PrismaActivityLogStore(prisma);
  const knowledgeEntryStore = new PrismaKnowledgeEntryStore(prisma);

  const contextResolver = new ContextResolverImpl(knowledgeEntryStore);

  const builderMap = new Map<string, ParameterBuilder>([
    ["sales-pipeline", salesPipelineBuilder],
    ["alex", alexBuilder],
    ["website-profiler", websiteProfilerBuilder],
  ]);

  const skillStores: SkillStores = {
    opportunityStore,
    contactStore,
    activityStore,
  };

  const skillsDir = pathResolve(process.cwd(), "skills");

  const createExecutor = () => {
    const crmQueryTool = createCrmQueryTool(contactStore, activityStore);
    const crmWriteTool = createCrmWriteTool(opportunityStore, activityStore);
    const webScannerTool = createWebScannerTool();

    const toolsMap = new Map([
      [crmQueryTool.id, crmQueryTool],
      [crmWriteTool.id, crmWriteTool],
      [webScannerTool.id, webScannerTool],
    ]);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    return new SkillExecutorImpl(new AnthropicToolCallingAdapter(client), toolsMap, modelRouter);
  };

  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: (slot) => {
      const adapter = createAnthropicAdapter();
      const defaultConfig = modelRouter.resolve(slot ?? "default");
      return {
        generateReply: (prompt: ConversationPrompt, overrideConfig?: ModelConfig) =>
          adapter.generateReply(prompt, overrideConfig ?? defaultConfig),
      };
    },
    modelRouter,
    contextBuilder,
    onMessageRecorded: (info) => {
      taskRecorder.recordMessage(info);
      lifecycleTracker.recordMessage({
        sessionKey: `${info.deploymentId}:${info.channel}:${info.sessionId}`,
        deploymentId: info.deploymentId,
        organizationId: info.organizationId,
        channelType: info.channel,
        sessionId: info.sessionId,
        role: info.role,
        content: info.content,
      });
    },
    skillRuntime: {
      skillsDir,
      loadSkill,
      createExecutor,
      builderMap,
      stores: skillStores,
      hooks: [],
      contextResolver: {
        resolve: contextResolver.resolve.bind(contextResolver),
      },
    },
  });
}
