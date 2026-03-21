import {
  AgentRegistry,
  AgentRouter,
  AgentStateTracker,
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
  type PolicyEngine,
  type SalesCloserDeps,
  type NurtureDeps,
  type AdOptimizerDeps,
  type RevenueTrackerDeps,
} from "@switchboard/agents";
import type { ConversionBus } from "@switchboard/core";

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
}

export interface AgentSystem {
  registry: AgentRegistry;
  handlerRegistry: HandlerRegistry;
  eventLoop: EventLoop;
  stateTracker: AgentStateTracker;
  scheduledRunner: ScheduledRunner;
  actionExecutor: ActionExecutor;
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
    new LeadResponderHandler({ scoreLead: DEFAULT_LEAD_SCORER }),
  );
  handlerRegistry.register("sales-closer", new SalesCloserHandler(options.salesCloserDeps ?? {}));
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

  const maxRetries = options.maxRetries ?? 3;
  let retryExecutor: RetryExecutor | undefined;
  let deadLetterAlerter: DeadLetterAlerter | undefined;

  if (options.retryEnabled !== false) {
    retryExecutor = new RetryExecutor({
      store: deliveryStore,
      retryFn: async (eventId, destinationId) => {
        log.info(`[agent-system] Retrying delivery: ${eventId} -> ${destinationId}`);
        return { success: true }; // TODO: wire to actual re-dispatch in Phase 2
      },
      maxRetries,
    });

    deadLetterAlerter = new DeadLetterAlerter({
      store: deliveryStore,
      onEscalation: (event) => {
        log.warn(`[agent-system] Dead letter escalation: ${JSON.stringify(event.payload)}`);
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
    }
  }

  // Wire ConversionBusBridge if bus provided
  if (options.conversionBus) {
    const bridge = new ConversionBusBridge({
      onEvent: (envelope) => {
        // Lazy-register agents for orgs not yet registered
        if (registry.listActive(envelope.organizationId).length === 0) {
          registerAgentsForOrg(registry, envelope.organizationId);
        }
        const context = { organizationId: envelope.organizationId };
        eventLoop.process(envelope, context).catch((err) => {
          log.error("[agent-system] EventLoop error:", err);
        });
      },
    });
    bridge.register(options.conversionBus);
  }

  return { registry, handlerRegistry, eventLoop, stateTracker, scheduledRunner, actionExecutor };
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
