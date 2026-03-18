// ---------------------------------------------------------------------------
// Dispatcher — executes approved delivery intents from a RoutePlan
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { RoutePlan, DestinationType } from "./route-plan.js";
import type { PolicyBridge } from "./policy-bridge.js";
import type { DeliveryStore, DeliveryStatus } from "./delivery-store.js";

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
}

export class Dispatcher {
  private store: DeliveryStore;
  private bridge: PolicyBridge;
  private handlers: Partial<Record<DestinationType, DestinationHandler>>;

  constructor(config: DispatcherConfig) {
    this.store = config.deliveryStore;
    this.bridge = config.policyBridge;
    this.handlers = config.handlers;
  }

  async execute(plan: RoutePlan): Promise<DispatchResult[]> {
    const results: Promise<DispatchResult>[] = [];

    for (const dest of plan.destinations) {
      if (dest.sequencing === "parallel") {
        results.push(this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality));
      }
    }

    return Promise.all(results);
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
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 0,
        error: evaluation.reason ?? "blocked by policy",
      });
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
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 1,
        error: `No handler for destination type: ${type}`,
      });
      return {
        destinationId,
        destinationType: type,
        status: "failed",
        error: `No handler for destination type: ${type}`,
      };
    }

    // 3. Dispatch
    try {
      await handler(event, destinationId);
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "succeeded",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
      });
      return { destinationId, destinationType: type, status: "succeeded" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        error,
      });
      return { destinationId, destinationType: type, status: "failed", error };
    }
  }
}
