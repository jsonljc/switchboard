// ---------------------------------------------------------------------------
// Scheduled Runner — triggers scheduled/hybrid agents on demand
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "./events.js";
import type { AgentContext } from "./ports.js";
import type { AgentRegistry, AgentRegistryEntry } from "./registry.js";
import type { EventLoop } from "./event-loop.js";

const DEFAULT_SCHEDULED_EVENT = "scheduled.trigger";

export interface ScheduledRunnerConfig {
  registry: AgentRegistry;
  eventLoop: EventLoop;
}

export interface ScheduledRunResult {
  agentId: string;
  triggered: boolean;
  error?: string;
}

export class ScheduledRunner {
  private registry: AgentRegistry;
  private eventLoop: EventLoop;

  constructor(config: ScheduledRunnerConfig) {
    this.registry = config.registry;
    this.eventLoop = config.eventLoop;
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
