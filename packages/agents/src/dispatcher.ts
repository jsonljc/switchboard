// ---------------------------------------------------------------------------
// Dispatcher — executes approved delivery intents from a RoutePlan
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { RoutePlan, DestinationType } from "./route-plan.js";
import type { PolicyBridge } from "./policy-bridge.js";
import type { DeliveryStore, DeliveryStatus } from "./delivery-store.js";
import type { AgentStateTracker } from "./agent-state.js";

export type DestinationHandler = (
  event: RoutedEventEnvelope,
  destinationId: string,
) => Promise<{ success: boolean }>;

export interface DispatchResult {
  destinationId: string;
  destinationType: DestinationType;
  status: DeliveryStatus | "blocked_by_policy";
  error?: string;
}

export interface DispatcherConfig {
  deliveryStore: DeliveryStore;
  policyBridge: PolicyBridge;
  handlers: Partial<Record<DestinationType, DestinationHandler>>;
  stateTracker?: AgentStateTracker;
}

export class Dispatcher {
  private store: DeliveryStore;
  private bridge: PolicyBridge;
  private handlers: Partial<Record<DestinationType, DestinationHandler>>;
  private stateTracker?: AgentStateTracker;

  constructor(config: DispatcherConfig) {
    this.store = config.deliveryStore;
    this.bridge = config.policyBridge;
    this.handlers = config.handlers;
    this.stateTracker = config.stateTracker;
  }

  async execute(plan: RoutePlan): Promise<DispatchResult[]> {
    const promises: Promise<DispatchResult>[] = [];

    for (const dest of plan.destinations) {
      if (dest.sequencing === "parallel") {
        promises.push(
          this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality).catch(
            (err): DispatchResult => ({
              destinationId: dest.id,
              destinationType: dest.type,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      }
    }

    return Promise.all(promises);
  }

  private async dispatchOne(
    event: RoutedEventEnvelope,
    type: DestinationType,
    destinationId: string,
    criticality: string,
  ): Promise<DispatchResult> {
    // 1. Policy check
    const evaluation = await this.bridge.evaluate({
      eventId: event.eventId,
      destinationType: type,
      destinationId,
      action: event.eventType,
      payload: event.payload,
      criticality: criticality as "required" | "optional" | "best_effort",
    });

    if (!evaluation.approved) {
      try {
        await this.store.record({
          eventId: event.eventId,
          destinationId,
          status: "failed",
          attempts: 0,
          error: evaluation.reason ?? "blocked by policy",
        });
      } catch {
        // Store failure should not crash the dispatch
      }
      return {
        destinationId,
        destinationType: type,
        status: "blocked_by_policy",
        error: evaluation.reason,
      };
    }

    // 2. Find handler
    const handler = this.handlers[type];
    if (!handler) {
      try {
        await this.store.record({
          eventId: event.eventId,
          destinationId,
          status: "failed",
          attempts: 1,
          error: `No handler for destination type: ${type}`,
        });
      } catch {
        // Store failure should not crash the dispatch
      }
      return {
        destinationId,
        destinationType: type,
        status: "failed",
        error: `No handler for destination type: ${type}`,
      };
    }

    // 3. Dispatch
    if (type === "agent" && this.stateTracker) {
      this.stateTracker.startProcessing(
        event.organizationId,
        destinationId,
        `Processing ${event.eventType}`,
      );
    }

    try {
      await handler(event, destinationId);
      try {
        await this.store.record({
          eventId: event.eventId,
          destinationId,
          status: "succeeded",
          attempts: 1,
          lastAttemptAt: new Date().toISOString(),
        });
      } catch {
        // Store failure should not crash the dispatch
      }

      if (type === "agent" && this.stateTracker) {
        this.stateTracker.completeProcessing(
          event.organizationId,
          destinationId,
          `Processed ${event.eventType}`,
        );
      }

      return { destinationId, destinationType: type, status: "succeeded" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      try {
        await this.store.record({
          eventId: event.eventId,
          destinationId,
          status: "failed",
          attempts: 1,
          lastAttemptAt: new Date().toISOString(),
          error,
        });
      } catch {
        // Store failure should not crash the dispatch
      }

      if (type === "agent" && this.stateTracker) {
        this.stateTracker.setError(event.organizationId, destinationId, error);
      }

      return { destinationId, destinationType: type, status: "failed", error };
    }
  }
}
