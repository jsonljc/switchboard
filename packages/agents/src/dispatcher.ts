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
  skippedReason?: string;
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

  private async recordDelivery(
    eventId: string,
    destinationId: string,
    status: "failed" | "succeeded" | "skipped",
    attempts: number,
    error?: string,
  ): Promise<void> {
    try {
      await this.store.record({
        eventId,
        destinationId,
        status,
        attempts,
        error,
        ...(status === "succeeded" ? { lastAttemptAt: new Date().toISOString() } : {}),
      });
    } catch {
      // Store failure should not crash the dispatch
    }
  }

  async execute(plan: RoutePlan): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    const completedDestinations = new Map<string, DispatchResult>();

    // Phase 1: Execute all "blocking" destinations sequentially
    const blockingDests = plan.destinations.filter((d) => d.sequencing === "blocking");
    for (const dest of blockingDests) {
      const result = await this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality).catch(
        (err): DispatchResult => ({
          destinationId: dest.id,
          destinationType: dest.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      results.push(result);
      completedDestinations.set(dest.id, result);

      // If a required blocking destination fails, skip all remaining destinations
      if (dest.criticality === "required" && result.status === "failed") {
        const remainingDests = plan.destinations.filter(
          (d) => d.sequencing !== "blocking" || !completedDestinations.has(d.id),
        );
        for (const skipped of remainingDests) {
          const reason = `Required blocking destination ${dest.id} failed`;
          const skippedResult: DispatchResult = {
            destinationId: skipped.id,
            destinationType: skipped.type,
            status: "skipped",
            skippedReason: reason,
          };
          results.push(skippedResult);
          completedDestinations.set(skipped.id, skippedResult);
          await this.recordDelivery(plan.event.eventId, skipped.id, "skipped", 0, reason);
        }
        return results;
      }
    }

    // Phase 2: Execute all "parallel" destinations concurrently
    const parallelDests = plan.destinations.filter((d) => d.sequencing === "parallel");
    const parallelPromises = parallelDests.map((dest) =>
      this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality).catch(
        (err): DispatchResult => ({
          destinationId: dest.id,
          destinationType: dest.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );

    const parallelResults = await Promise.all(parallelPromises);
    for (const result of parallelResults) {
      results.push(result);
      completedDestinations.set(result.destinationId, result);
    }

    // Phase 3: Execute "after_success" destinations based on their dependencies
    const afterSuccessDests = plan.destinations.filter((d) => d.sequencing === "after_success");
    for (const dest of afterSuccessDests) {
      if (!dest.afterDestinationId) {
        const reason = "Missing afterDestinationId dependency";
        results.push({
          destinationId: dest.id,
          destinationType: dest.type,
          status: "skipped",
          skippedReason: reason,
        });
        await this.recordDelivery(plan.event.eventId, dest.id, "skipped", 0, reason);
        continue;
      }

      const dependency = completedDestinations.get(dest.afterDestinationId);
      if (!dependency || dependency.status !== "succeeded") {
        const reason = `Dependency ${dest.afterDestinationId} did not succeed`;
        results.push({
          destinationId: dest.id,
          destinationType: dest.type,
          status: "skipped",
          skippedReason: reason,
        });
        await this.recordDelivery(plan.event.eventId, dest.id, "skipped", 0, reason);
        continue;
      }

      // Dependency succeeded - execute this destination
      const result = await this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality).catch(
        (err): DispatchResult => ({
          destinationId: dest.id,
          destinationType: dest.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      results.push(result);
      completedDestinations.set(dest.id, result);
    }

    return results;
  }

  private async dispatchOne(
    event: RoutedEventEnvelope,
    type: DestinationType,
    destinationId: string,
    criticality: string,
  ): Promise<DispatchResult> {
    const evaluation = await this.bridge.evaluate({
      eventId: event.eventId,
      destinationType: type,
      destinationId,
      action: event.eventType,
      payload: event.payload,
      criticality: criticality as "required" | "optional" | "best_effort",
    });

    if (!evaluation.approved) {
      await this.recordDelivery(
        event.eventId,
        destinationId,
        "failed",
        0,
        evaluation.reason ?? "blocked by policy",
      );
      return {
        destinationId,
        destinationType: type,
        status: "blocked_by_policy",
        error: evaluation.reason,
      };
    }

    const handler = this.handlers[type];
    if (!handler) {
      const error = `No handler for destination type: ${type}`;
      await this.recordDelivery(event.eventId, destinationId, "failed", 1, error);
      return { destinationId, destinationType: type, status: "failed", error };
    }

    if (type === "agent" && this.stateTracker) {
      this.stateTracker.startProcessing(
        event.organizationId,
        destinationId,
        `Processing ${event.eventType}`,
      );
    }

    try {
      await handler(event, destinationId);
      await this.recordDelivery(event.eventId, destinationId, "succeeded", 1);
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
      await this.recordDelivery(event.eventId, destinationId, "failed", 1, error);
      if (type === "agent" && this.stateTracker) {
        this.stateTracker.setError(event.organizationId, destinationId, error);
      }
      return { destinationId, destinationType: type, status: "failed", error };
    }
  }
}
