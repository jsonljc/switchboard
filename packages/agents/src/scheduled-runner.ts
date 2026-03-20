// ---------------------------------------------------------------------------
// Scheduled Runner — triggers scheduled/hybrid agents on demand
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "./events.js";
import type { AgentContext } from "./ports.js";
import type { AgentRegistry, AgentRegistryEntry } from "./registry.js";
import type { EventLoop } from "./event-loop.js";
import type { RetryExecutor } from "./retry-executor.js";
import type { DeadLetterAlerter } from "./dead-letter-alerter.js";

type RetryExecutorLike = Pick<RetryExecutor, "processRetries">;
type DeadLetterAlerterLike = Pick<DeadLetterAlerter, "sweep">;

const DEFAULT_SCHEDULED_EVENT = "scheduled.trigger";

export interface ScheduledRunnerConfig {
  registry: AgentRegistry;
  eventLoop: EventLoop;
  intervalMs?: number;
  retryExecutor?: RetryExecutorLike;
  deadLetterAlerter?: DeadLetterAlerterLike;
}

export interface ScheduledRunResult {
  agentId: string;
  triggered: boolean;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class ScheduledRunner {
  private registry: AgentRegistry;
  private eventLoop: EventLoop;
  private intervalMs: number;
  private retryExecutor: RetryExecutorLike | undefined;
  private deadLetterAlerter: DeadLetterAlerterLike | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ScheduledRunnerConfig) {
    this.registry = config.registry;
    this.eventLoop = config.eventLoop;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.retryExecutor = config.retryExecutor;
    this.deadLetterAlerter = config.deadLetterAlerter;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {
        // tick errors are captured per-agent in runAll
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  private async tick(): Promise<void> {
    const orgIds = this.registry.listOrganizations();
    for (const orgId of orgIds) {
      await this.runAll(orgId, { organizationId: orgId });
    }
  }

  private resolveEventType(entry: AgentRegistryEntry): string {
    const scheduledEventType = entry.config.scheduledEventType as string | undefined;
    if (scheduledEventType) {
      return scheduledEventType;
    }
    return entry.capabilities.accepts[0] ?? DEFAULT_SCHEDULED_EVENT;
  }

  async runAll(organizationId: string, context: AgentContext): Promise<ScheduledRunResult[]> {
    const results: ScheduledRunResult[] = [];
    const entries = this.registry.listActive(organizationId);

    for (const entry of entries) {
      if (entry.executionMode !== "scheduled" && entry.executionMode !== "hybrid") {
        continue;
      }

      const eventType = this.resolveEventType(entry);
      const event = createEventEnvelope({
        organizationId,
        eventType,
        source: { type: "system", id: "scheduled-runner" },
        payload: { agentId: entry.agentId, triggeredBy: "schedule" },
      });

      try {
        const result = await this.eventLoop.process(event, context);
        const wasProcessed = result.processed.length > 0;
        results.push({ agentId: entry.agentId, triggered: wasProcessed });
      } catch (err) {
        results.push({
          agentId: entry.agentId,
          triggered: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (this.retryExecutor) {
      try {
        await this.retryExecutor.processRetries();
      } catch {
        // retry errors must not crash the scheduled run
      }
    }

    if (this.deadLetterAlerter) {
      try {
        await this.deadLetterAlerter.sweep(organizationId);
      } catch {
        // alerter errors must not crash the scheduled run
      }
    }

    return results;
  }

  async runOne(
    organizationId: string,
    agentId: string,
    context: AgentContext,
  ): Promise<ScheduledRunResult> {
    const entry = this.registry.get(organizationId, agentId);
    if (!entry) {
      return { agentId, triggered: false, error: "agent_not_found" };
    }

    if (entry.executionMode === "realtime") {
      return { agentId, triggered: false, error: "agent_is_realtime" };
    }

    const eventType = this.resolveEventType(entry);
    const event = createEventEnvelope({
      organizationId,
      eventType,
      source: { type: "system", id: "scheduled-runner" },
      payload: { agentId, triggeredBy: "manual" },
    });

    try {
      const result = await this.eventLoop.process(event, context);
      const wasProcessed = result.processed.length > 0;
      return { agentId, triggered: wasProcessed };
    } catch (err) {
      return {
        agentId,
        triggered: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
