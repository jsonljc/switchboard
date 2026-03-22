import {
  AgentRegistry,
  AgentRouter,
  AgentStateTracker,
  ConversationRouter,
  ConversionBusBridge,
  CorePolicyEngineAdapter,
  DeadLetterAlerter,
  EventLoop,
  HandlerRegistry,
  ActionExecutor,
  InMemoryDeliveryStore,
  PolicyBridge,
  RetryExecutor,
  ScheduledRunner,
  LeadResponderHandler,
  SalesCloserHandler,
  NurtureAgentHandler,
  AdOptimizerHandler,
  RevenueTrackerHandler,
  LEAD_RESPONDER_PORT,
  SALES_CLOSER_PORT,
  NURTURE_AGENT_PORT,
  AD_OPTIMIZER_PORT,
  REVENUE_TRACKER_PORT,
  type AgentPort,
  type CoreEvaluateFn,
  type DeliveryStore,
  type LeadResponderConversationDeps,
  type LifecycleStage,
  type PolicyEngine,
  type SalesCloserConversationDeps,
  type SalesCloserDeps,
  type NurtureDeps,
  type AdOptimizerDeps,
  type RevenueTrackerDeps,
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
  salesCloserDeps?: SalesCloserDeps;
  nurtureDeps?: NurtureDeps;
  adOptimizerDeps?: AdOptimizerDeps;
  revenueTrackerDeps?: RevenueTrackerDeps;
  leadResponderConversationDeps?: LeadResponderConversationDeps;
  salesCloserConversationDeps?: SalesCloserConversationDeps;
  conversationStore?: {
    getStage(contactId: string): Promise<LifecycleStage | undefined>;
  };
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
  stateTracker: AgentStateTracker;
  scheduledRunner: ScheduledRunner;
  actionExecutor: ActionExecutor;
  conversationRouter?: ConversationRouter;
  threadStore?: ConversationThreadStore;
}

const DEFAULT_LEAD_SCORER = (_params: Record<string, unknown>) => ({
  score: 50,
  tier: "warm" as const,
  factors: [{ factor: "default", contribution: 50 }],
});

export function bootstrapAgentSystem(options: AgentSystemOptions = {}): AgentSystem {
  const log = options.logger ?? CONSOLE_LOGGER;
  const registry = new AgentRegistry();
  const handlerRegistry = new HandlerRegistry();
  const stateTracker = new AgentStateTracker();
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

  // Register all agent handlers
  handlerRegistry.register(
    "lead-responder",
    new LeadResponderHandler({
      scoreLead: DEFAULT_LEAD_SCORER,
      conversation: options.leadResponderConversationDeps,
    }),
  );
  handlerRegistry.register(
    "sales-closer",
    new SalesCloserHandler({
      ...options.salesCloserDeps,
      conversation: options.salesCloserConversationDeps,
      // Closure captures `registry` by reference — safe because agents are registered below
      isAgentActive: options.organizationIds
        ? (_orgId, agentId) => registry.listActive(_orgId).some((a) => a.agentId === agentId)
        : undefined,
    }),
  );
  handlerRegistry.register("nurture", new NurtureAgentHandler(options.nurtureDeps ?? {}));
  handlerRegistry.register("ad-optimizer", new AdOptimizerHandler(options.adOptimizerDeps ?? {}));
  handlerRegistry.register(
    "revenue-tracker",
    new RevenueTrackerHandler(options.revenueTrackerDeps ?? {}),
  );

  const router = new AgentRouter(registry);
  const eventLoop = new EventLoop({
    router,
    registry,
    handlers: handlerRegistry,
    actionExecutor,
    policyBridge,
    deliveryStore,
    stateTracker,
  });

  // Wire ConversationRouter if store provided
  let conversationRouter: ConversationRouter | undefined;
  if (options.conversationStore) {
    conversationRouter = new ConversationRouter({
      getStage: options.conversationStore.getStage,
      threadStore: options.threadStore,
    });
  }

  const maxRetries = options.maxRetries ?? 3;
  let retryExecutor: RetryExecutor | undefined;
  let deadLetterAlerter: DeadLetterAlerter | undefined;

  if (options.retryEnabled !== false) {
    retryExecutor = new RetryExecutor({
      store: deliveryStore,
      retryFn: async (eventId, destinationId) => {
        log.info(`[agent-system] Retrying delivery: ${eventId} -> ${destinationId}`);
        // Event replay requires an event store to look up the original payload.
        // Without one, mark the attempt as failed so it progresses toward dead_letter.
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
        // Route the escalation event through the event loop so agents
        // listening for conversation.escalated (e.g. dashboard inbox) can act on it
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

  // Pre-register agents for known organizations
  if (options.organizationIds) {
    for (const orgId of options.organizationIds) {
      registerAgentsForOrg(registry, orgId);

      // Persist registrations if store provided
      if (options.registryStore) {
        for (const agent of registry.listActive(orgId)) {
          options.registryStore
            .persistRegistration(orgId, {
              agentId: agent.agentId,
              status: "active",
              executionMode: "realtime",
              config: {},
              capabilities: {},
            })
            .catch((err) => {
              log.error(`[agent-system] Failed to persist registration for ${agent.agentId}:`, err);
            });
        }
      }
    }
  }

  // Wire ConversionBusBridge if bus provided
  if (options.conversionBus) {
    const bridge = new ConversionBusBridge({
      onEvent: (envelope) => {
        // Lazy-register agents for orgs not yet registered
        if (registry.listActive(envelope.organizationId).length === 0) {
          registerAgentsForOrg(registry, envelope.organizationId);

          // Persist registrations if store provided
          if (options.registryStore) {
            for (const agent of registry.listActive(envelope.organizationId)) {
              options.registryStore
                .persistRegistration(envelope.organizationId, {
                  agentId: agent.agentId,
                  status: "active",
                  executionMode: "realtime",
                  config: {},
                  capabilities: {},
                })
                .catch((err) => {
                  log.error(
                    `[agent-system] Failed to persist registration for ${agent.agentId}:`,
                    err,
                  );
                });
            }
          }
        }
        const context = { organizationId: envelope.organizationId };

        const processEnvelope = (transformed: typeof envelope) => {
          eventLoop.process(transformed, context).catch((err) => {
            log.error("[agent-system] EventLoop error:", err);
          });
        };

        if (conversationRouter) {
          conversationRouter
            .transform(envelope)
            .then(processEnvelope)
            .catch((err) => {
              log.error("[agent-system] ConversationRouter error:", err);
              processEnvelope(envelope);
            });
        } else {
          processEnvelope(envelope);
        }
      },
    });
    bridge.register(options.conversionBus);
  }

  return {
    registry,
    handlerRegistry,
    eventLoop,
    stateTracker,
    scheduledRunner,
    actionExecutor,
    conversationRouter,
    threadStore: options.threadStore,
  };
}

export function registerAgentsForOrg(
  registry: AgentRegistry,
  organizationId: string,
  purchasedAgents?: string[],
): void {
  const ports: AgentPort[] = [
    LEAD_RESPONDER_PORT,
    SALES_CLOSER_PORT,
    NURTURE_AGENT_PORT,
    AD_OPTIMIZER_PORT,
    REVENUE_TRACKER_PORT,
  ];

  for (const port of ports) {
    const isPurchased =
      !purchasedAgents || purchasedAgents.length === 0 || purchasedAgents.includes(port.agentId);

    registry.register(
      organizationId,
      {
        agentId: port.agentId,
        version: port.version,
        installed: true,
        status: isPurchased ? "active" : "disabled",
        config: {},
        capabilities: {
          accepts: port.inboundEvents,
          emits: port.outboundEvents,
          tools: port.tools.map((t) => t.name),
        },
      },
      { forceOverwrite: true },
    );
  }
}
