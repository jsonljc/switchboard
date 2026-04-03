// ---------------------------------------------------------------------------
// Event Loop — chains agents by feeding output events back through the router
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { AgentContext, AgentResponse } from "./ports.js";
import type { AgentRouter } from "./router.js";
import type { AgentRegistry } from "./registry.js";
import type { PolicyBridge } from "./policy-bridge.js";
import type { DeliveryStore } from "./delivery-store.js";
import type { HandlerRegistry } from "./handler-registry.js";

/** Minimal state tracker interface for agent activity monitoring. */
interface AgentStateTracker {
  startProcessing(orgId: string, agentId: string, detail: string): void;
  completeProcessing(orgId: string, agentId: string, detail: string): void;
  setError(orgId: string, agentId: string, error: string): void;
}
import type { ActionExecutor } from "./action-executor.js";
import type { SchedulerService } from "@switchboard/core";
import type { ScheduledTrigger } from "@switchboard/schemas";

const URGENT_EVENT_TYPES = ["ad.anomaly_detected", "ad.performance_review"];

export interface EventLoopConfig {
  router: AgentRouter;
  registry: AgentRegistry;
  handlers: HandlerRegistry;
  actionExecutor: ActionExecutor;
  policyBridge: PolicyBridge;
  deliveryStore: DeliveryStore;
  stateTracker?: AgentStateTracker;
  contactMutex?: {
    acquire(orgId: string, contactId: string): Promise<() => void>;
  };
  scheduler?: SchedulerService;
  onTriggerFired?: (trigger: ScheduledTrigger) => void | Promise<void>;
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
  /** Thread updates from agent (if any). */
  threadUpdate?: import("./ports.js").ThreadUpdate;
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
  private contactMutex?: EventLoopConfig["contactMutex"];
  private scheduler?: SchedulerService;
  private onTriggerFired?: (trigger: ScheduledTrigger) => void | Promise<void>;
  private maxDepth: number;

  constructor(config: EventLoopConfig) {
    this.router = config.router;
    this.registry = config.registry;
    this.handlers = config.handlers;
    this.actionExecutor = config.actionExecutor;
    this.policyBridge = config.policyBridge;
    this.deliveryStore = config.deliveryStore;
    this.stateTracker = config.stateTracker;
    this.contactMutex = config.contactMutex;
    this.scheduler = config.scheduler;
    this.onTriggerFired = config.onTriggerFired;
    this.maxDepth = config.maxDepth ?? 10;
  }

  /**
   * Wire scheduler after construction (needed when scheduler is built after EventLoop).
   */
  setScheduler(
    scheduler: SchedulerService,
    onTriggerFired?: (trigger: ScheduledTrigger) => void | Promise<void>,
  ): void {
    this.scheduler = scheduler;
    if (onTriggerFired) {
      this.onTriggerFired = onTriggerFired;
    }
  }

  async process(event: RoutedEventEnvelope, context: AgentContext): Promise<EventLoopResult> {
    const processed: ProcessedAgent[] = [];
    const maxDepthReached = { value: 0 };
    const seenKeys = new Set<string>();
    await this.processRecursive(event, context, 0, processed, maxDepthReached, seenKeys);
    return { processed, depth: maxDepthReached.value };
  }

  private shouldSkipDestination(
    event: RoutedEventEnvelope,
    destId: string,
    destType: string,
    executionMode: string,
    isUrgent: boolean,
    depth: number,
  ): boolean {
    const targetAgentId = event.metadata?.targetAgentId as string | undefined;
    if (targetAgentId && destType === "agent" && destId !== targetAgentId) {
      return true;
    }
    if (executionMode === "scheduled" && !isUrgent) {
      return true;
    }
    if (executionMode === "hybrid" && !isUrgent && depth === 0) {
      return true;
    }
    return false;
  }

  private async recordDelivery(
    eventId: string,
    destinationId: string,
    status: "failed" | "succeeded" | "skipped",
    attempts: number,
    error?: string,
  ): Promise<void> {
    try {
      await this.deliveryStore.record({
        eventId,
        destinationId,
        status,
        attempts,
        error,
        ...(status === "succeeded" ? { lastAttemptAt: new Date().toISOString() } : {}),
      });
    } catch {
      // store outage must not block event processing
    }
  }

  private async executeActions(
    response: AgentResponse,
    context: AgentContext,
  ): Promise<{ actionsExecuted: string[]; actionsFailed: string[] }> {
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
    return { actionsExecuted, actionsFailed };
  }

  private async processAgent(
    event: RoutedEventEnvelope,
    destId: string,
    config: Record<string, unknown>,
    handler: {
      handle: (
        e: RoutedEventEnvelope,
        c: Record<string, unknown>,
        ctx: AgentContext,
      ) => Promise<AgentResponse>;
    },
    context: AgentContext,
  ): Promise<{ result: ProcessedAgent; outputEvents: RoutedEventEnvelope[] }> {
    if (this.stateTracker) {
      this.stateTracker.startProcessing(
        event.organizationId,
        destId,
        `Processing ${event.eventType}`,
      );
    }

    let response: AgentResponse;
    try {
      response = await handler.handle(event, config, context);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (this.stateTracker) {
        this.stateTracker.setError(event.organizationId, destId, error);
      }
      await this.recordDelivery(event.eventId, destId, "failed", 1, error);
      return {
        result: {
          eventId: event.eventId,
          eventType: event.eventType,
          agentId: destId,
          success: false,
          outputEvents: [],
          actionsExecuted: [],
          actionsFailed: [],
          error,
        },
        outputEvents: [],
      };
    }

    const { actionsExecuted, actionsFailed } = await this.executeActions(response, context);

    if (this.stateTracker) {
      this.stateTracker.completeProcessing(
        event.organizationId,
        destId,
        `Processed ${event.eventType}`,
      );
    }

    await this.recordDelivery(event.eventId, destId, "succeeded", 1);

    return {
      result: {
        eventId: event.eventId,
        eventType: event.eventType,
        agentId: destId,
        success: true,
        outputEvents: response.events.map((e) => e.eventType),
        actionsExecuted,
        actionsFailed,
        threadUpdate: response.threadUpdate,
      },
      outputEvents: response.events,
    };
  }

  private async processRecursive(
    event: RoutedEventEnvelope,
    context: AgentContext,
    depth: number,
    processed: ProcessedAgent[],
    maxDepthReached: { value: number },
    seenKeys: Set<string>,
  ): Promise<void> {
    if (depth >= this.maxDepth || seenKeys.has(event.idempotencyKey)) {
      return;
    }
    seenKeys.add(event.idempotencyKey);

    // Check for event-match triggers
    if (this.scheduler) {
      const eventData = (event.payload ?? {}) as Record<string, unknown>;
      const matchedTriggers = await this.scheduler.matchEvent(
        event.organizationId,
        event.eventType,
        eventData,
      );
      for (const trigger of matchedTriggers) {
        if (this.onTriggerFired) {
          await this.onTriggerFired(trigger);
        }
      }
    }

    // Acquire contact mutex at depth 0 only (top-level processing)
    const contactId = (event.payload as Record<string, unknown>)?.contactId as string | undefined;
    let releaseMutex: (() => void) | undefined;

    if (this.contactMutex && contactId && depth === 0) {
      releaseMutex = await this.contactMutex.acquire(event.organizationId, contactId);
    }

    try {
      const plan = this.router.resolve(event);
      const isUrgent = URGENT_EVENT_TYPES.includes(event.eventType);
      const targetAgentId = event.metadata?.targetAgentId as string | undefined;
      let targetAgentProcessed = false;

      // Sort destinations: blocking first, then parallel, then after_success
      const sequencingOrder: Record<string, number> = {
        blocking: 0,
        parallel: 1,
        after_success: 2,
      };
      const sortedDests = [...plan.destinations].sort(
        (a, b) => (sequencingOrder[a.sequencing] ?? 1) - (sequencingOrder[b.sequencing] ?? 1),
      );

      const completedDests = new Map<string, boolean>();
      let blockingFailed = false;

      for (const dest of sortedDests) {
        if (dest.type !== "agent") {
          continue;
        }

        // If a required blocking destination failed, skip non-blocking destinations
        if (blockingFailed && dest.sequencing !== "blocking") {
          await this.recordDelivery(
            event.eventId,
            dest.id,
            "skipped",
            0,
            "Skipped due to blocking destination failure",
          );
          continue;
        }

        // If after_success, check that the dependency succeeded
        if (dest.sequencing === "after_success" && dest.afterDestinationId) {
          const depSucceeded = completedDests.get(dest.afterDestinationId);
          if (!depSucceeded) {
            await this.recordDelivery(
              event.eventId,
              dest.id,
              "skipped",
              0,
              `Skipped: dependency '${dest.afterDestinationId}' did not succeed`,
            );
            continue;
          }
        }

        const registryEntry = this.registry.get(event.organizationId, dest.id);
        if (!registryEntry) {
          continue;
        }

        if (
          this.shouldSkipDestination(
            event,
            dest.id,
            dest.type,
            registryEntry.executionMode,
            isUrgent,
            depth,
          )
        ) {
          continue;
        }

        const handler = this.handlers.get(dest.id);
        if (!handler) {
          continue;
        }

        const evaluation = await this.policyBridge.evaluate({
          eventId: event.eventId,
          destinationType: "agent",
          destinationId: dest.id,
          action: event.eventType,
          payload: event.payload,
          criticality: dest.criticality,
        });

        if (!evaluation.approved) {
          await this.recordDelivery(
            event.eventId,
            dest.id,
            "failed",
            0,
            evaluation.reason ?? "blocked by policy",
          );
          completedDests.set(dest.id, false);
          if (dest.sequencing === "blocking" && dest.criticality === "required") {
            blockingFailed = true;
          }
          continue;
        }

        const { result, outputEvents } = await this.processAgent(
          event,
          dest.id,
          registryEntry.config,
          handler,
          context,
        );
        processed.push(result);
        completedDests.set(dest.id, result.success);

        if (targetAgentId && dest.id === targetAgentId) {
          targetAgentProcessed = true;
        }

        // If a required blocking destination failed, set flag and skip recursion
        if (dest.sequencing === "blocking" && dest.criticality === "required" && !result.success) {
          blockingFailed = true;
          continue;
        }

        // Recurse for output events
        for (const outputEvent of outputEvents) {
          if (depth + 1 > maxDepthReached.value) {
            maxDepthReached.value = depth + 1;
          }
          await this.processRecursive(
            outputEvent,
            context,
            depth + 1,
            processed,
            maxDepthReached,
            seenKeys,
          );
        }
      }

      // If targetAgentId was set but no matching agent processed the event,
      // record a manual_queue delivery per Phase 2 spec
      if (targetAgentId && !targetAgentProcessed) {
        await this.recordDelivery(
          event.eventId,
          "manual_queue",
          "skipped",
          0,
          `Target agent '${targetAgentId}' not found or not active — routed to manual queue`,
        );
      }
    } finally {
      if (releaseMutex) releaseMutex();
    }
  }
}
