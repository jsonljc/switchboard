// ---------------------------------------------------------------------------
// Event Loop — chains agents by feeding output events back through the router
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { AgentContext, AgentResponse } from "./ports.js";
import type { AgentRouter } from "./router.js";
import type { AgentRegistry } from "./registry.js";
import type { PolicyBridge } from "./policy-bridge.js";
import type { DeliveryStore } from "./delivery-store.js";
import type { AgentStateTracker } from "./agent-state.js";
import type { HandlerRegistry } from "./handler-registry.js";
import type { ActionExecutor } from "./action-executor.js";

const URGENT_EVENT_TYPES = ["ad.anomaly_detected", "ad.performance_review"];

export interface EventLoopConfig {
  router: AgentRouter;
  registry: AgentRegistry;
  handlers: HandlerRegistry;
  actionExecutor: ActionExecutor;
  policyBridge: PolicyBridge;
  deliveryStore: DeliveryStore;
  stateTracker?: AgentStateTracker;
  maxDepth?: number;
}

export interface ProcessedAgent {
  eventId: string;
  eventType: string;
  agentId: string;
  success: boolean;
  outputEvents: string[];
  actionsExecuted: string[];
  error?: string;
}

export interface EventLoopResult {
  processed: ProcessedAgent[];
  depth: number;
}

export class EventLoop {
  private router: AgentRouter;
  private registry: AgentRegistry;
  private handlers: HandlerRegistry;
  private actionExecutor: ActionExecutor;
  private policyBridge: PolicyBridge;
  private deliveryStore: DeliveryStore;
  private stateTracker?: AgentStateTracker;
  private maxDepth: number;

  constructor(config: EventLoopConfig) {
    this.router = config.router;
    this.registry = config.registry;
    this.handlers = config.handlers;
    this.actionExecutor = config.actionExecutor;
    this.policyBridge = config.policyBridge;
    this.deliveryStore = config.deliveryStore;
    this.stateTracker = config.stateTracker;
    this.maxDepth = config.maxDepth ?? 10;
  }

  async process(event: RoutedEventEnvelope, context: AgentContext): Promise<EventLoopResult> {
    const processed: ProcessedAgent[] = [];
    await this.processRecursive(event, context, 0, processed);
    const depth = processed.length > 0 ? Math.max(...processed.map((_, i) => i)) : 0;
    return { processed, depth };
  }

  private async processRecursive(
    event: RoutedEventEnvelope,
    context: AgentContext,
    depth: number,
    processed: ProcessedAgent[],
  ): Promise<void> {
    if (depth >= this.maxDepth) {
      return;
    }

    const plan = this.router.resolve(event);
    const isUrgent = URGENT_EVENT_TYPES.includes(event.eventType);

    for (const dest of plan.destinations) {
      if (dest.type !== "agent") {
        continue;
      }

      const registryEntry = this.registry.get(event.organizationId, dest.id);
      if (!registryEntry) {
        continue;
      }

      // Skip scheduled/hybrid agents for non-urgent events
      const mode = registryEntry.executionMode;
      if ((mode === "scheduled" || mode === "hybrid") && !isUrgent) {
        continue;
      }

      const handler = this.handlers.get(dest.id);
      if (!handler) {
        continue;
      }

      // Policy check
      const evaluation = await this.policyBridge.evaluate({
        eventId: event.eventId,
        destinationType: "agent",
        destinationId: dest.id,
        action: event.eventType,
        payload: event.payload,
        criticality: dest.criticality as "required" | "optional" | "best_effort",
      });

      if (!evaluation.approved) {
        await this.deliveryStore.record({
          eventId: event.eventId,
          destinationId: dest.id,
          status: "failed",
          attempts: 0,
          error: evaluation.reason ?? "blocked by policy",
        });
        continue;
      }

      // Execute handler
      if (this.stateTracker) {
        this.stateTracker.startProcessing(
          event.organizationId,
          dest.id,
          `Processing ${event.eventType}`,
        );
      }

      let response: AgentResponse;
      try {
        response = await handler.handle(event, registryEntry.config, context);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        if (this.stateTracker) {
          this.stateTracker.setError(event.organizationId, dest.id, error);
        }

        await this.deliveryStore.record({
          eventId: event.eventId,
          destinationId: dest.id,
          status: "failed",
          attempts: 1,
          error,
        });

        processed.push({
          eventId: event.eventId,
          eventType: event.eventType,
          agentId: dest.id,
          success: false,
          outputEvents: [],
          actionsExecuted: [],
          error,
        });
        continue;
      }

      // Execute actions
      const actionsExecuted: string[] = [];
      for (const action of response.actions) {
        await this.actionExecutor.execute(action, context, this.policyBridge);
        actionsExecuted.push(action.actionType);
      }

      if (this.stateTracker) {
        this.stateTracker.completeProcessing(
          event.organizationId,
          dest.id,
          `Processed ${event.eventType}`,
        );
      }

      await this.deliveryStore.record({
        eventId: event.eventId,
        destinationId: dest.id,
        status: "succeeded",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
      });

      processed.push({
        eventId: event.eventId,
        eventType: event.eventType,
        agentId: dest.id,
        success: true,
        outputEvents: response.events.map((e) => e.eventType),
        actionsExecuted,
      });

      // Recurse for output events
      for (const outputEvent of response.events) {
        await this.processRecursive(outputEvent, context, depth + 1, processed);
      }
    }
  }
}
