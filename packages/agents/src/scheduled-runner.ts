// ---------------------------------------------------------------------------
// Scheduled Runner — triggers scheduled/hybrid agents on demand
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "./events.js";
import type { AgentContext } from "./ports.js";
import type { AgentRegistry } from "./registry.js";
import type { EventLoop } from "./event-loop.js";

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

  async runAll(organizationId: string, context: AgentContext): Promise<ScheduledRunResult[]> {
    const results: ScheduledRunResult[] = [];
    const entries = this.registry.listActive(organizationId);

    for (const entry of entries) {
      if (entry.executionMode !== "scheduled" && entry.executionMode !== "hybrid") {
        continue;
      }

      const event = createEventEnvelope({
        organizationId,
        eventType: "ad.performance_review",
        source: { type: "system", id: "scheduled-runner" },
        payload: { agentId: entry.agentId, triggeredBy: "schedule" },
      });

      try {
        await this.eventLoop.process(event, context);
        results.push({ agentId: entry.agentId, triggered: true });
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

    const event = createEventEnvelope({
      organizationId,
      eventType: "ad.performance_review",
      source: { type: "system", id: "scheduled-runner" },
      payload: { agentId, triggeredBy: "manual" },
    });

    try {
      await this.eventLoop.process(event, context);
      return { agentId, triggered: true };
    } catch (err) {
      return {
        agentId,
        triggered: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
