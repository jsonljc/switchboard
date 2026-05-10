import type { PrismaClient } from "@switchboard/db";
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaContactStore,
  PrismaApprovalStore,
  PrismaHandoffStore,
  PrismaGovernanceVerdictStore,
  PrismaDeploymentStore,
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
import {
  createAgentDeploymentGovernanceResolver,
  InMemoryGovernancePostureCache,
  loadEscalationTriggers,
} from "@switchboard/core/skill-runtime";
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

  // ---------------------------------------------------------------------------
  // Deterministic gate deps (Task 14)
  // Shared GovernancePostureCache so warm hits from the pre-output hook (in the
  // API skill executor) propagate to this pre-input gate on subsequent requests
  // when both servers share state (single-process dev). In production the cache
  // is per-process — acceptable because each process warms independently on first
  // resolve and fails closed from the cache on resolver error.
  // ---------------------------------------------------------------------------
  const deploymentStore = new PrismaDeploymentStore(prisma);
  const gatewayGovernanceResolver = createAgentDeploymentGovernanceResolver(deploymentStore);
  const gatewayGovernanceVerdictStore = new PrismaGovernanceVerdictStore(prisma);
  const gatewayPostureCache = new InMemoryGovernancePostureCache();
  const gatewayHandoffStore = new PrismaHandoffStore(prisma);
  // Adapter: GatewayConversationStatusSetter → direct conversationState updateMany.
  //
  // WHY updateMany (not upsert):
  // ConversationState has required non-nullable fields (channel, principalId,
  // expiresAt) that this gate adapter does not possess.  The ChannelGateway
  // pre-input gate runs before platformIngress.submit, so the only context
  // available is the inbound sessionId and the requested status value.
  //
  // Safety of updateMany here:
  // The ChannelGateway pre-input gate is intentionally positioned to intercept
  // inbound messages from real channel conversations.  Real channel conversations
  // in the chat app go through the chat orchestrator and PrismaConversationStore,
  // which writes the ConversationState row (including channel, principalId,
  // expiresAt) during session initialisation before any message is processed.
  //
  // IMPORTANT CONSTRAINT: ConversationState rows are only created by the chat
  // conversation lifecycle (PrismaConversationStore.save).  In the ChannelGateway
  // flow, the gateway uses ConversationThread (not ConversationState) for message
  // persistence (see PrismaGatewayConversationStore).  If a ConversationState
  // row has not been written yet for this sessionId (e.g. the very first message
  // from a brand-new channel session), the updateMany is a silent no-op.  In that
  // case the block is still fully applied (response replaced, handoff saved,
  // submit skipped) — only the status flip is deferred.  This is acceptable
  // because:
  //   1. The enforcement block (return true / skip submit) is the primary safety
  //      invariant; the status flip is a secondary bookkeeping step.
  //   2. The chat orchestrator will write the ConversationState row shortly after,
  //      at which point the "human_override" status can be set through the chat
  //      layer's own state management if needed.
  //
  // A future 1b-1.5 hardening pass should consider passing channel+principalId
  // into this adapter so a true upsert becomes feasible.
  const gatewayConversationStatusSetter = {
    async setConversationStatus(sessionId: string, status: string): Promise<void> {
      await prisma.conversationState.updateMany({
        where: { threadId: sessionId },
        data: { status },
      });
    },
  };

  // Startup assertion: all six ChannelGateway pre-input gate deps must be present.
  // Missing deps cause silent gate degradation at runtime — fail fast instead.
  const missingGatewayDeps: string[] = [];
  if (!gatewayGovernanceResolver) missingGatewayDeps.push("governanceConfigResolver");
  if (!loadEscalationTriggers) missingGatewayDeps.push("escalationTriggerLoader");
  if (!gatewayGovernanceVerdictStore) missingGatewayDeps.push("verdictStore");
  if (!gatewayPostureCache) missingGatewayDeps.push("postureCache");
  if (!gatewayHandoffStore) missingGatewayDeps.push("handoffStore");
  if (!gatewayConversationStatusSetter) missingGatewayDeps.push("conversationStatusSetter");
  if (missingGatewayDeps.length > 0) {
    throw new Error(
      `ChannelGateway: deterministic gate deps incomplete — missing: ${missingGatewayDeps.join(", ")}`,
    );
  }

  return new ChannelGateway({
    deploymentResolver,
    platformIngress,
    conversationStore: new PrismaGatewayConversationStore(prisma),
    contactStore: new PrismaContactStore(prisma),
    approvalStore: new PrismaApprovalStore(prisma),
    governanceConfigResolver: gatewayGovernanceResolver,
    escalationTriggerLoader: loadEscalationTriggers,
    verdictStore: gatewayGovernanceVerdictStore,
    postureCache: gatewayPostureCache,
    handoffStore: gatewayHandoffStore,
    conversationStatusSetter: gatewayConversationStatusSetter,
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
