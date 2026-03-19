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
  actionsFailed: string[];
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
    const maxDepthReached = { value: 0 };
    await this.processRecursive(event, context, 0, processed, maxDepthReached);
    return { processed, depth: maxDepthReached.value };
  }

  private async processRecursive(
    event: RoutedEventEnvelope,
    context: AgentContext,
    depth: number,
    processed: ProcessedAgent[],
    maxDepthReached: { value: number },
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

      // Scheduled agents only process urgent events (and ScheduledRunner triggers)
      // Hybrid agents process urgent events + chained events (depth > 0),
      // but skip top-level non-urgent events
      const mode = registryEntry.executionMode;
      if (mode === "scheduled" && !isUrgent) {
        continue;
      }
      if (mode === "hybrid" && !isUrgent && depth === 0) {
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
        criticality: dest.criticality,
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
          actionsFailed: [],
          error,
        });
        continue;
      }

      // Execute actions
      const actionsExecuted: string[] = [];
      const actionsFailed: string[] = [];
      for (const action of response.actions) {
        const actionResult = await this.actionExecutor.execute(action, context, this.policyBridge);
        if (actionResult.success) {
          actionsExecuted.push(action.actionType);
        } else {
          actionsFailed.push(action.actionType);
        }
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
        actionsFailed,
      });

      // Recurse for output events
      for (const outputEvent of response.events) {
        if (depth + 1 > maxDepthReached.value) {
          maxDepthReached.value = depth + 1;
        }
        await this.processRecursive(outputEvent, context, depth + 1, processed, maxDepthReached);
      }
    }
  }
}
