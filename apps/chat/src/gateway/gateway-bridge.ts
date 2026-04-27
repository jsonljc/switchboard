import type { PrismaClient } from "@switchboard/db";
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaContactStore,
} from "@switchboard/db";
import { ChannelGateway, ConversationLifecycleTracker } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import {
  ConversationCompoundingService,
  VoyageEmbeddingAdapter,
  DisabledEmbeddingAdapter,
} from "@switchboard/core";
import type { EmbeddingAdapter } from "@switchboard/core";
import { PrismaDeploymentResolver } from "@switchboard/core/platform";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { SubmitWorkRequest } from "@switchboard/core/platform";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";
import { TaskRecorder } from "./task-recorder.js";

function createEmbeddingAdapter(): EmbeddingAdapter {
  if (process.env.VOYAGE_API_KEY) {
    return new VoyageEmbeddingAdapter({ apiKey: process.env.VOYAGE_API_KEY });
  }
  console.warn("[gateway] VOYAGE_API_KEY not set — semantic search and memory dedup disabled");
  return new DisabledEmbeddingAdapter();
}

export interface GatewayBridgeOptions {
  /** Platform ingress for converged execution path. Required for message handling. */
  platformIngress?: { submit(request: SubmitWorkRequest): Promise<SubmitWorkResponse> };
}

export function createGatewayBridge(
  prisma: PrismaClient,
  options: GatewayBridgeOptions = {},
): ChannelGateway {
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

  // Converged execution path
  const deploymentResolver = new PrismaDeploymentResolver(prisma as never);

  if (!options.platformIngress) {
    throw new Error("PlatformIngress is required — wire it in chat app main.ts");
  }
  const platformIngress = options.platformIngress;

  return new ChannelGateway({
    deploymentResolver,
    platformIngress,
    conversationStore: new PrismaGatewayConversationStore(prisma),
    contactStore: new PrismaContactStore(prisma),
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
