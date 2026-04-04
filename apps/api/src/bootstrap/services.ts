// ---------------------------------------------------------------------------
// Services Bootstrap — builds all core services (agents, orchestrator, etc.)
// ---------------------------------------------------------------------------
// Extracts the services initialization from app.ts to keep it under 400 lines.
// Returns all service instances needed for Fastify decoration and cleanup.
// ---------------------------------------------------------------------------

import type { FastifyBaseLogger } from "fastify";
import type { Queue, Worker } from "bullmq";
import {
  LifecycleOrchestrator,
  ExecutionService,
  CompositeNotifier,
  InMemoryConversionBus,
} from "@switchboard/core";
import type {
  StorageContext,
  AuditLedger,
  GuardrailState,
  GuardrailStateStore,
  PolicyCache,
  GovernanceProfileStore,
  ApprovalNotifier,
  ConversionBus,
} from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import { PrismaOperatorCommandStore } from "@switchboard/db";
import type { MetaAdsWriteProvider } from "@switchboard/digital-ads";
import { createExecutionQueue, createExecutionWorker } from "../queue/index.js";
import { wireConversionBus } from "./conversion-bus-bootstrap.js";
import { buildOperatorDeps } from "./operator-deps.js";
import type { OperatorDeps } from "./operator-deps.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { SchedulerDeps } from "./scheduler-deps.js";
import type { LifecycleDeps } from "./lifecycle-deps.js";
import type { AgentSystem } from "../agent-bootstrap.js";
import type { ConversationDeps } from "./conversation-deps.js";

export interface ServicesBootstrapInput {
  storage: StorageContext;
  ledger: AuditLedger;
  guardrailState: GuardrailState;
  guardrailStateStore: GuardrailStateStore;
  policyCache: PolicyCache;
  governanceProfileStore: GovernanceProfileStore;
  prismaClient: PrismaClient | null;
  logger: FastifyBaseLogger;
  adsWriteProvider: MetaAdsWriteProvider | null;
}

export interface ServicesBootstrapResult {
  orchestrator: LifecycleOrchestrator;
  executionService: ExecutionService;
  agentSystem: AgentSystem;
  conversionBus: ConversionBus;
  sessionManager: import("@switchboard/core/sessions").SessionManager | null;
  workflowDeps: WorkflowDeps | null;
  schedulerDeps: SchedulerDeps | null;
  operatorDeps: OperatorDeps | null;
  lifecycleDeps: LifecycleDeps | null;
  approvalNotifier: ApprovalNotifier | undefined;
  ingestionPipeline: import("@switchboard/agents").IngestionPipeline | null;
  queue: Queue | null;
  worker: Worker | null;
}

export async function bootstrapServices(
  input: ServicesBootstrapInput,
): Promise<ServicesBootstrapResult> {
  const {
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    prismaClient,
    logger,
    adsWriteProvider,
  } = input;

  // --- ConversionBus wiring (CRM → ads feedback loop) ---
  const conversionBus = new InMemoryConversionBus();
  await wireConversionBus({
    conversionBus,
    adsWriteProvider,
    prismaClient,
    logger,
  });

  // --- Agent orchestration system ---
  const { bootstrapAgentSystem } = await import("../agent-bootstrap.js");

  let deliveryStore: import("@switchboard/agents").DeliveryStore | undefined;
  if (prismaClient) {
    const { PrismaDeliveryStore } = await import("@switchboard/db");
    deliveryStore = new PrismaDeliveryStore(prismaClient);
  }

  // --- Thread store for per-contact derived state ---
  let threadStore: import("@switchboard/core").ConversationThreadStore | undefined;
  if (prismaClient) {
    const { PrismaConversationThreadStore } = await import("@switchboard/db");
    threadStore = new PrismaConversationThreadStore(prismaClient);
  }

  // --- Conversation deps (LLM + knowledge for agent handlers) ---
  let conversationDeps: ConversationDeps | null = null;
  let knowledgeStore: import("@switchboard/core").KnowledgeStore | null = null;
  if (prismaClient && process.env["ANTHROPIC_API_KEY"]) {
    const { buildConversationDeps } = await import("./conversation-deps.js");
    const { PrismaConversationStore, PrismaKnowledgeStore } = await import("@switchboard/db");
    knowledgeStore = new PrismaKnowledgeStore(prismaClient);
    conversationDeps = buildConversationDeps({
      anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
      voyageApiKey: process.env["VOYAGE_API_KEY"],
      conversationStore: new PrismaConversationStore(prismaClient, "default"),
      knowledgeStore,
    });
    if (conversationDeps) {
      logger.info("Conversation deps wired (LLM + knowledge retriever)");
    }
  }

  // Build ingestion pipeline — reuses embedding adapter and knowledge store from conversation deps
  let ingestionPipeline: import("@switchboard/agents").IngestionPipeline | null = null;
  if (conversationDeps && knowledgeStore) {
    const { IngestionPipeline } = await import("@switchboard/agents");

    ingestionPipeline = new IngestionPipeline({
      store: knowledgeStore,
      embedding: conversationDeps.embeddingAdapter,
    });
  }

  const agentSystem = bootstrapAgentSystem({
    conversionBus,
    deliveryStore,
    leadResponderConversationDeps: conversationDeps ?? undefined,
    salesCloserConversationDeps: conversationDeps ?? undefined,
    conversationStore: conversationDeps?.conversationStore
      ? {
          getStage: conversationDeps.conversationStore.getStage.bind(
            conversationDeps.conversationStore,
          ),
        }
      : undefined,
    threadStore,
    logger: {
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string, err?: unknown) => logger.error({ err }, msg),
      info: (msg: string) => logger.info(msg),
    },
  });
  logger.info(`Agent system bootstrapped (delivery: ${deliveryStore ? "prisma" : "in-memory"})`);

  // --- Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET) ---
  let sessionManager: import("@switchboard/core/sessions").SessionManager | null = null;
  if (prismaClient) {
    const { bootstrapSessionRuntime } = await import("./session-bootstrap.js");
    const sessionResult = await bootstrapSessionRuntime(prismaClient, logger);
    sessionManager = sessionResult?.sessionManager ?? null;
  }

  // --- Workflow engine bootstrap (optional — requires DATABASE_URL) ---
  let workflowDeps: WorkflowDeps | null = null;
  if (prismaClient) {
    const { buildWorkflowDeps } = await import("./workflow-deps.js");
    const stepPolicyBridge: import("@switchboard/core").StepExecutorPolicyBridge = {
      evaluate: async (intent: {
        eventId: string;
        destinationType: string;
        destinationId: string;
        action: string;
        payload: unknown;
        criticality: string;
      }) => {
        // Cast to DeliveryIntent — StepExecutorPolicyBridge uses loose types for structural typing
        const deliveryIntent: import("@switchboard/agents").DeliveryIntent = {
          ...intent,
          destinationType: intent.destinationType as never,
          criticality: intent.criticality as never,
        };
        const result = await agentSystem.policyBridge.evaluate(deliveryIntent);
        return {
          approved: result.approved,
          requiresApproval: result.requiresApproval ?? false,
          reason: result.reason,
        };
      },
    };
    workflowDeps = buildWorkflowDeps(prismaClient, agentSystem.actionExecutor, stepPolicyBridge);
    if (workflowDeps) {
      logger.info("Workflow engine bootstrapped");
    }
  }

  // --- Execution queue setup ---
  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let onEnqueue: ((envelopeId: string) => Promise<void>) | undefined;
  const redisUrl = process.env["REDIS_URL"];
  const executionMode = redisUrl ? ("queue" as const) : ("inline" as const);

  if (redisUrl) {
    const connection = { url: redisUrl };
    queue = createExecutionQueue(connection);
    onEnqueue = async (envelopeId: string) => {
      await queue!.add(`execute:${envelopeId}`, {
        envelopeId,
        enqueuedAt: new Date().toISOString(),
      });
    };
  }

  // --- Scheduler service bootstrap (optional — requires DATABASE_URL + REDIS_URL + workflow engine) ---
  let schedulerDeps: SchedulerDeps | null = null;
  if (prismaClient && redisUrl && workflowDeps) {
    const { buildSchedulerDeps } = await import("./scheduler-deps.js");
    schedulerDeps = buildSchedulerDeps(prismaClient, redisUrl, workflowDeps.workflowEngine);
    logger.info("Scheduler service bootstrapped");
  }

  // Wire scheduler into EventLoop (EventLoop is created before schedulerDeps)
  if (schedulerDeps) {
    agentSystem.eventLoop.setScheduler(schedulerDeps.service, async (trigger) => {
      await schedulerDeps!.triggerHandler({
        data: {
          triggerId: trigger.id,
          organizationId: trigger.organizationId,
          action: trigger.action,
        },
      });
    });
  }

  // --- Operator deps — requires Prisma ---
  let operatorDeps: OperatorDeps | null = null;
  if (prismaClient) {
    try {
      const commandStore = new PrismaOperatorCommandStore(prismaClient);
      operatorDeps = buildOperatorDeps({ commandStore });
      logger.info("[boot] Operator command system wired");
    } catch (err) {
      logger.warn({ err }, "[boot] Operator deps unavailable — operator routes disabled");
    }
  }

  // --- Lifecycle deps (contact lifecycle + fallback handler) ---
  let lifecycleDeps: LifecycleDeps | null = null;
  if (prismaClient) {
    const { buildLifecycleDeps } = await import("./lifecycle-deps.js");
    lifecycleDeps = buildLifecycleDeps(prismaClient);
    if (lifecycleDeps) {
      logger.info("[boot] Contact lifecycle system wired");
    }
  }

  // --- Approval notifier wiring ---
  const approvalNotifiers: ApprovalNotifier[] = [];
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    const { TelegramApprovalNotifier } = await import("../notifications/telegram-notifier.js");
    approvalNotifiers.push(new TelegramApprovalNotifier(process.env["TELEGRAM_BOT_TOKEN"]));
  }
  if (process.env["SLACK_BOT_TOKEN"]) {
    const { SlackApprovalNotifier } = await import("../notifications/slack-notifier.js");
    approvalNotifiers.push(new SlackApprovalNotifier(process.env["SLACK_BOT_TOKEN"]));
  }
  if (process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]) {
    const { WhatsAppApprovalNotifier } = await import("../notifications/whatsapp-notifier.js");
    approvalNotifiers.push(
      new WhatsAppApprovalNotifier({
        token: process.env["WHATSAPP_TOKEN"],
        phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
      }),
    );
  }
  const approvalNotifier: ApprovalNotifier | undefined =
    approvalNotifiers.length > 1
      ? new CompositeNotifier(approvalNotifiers)
      : approvalNotifiers.length === 1
        ? approvalNotifiers[0]
        : undefined;

  if (!approvalNotifier) {
    logger.warn(
      "[boot] No approval notifiers configured — operators will not be notified of pending approvals. Set TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, or WHATSAPP_TOKEN to enable.",
    );
  }

  // --- Build orchestrator ---
  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    executionMode,
    onEnqueue,
    approvalNotifier,
    credentialResolver: prismaClient
      ? await (async () => {
          const { PrismaCredentialResolver, PrismaConnectionStore } =
            await import("@switchboard/db");
          return new PrismaCredentialResolver(new PrismaConnectionStore(prismaClient));
        })()
      : undefined,
  });

  // Start worker in-process when queue mode is active
  if (redisUrl) {
    worker = createExecutionWorker({
      connection: { url: redisUrl },
      orchestrator,
      storage,
      logger,
    });
  }

  const executionService = new ExecutionService(orchestrator, storage);

  return {
    orchestrator,
    executionService,
    agentSystem,
    conversionBus,
    sessionManager,
    workflowDeps,
    schedulerDeps,
    operatorDeps,
    lifecycleDeps,
    approvalNotifier,
    ingestionPipeline,
    queue,
    worker,
  };
}
