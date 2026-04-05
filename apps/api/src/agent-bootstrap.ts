import {
  AgentRegistry,
  AgentRouter,
  CorePolicyEngineAdapter,
  DeadLetterAlerter,
  EventLoop,
  HandlerRegistry,
  ActionExecutor,
  InMemoryDeliveryStore,
  PolicyBridge,
  RetryExecutor,
  ScheduledRunner,
  type CoreEvaluateFn,
  type DeliveryStore,
  type PolicyEngine,
} from "@switchboard/agents";
import type { ConversionBus, ConversationThreadStore } from "@switchboard/core";

export interface AgentLogger {
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
  info(msg: string): void;
}

const CONSOLE_LOGGER: AgentLogger = {
  warn: (msg) => console.warn(msg),
  error: (msg, err) => console.error(msg, err),
  info: (msg) => console.warn(msg),
};

export interface AgentSystemOptions {
  conversionBus?: ConversionBus;
  policyEngine?: PolicyEngine;
  coreEvaluateFn?: CoreEvaluateFn;
  organizationId?: string;
  organizationIds?: string[];
  deliveryStore?: DeliveryStore;
  retryEnabled?: boolean;
  maxRetries?: number;
  logger?: AgentLogger;
  registryStore?: {
    persistRegistration(orgId: string, input: Record<string, unknown>): Promise<void>;
    loadAll(orgId: string): Promise<Array<Record<string, unknown>>>;
  };
  /** Thread store for per-contact conversation state. */
  threadStore?: ConversationThreadStore;
}

export interface AgentSystem {
  registry: AgentRegistry;
  handlerRegistry: HandlerRegistry;
  eventLoop: EventLoop;
  scheduledRunner: ScheduledRunner;
  actionExecutor: ActionExecutor;
  policyBridge: PolicyBridge;
  threadStore?: ConversationThreadStore;
}

export function bootstrapAgentSystem(options: AgentSystemOptions = {}): AgentSystem {
  const log = options.logger ?? CONSOLE_LOGGER;
  const registry = new AgentRegistry();
  const handlerRegistry = new HandlerRegistry();
  const deliveryStore = options.deliveryStore ?? new InMemoryDeliveryStore();

  let policyEngine = options.policyEngine ?? null;
  if (!policyEngine && options.coreEvaluateFn && options.organizationId) {
    policyEngine = new CorePolicyEngineAdapter({
      evaluate: options.coreEvaluateFn,
      organizationId: options.organizationId,
    });
  }
  if (!policyEngine) {
    log.warn(
      "[agent-system] No PolicyEngine provided — all agent actions will be auto-approved. " +
        "Wire a PolicyEngine adapter for governance enforcement.",
    );
  }
  const policyBridge = new PolicyBridge(policyEngine);
  const actionExecutor = new ActionExecutor();

  const router = new AgentRouter(registry);
  const eventLoop = new EventLoop({
    router,
    registry,
    handlers: handlerRegistry,
    actionExecutor,
    policyBridge,
    deliveryStore,
  });

  const maxRetries = options.maxRetries ?? 3;
  let retryExecutor: RetryExecutor | undefined;
  let deadLetterAlerter: DeadLetterAlerter | undefined;

  if (options.retryEnabled !== false) {
    retryExecutor = new RetryExecutor({
      store: deliveryStore,
      retryFn: async (eventId, destinationId) => {
        log.info(`[agent-system] Retrying delivery: ${eventId} -> ${destinationId}`);
        log.warn(
          `[agent-system] Cannot replay event ${eventId} — no event store. ` +
            `Delivery will be dead-lettered after ${maxRetries} attempts.`,
        );
        return { success: false };
      },
      maxRetries,
    });

    deadLetterAlerter = new DeadLetterAlerter({
      store: deliveryStore,
      onEscalation: (escalationEvent) => {
        log.warn(
          `[agent-system] Dead letter escalation: ${JSON.stringify(escalationEvent.payload)}`,
        );
        eventLoop
          .process(escalationEvent, {
            organizationId: escalationEvent.organizationId,
          })
          .catch((err) => {
            log.error("[agent-system] Failed to process dead letter escalation:", err);
          });
      },
      maxRetries,
    });
  }

  const scheduledRunner = new ScheduledRunner({
    registry,
    eventLoop,
    retryExecutor,
    deadLetterAlerter,
  });

  return {
    registry,
    handlerRegistry,
    eventLoop,
    scheduledRunner,
    actionExecutor,
    policyBridge,
    threadStore: options.threadStore,
  };
}
