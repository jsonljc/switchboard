import {
  AgentRegistry,
  AgentRouter,
  AgentStateTracker,
  ConversionBusBridge,
  EventLoop,
  HandlerRegistry,
  ActionExecutor,
  InMemoryDeliveryStore,
  PolicyBridge,
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
} from "@switchboard/agents";
import type { ConversionBus } from "@switchboard/core";

export interface AgentSystemOptions {
  conversionBus?: ConversionBus;
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
  const registry = new AgentRegistry();
  const handlerRegistry = new HandlerRegistry();
  const stateTracker = new AgentStateTracker();
  const deliveryStore = new InMemoryDeliveryStore();
  const policyBridge = new PolicyBridge(null);
  const actionExecutor = new ActionExecutor();

  // Register all agent handlers
  handlerRegistry.register(
    "lead-responder",
    new LeadResponderHandler({ scoreLead: DEFAULT_LEAD_SCORER }),
  );
  handlerRegistry.register("sales-closer", new SalesCloserHandler());
  handlerRegistry.register("nurture", new NurtureAgentHandler());
  handlerRegistry.register("ad-optimizer", new AdOptimizerHandler());
  handlerRegistry.register("revenue-tracker", new RevenueTrackerHandler());

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

  const scheduledRunner = new ScheduledRunner({ registry, eventLoop });

  // Wire ConversionBusBridge if bus provided
  if (options.conversionBus) {
    const bridge = new ConversionBusBridge({
      onEvent: (envelope) => {
        const context = { organizationId: envelope.organizationId };
        eventLoop.process(envelope, context).catch((err) => {
          console.error("[agent-system] EventLoop error:", err);
        });
      },
    });
    bridge.register(options.conversionBus);
  }

  return { registry, handlerRegistry, eventLoop, stateTracker, scheduledRunner, actionExecutor };
}

export function registerAgentsForOrg(registry: AgentRegistry, organizationId: string): void {
  const ports: AgentPort[] = [
    LEAD_RESPONDER_PORT,
    SALES_CLOSER_PORT,
    NURTURE_AGENT_PORT,
    AD_OPTIMIZER_PORT,
    REVENUE_TRACKER_PORT,
  ];

  for (const port of ports) {
    registry.register(organizationId, {
      agentId: port.agentId,
      version: port.version,
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: port.inboundEvents,
        emits: port.outboundEvents,
        tools: port.tools.map((t) => t.name),
      },
    });
  }
}
