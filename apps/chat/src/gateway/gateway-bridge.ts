import type { PrismaClient } from "@switchboard/db";
import {
  PrismaDeploymentStateStore,
  PrismaActionRequestStore,
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaKnowledgeStore,
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

  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => {
      const adapter = createAnthropicAdapter();
      const defaultConfig = modelRouter.resolve("default");
      return {
        generateReply: (prompt: ConversationPrompt, overrideConfig?: ModelConfig) =>
          adapter.generateReply(prompt, overrideConfig ?? defaultConfig),
      };
    },
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
  });
}
