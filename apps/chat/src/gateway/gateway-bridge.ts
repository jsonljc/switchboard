import type { PrismaClient } from "@switchboard/db";
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaDeploymentMemoryEvidenceStore,
  PrismaKnowledgeStore,
  PrismaContactStore,
  PrismaApprovalStore,
  PrismaHandoffStore,
  PrismaGovernanceVerdictStore,
  PrismaDeploymentStore,
  PrismaBookingAttributionStore,
  createPrismaConsentStore,
} from "@switchboard/db";
import {
  ChannelGateway,
  ConversationLifecycleTracker,
  createConsentService,
  loadRevocationKeywords,
} from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import {
  ConversationCompoundingService,
  VoyageEmbeddingAdapter,
  DisabledEmbeddingAdapter,
} from "@switchboard/core";
import type { ConversationStatusUpsertContext, EmbeddingAdapter } from "@switchboard/core";
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
    knowledgeStore: new PrismaKnowledgeStore(prisma),
    // Booking-backed outcome attribution. Without this, the compounding
    // service falls back to "none" tier and skips pattern extraction entirely
    // — even when summarization labels the outcome "booked". Strong tier
    // (PR-3.1.b) matches Booking.workTraceId against the workTraceIds
    // threaded through onMessageRecorded below; fallback tier matches on
    // contact+window.
    bookingStore: new PrismaBookingAttributionStore(prisma),
    // PR-3.2a: every booking-attributed pattern write records a
    // DeploymentMemoryEvidence row anchored on (deploymentMemoryId, bookingId).
    // countDistinctBookingIds() over that table is the source of truth for the
    // PR-3.2e multi-booking surfacing rule.
    evidenceStore: new PrismaDeploymentMemoryEvidenceStore(prisma),
    agentId: "alex",
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
  // Adapter: GatewayConversationStatusSetter → upsert when context available,
  // update-only fallback otherwise.
  //
  // When upsertContext is provided (gateway path, which has channel+principalId
  // in scope), perform a true upsert: create the ConversationState row if it
  // does not yet exist so that brand-new sessions (first-message path) get the
  // human_override status immediately. This closes the silent no-op window that
  // existed when only updateMany was used.
  //
  // When upsertContext is omitted (api-side hook path), fall back to updateMany
  // because the row is guaranteed to exist before skill execution (the chat
  // lifecycle PrismaConversationStore.save writes it first).
  //
  // expiresAt for upserted rows: 30 days from now, matching the outer
  // conversation TTL convention. The exact value is not meaningful here —
  // the row exists only to carry human_override status until the human
  // operator clears it.
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const gatewayConversationStatusSetter = {
    async setConversationStatus(
      sessionId: string,
      status: string,
      upsertContext?: ConversationStatusUpsertContext,
    ): Promise<void> {
      if (upsertContext) {
        await prisma.conversationState.upsert({
          where: { threadId: sessionId },
          update: { status },
          create: {
            threadId: sessionId,
            channel: upsertContext.channel,
            principalId: upsertContext.principalId,
            status,
            expiresAt: new Date(Date.now() + thirtyDaysMs),
          },
        });
        return;
      }
      // Fallback: update-only (used by the api-side hook adapter where the
      // ConversationState row is presumed to exist downstream of conversation
      // lifecycle code).
      await prisma.conversationState.updateMany({
        where: { threadId: sessionId },
        data: { status },
      });
    },
  };

  // ---------------------------------------------------------------------------
  // Phase 1c — consent revocation gate deps.
  // Chat process is separate from the API process; can't share runtime instances.
  // Each process has its own in-memory cache; acceptable because each process
  // warms independently on first resolve.
  //
  // ConsentService construction-time binding to deploymentId/orgId/clinicType
  // is a v1 limitation — see Phase 2 follow-up doc.
  // ---------------------------------------------------------------------------
  const gatewayConsentStore = createPrismaConsentStore({ prisma });
  const gatewayConsentPostureCache = new InMemoryGovernancePostureCache();
  const gatewaySessionContactResolver = async (sessionId: string): Promise<string | null> => {
    const thread = await prisma.conversationThread.findFirst({
      where: { id: sessionId },
      select: { contactId: true },
    });
    return thread?.contactId ?? null;
  };
  const gatewayConsentService = createConsentService({
    store: gatewayConsentStore,
    verdictStore: gatewayGovernanceVerdictStore,
    handoffStore: gatewayHandoffStore,
    conversationStore: gatewayConversationStatusSetter,
    clock: () => new Date(),
    deploymentId: "system:consent-service",
    orgId: "system",
    clinicType: "medical",
  });

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
    consentRevocationGate: {
      governanceConfigResolver: gatewayGovernanceResolver,
      consentService: gatewayConsentService,
      postureCache: gatewayConsentPostureCache,
      revocationKeywordLoader: loadRevocationKeywords,
      sessionContactResolver: gatewaySessionContactResolver,
      verdictStore: gatewayGovernanceVerdictStore,
      clock: () => new Date(),
    },
    consentEnforcementGate: {
      governanceConfigResolver: gatewayGovernanceResolver,
      consentStore: gatewayConsentStore,
      postureCache: gatewayConsentPostureCache,
      sessionContactResolver: gatewaySessionContactResolver,
      verdictStore: gatewayGovernanceVerdictStore,
      clock: () => new Date(),
    },
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
        workTraceId: info.workTraceId,
      });
    },
  });
}
