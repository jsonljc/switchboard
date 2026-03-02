import type { DomainEvent } from "./types.js";
import type { EventReactionStore } from "./reaction-store.js";
import { resolveTemplate } from "./template.js";

export interface ReactionOrchestrator {
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    organizationId?: string | null;
    parentEnvelopeId?: string | null;
    traceId?: string;
  }): Promise<{ denied: boolean; envelope: { id: string; status: string } }>;
}

export interface EventReactionProcessorConfig {
  reactionStore: EventReactionStore;
  orchestrator: ReactionOrchestrator;
  maxChainDepth?: number;
}

/**
 * Processes event reactions — when a domain event is published,
 * finds matching reactions and triggers governed actions.
 */
export class EventReactionProcessor {
  private reactionStore: EventReactionStore;
  private orchestrator: ReactionOrchestrator;
  private maxChainDepth: number;
  private activeChains = new Map<string, number>();

  constructor(config: EventReactionProcessorConfig) {
    this.reactionStore = config.reactionStore;
    this.orchestrator = config.orchestrator;
    this.maxChainDepth = config.maxChainDepth ?? 5;
  }

  async process(event: DomainEvent): Promise<void> {
    // Cycle prevention: track chain depth via traceId
    const currentDepth = this.activeChains.get(event.traceId) ?? 0;
    if (currentDepth >= this.maxChainDepth) {
      console.warn(
        `[EventReactionProcessor] Max chain depth ${this.maxChainDepth} reached for traceId ${event.traceId}, suppressing further reactions`,
      );
      return;
    }

    const reactions = await this.reactionStore.listByEventPattern(
      event.eventType,
      event.organizationId,
    );

    for (const reaction of reactions) {
      if (!reaction.enabled) continue;

      // Evaluate condition (if present)
      if (reaction.condition && Object.keys(reaction.condition).length > 0) {
        const conditionMet = evaluateSimpleCondition(reaction.condition, event);
        if (!conditionMet) continue;
      }

      // Resolve parameter template
      const eventContext: Record<string, unknown> = {
        ...event,
        payload: event.payload,
      };
      const resolvedParams = resolveTemplate(
        reaction.targetAction.parameterTemplate,
        eventContext,
      );

      // Resolve actorId template
      const actorId = typeof reaction.actorId === "string" && reaction.actorId.startsWith("$event.")
        ? String(resolveTemplate({ _: reaction.actorId }, eventContext)["_"] ?? event.principalId)
        : reaction.actorId;

      // Track chain depth
      this.activeChains.set(event.traceId, currentDepth + 1);

      try {
        await this.orchestrator.propose({
          actionType: reaction.targetAction.actionType,
          parameters: resolvedParams,
          principalId: actorId,
          cartridgeId: reaction.targetAction.cartridgeId,
          organizationId: reaction.organizationId,
          parentEnvelopeId: event.envelopeId,
          traceId: event.traceId,
        });
      } catch (err) {
        console.warn(
          `[EventReactionProcessor] Reaction ${reaction.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        // Restore chain depth for this trace
        if (currentDepth === 0) {
          this.activeChains.delete(event.traceId);
        } else {
          this.activeChains.set(event.traceId, currentDepth);
        }
      }
    }
  }
}

/**
 * Simple condition evaluator for event reaction conditions.
 * Supports { "payload.field": value } equality checks.
 */
function evaluateSimpleCondition(
  condition: Record<string, unknown>,
  event: DomainEvent,
): boolean {
  const eventAsRecord = event as unknown as Record<string, unknown>;
  for (const [field, expected] of Object.entries(condition)) {
    const actual = getNestedValue(eventAsRecord, field);
    if (actual !== expected) return false;
  }
  return true;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
